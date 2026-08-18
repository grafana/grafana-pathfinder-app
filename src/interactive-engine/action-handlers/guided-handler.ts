import { InteractiveStateManager } from '../interactive-state-manager';
import { NavigationManager } from '../navigation-manager';
import { InteractiveElementData } from '../../types/interactive.types';
import {
  describeElement,
  querySelectorAllEnhanced,
  findButtonByText,
  isElementVisible,
  resolveSelector,
  scrollUntilElementFound,
} from '../../lib/dom';
import { logger } from '../../lib/logging';
import { withFaroUserAction } from '../../lib/faro';
import { createInteractionName, UserInteraction } from '../../lib/analytics';
import { type CompletionResult, outcomeFromCompletionResult } from '../outcome-classifier';
import { isCssSelector } from '../../lib/dom/selector-detector';
import { parseTargetState, resolveStateSource, satisfiesTargetState } from '../../lib/dom/toggle-state';
import { GuidedAction, type GuidedSubstepSettledDetail } from '../../types/interactive-actions.types';
import { GUIDED_SUBSTEP_SETTLED_EVENT, INTERACTIVE_CONFIG } from '../../constants/interactive-config';
import { sanitizeDocumentationHTML } from '../../security/html-sanitizer';
import { matchFormValue } from '../auto-completion/action-matcher';
import { applyE2ECommentBoxAttributes } from '../e2e-attributes';
import { commentForTargetState } from './toggle-click';

export type { CompletionResult };
const GUIDED_DEADLINE_EXPIRED = Symbol('guided-deadline-expired');

interface ActiveListener {
  target: EventTarget;
  type: string;
  handler: EventListener;
  options?: AddEventListenerOptions;
}

interface GuidedStepArbiter {
  promise: Promise<CompletionResult>;
  settle: (result: CompletionResult, beforeSettle?: () => void) => CompletionResult;
  getResult: () => CompletionResult | null;
}
export type GuidedRequirementsCheck = (options: {
  requirements: string;
  targetAction?: string;
  refTarget?: string;
  targetValue?: string;
  stepId?: string;
  lazyRender?: boolean;
  scrollContainer?: string;
  discoverLazyTarget?: boolean;
  guideId?: string;
  maxRetries?: number;
  deadlineMs?: number;
  signal?: AbortSignal;
}) => Promise<{ pass: boolean }>;

export interface GuidedStepExecutionContext {
  parentStepId?: string;
  guideId?: string;
}

export class GuidedHandler {
  private activeListeners: ActiveListener[] = [];
  private pendingTimeouts: Array<ReturnType<typeof setTimeout>> = [];
  private pendingIntervals: Array<ReturnType<typeof setInterval>> = [];
  private currentAbortController: AbortController | null = null;
  private currentRunController: AbortController | null = null;
  private completedSteps: number[] = [];
  private settledSteps = new Set<number>();

  constructor(
    private stateManager: InteractiveStateManager,
    private navigationManager: NavigationManager,
    private waitForReactUpdates: () => Promise<void>,
    private checkRequirements: GuidedRequirementsCheck
  ) {}

  /**
   * Execute a sequence of guided steps where user manually performs each action
   */
  async execute(data: InteractiveElementData, performGuided: boolean): Promise<void> {
    this.stateManager.setState(data, 'running');

    try {
      // Show mode not applicable for guided - it's inherently a "show and wait" pattern
      if (!performGuided) {
        await this.waitForReactUpdates();
        this.stateManager.setState(data, 'completed');
        return;
      }

      // Guided mode is handled by the component itself
      // This handler is just for compatibility with the action system
      await this.waitForReactUpdates();
      this.stateManager.setState(data, 'completed');
    } catch (error) {
      this.stateManager.handleError(error as Error, 'GuidedHandler', data, false);
    }
  }

  private interruptedResult(deadline: number): 'cancelled' | 'timeout' {
    return this.remainingTime(deadline) > 0 ? 'cancelled' : 'timeout';
  }

  resetProgress(): void {
    this.completedSteps = [];
    this.settledSteps.clear();
  }
  async executeGuidedStep(
    action: GuidedAction,
    stepIndex: number,
    totalSteps: number,
    timeout: number = INTERACTIVE_CONFIG.guided.stepTimeout,
    onActionCompleted?: () => void,
    context: GuidedStepExecutionContext = {}
  ): Promise<CompletionResult> {
    this.currentRunController?.abort();
    const runController = new AbortController();
    this.currentRunController = runController;
    const deadline = Date.now() + timeout;
    return withFaroUserAction(
      createInteractionName(UserInteraction.DoItButtonClick),
      {
        target_action: action.targetAction,
        ref_target: action.refTarget ?? '',
        step_index: stepIndex,
        total_steps: totalSteps,
      },
      () => this.runGuidedStep(action, stepIndex, totalSteps, deadline, runController, onActionCompleted, context),
      // Internal waits are bounded by `timeout`; the margin only catches a hung step.
      timeout + 10_000,
      { critical: true, outcomeFrom: outcomeFromCompletionResult }
    );
  }

  private waitForRetryDelay(delay: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(new DOMException('Guided target retry cancelled', 'AbortError'));
    }
    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
      }, delay);
      const abort = () => {
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', abort);
        reject(new DOMException('Guided target retry cancelled', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  private createGuidedStepArbiter(
    action: GuidedAction,
    stepIndex: number,
    parentStepId: string | undefined
  ): GuidedStepArbiter {
    let result: CompletionResult | null = null;
    let resolvePromise!: (result: CompletionResult) => void;
    const promise = new Promise<CompletionResult>((resolve) => {
      resolvePromise = resolve;
    });

    return {
      promise,
      settle: (nextResult, beforeSettle) => {
        if (result !== null) {
          return result;
        }

        result = nextResult;
        try {
          beforeSettle?.();
        } catch (error) {
          logger.error('Guided completion callback failed', { error });
          result = 'error';
        }
        this.publishSettledSubstep(action, stepIndex, parentStepId, result);
        resolvePromise(result);
        return result;
      },
      getResult: () => result,
    };
  }

  private async runGuidedStep(
    action: GuidedAction,
    stepIndex: number,
    totalSteps: number,
    deadline: number,
    runController: AbortController,
    onActionCompleted: (() => void) | undefined,
    context: GuidedStepExecutionContext
  ): Promise<CompletionResult> {
    const arbiter = this.createGuidedStepArbiter(action, stepIndex, context.parentStepId);

    try {
      this.cleanupListeners();
      if (action.requirements) {
        const result = await this.runBeforeDeadline(
          this.checkRequirements({
            requirements: action.requirements,
            targetAction: action.targetAction,
            refTarget: action.refTarget,
            targetValue: action.targetValue,
            stepId: `guided-substep-${stepIndex}`,
            lazyRender: action.lazyRender,
            scrollContainer: action.scrollContainer,
            discoverLazyTarget: true,
            guideId: context.guideId,
            maxRetries: 0,
            deadlineMs: deadline,
            signal: runController.signal,
          }),
          deadline,
          runController
        );
        if (result === GUIDED_DEADLINE_EXPIRED) {
          return this.finishGuidedStep(this.interruptedResult(deadline), stepIndex, action, context.parentStepId);
        }
        if (!result.pass) {
          return this.finishGuidedStep(
            action.isSkippable ? 'skipped' : 'error',
            stepIndex,
            action,
            context.parentStepId
          );
        }
      }
      const remainingAfterRequirements = this.remainingTime(deadline);
      if (remainingAfterRequirements <= 0) {
        return this.finishGuidedStep('timeout', stepIndex, action, context.parentStepId);
      }
      if (action.targetAction === 'noop') {
        return await this.executeNoopStep(
          action,
          stepIndex,
          totalSteps,
          remainingAfterRequirements,
          context.parentStepId
        );
      }

      const refTarget = action.refTarget;
      const targetAction = action.targetAction as 'hover' | 'button' | 'highlight' | 'formfill';

      if (!refTarget) {
        throw new Error(`Non-noop action ${targetAction} requires a refTarget`);
      }

      const navigationReady = await this.runBeforeDeadline(
        this.expandNavigationParentIfNeeded(refTarget, runController.signal),
        deadline,
        runController
      );
      if (navigationReady === GUIDED_DEADLINE_EXPIRED) {
        return this.finishGuidedStep(this.interruptedResult(deadline), stepIndex, action, context.parentStepId);
      }

      let targetElement: HTMLElement;
      try {
        targetElement = await this.resolveGuidedTarget(action, refTarget, targetAction, deadline, runController.signal);
      } catch (elementNotFoundError) {
        if (this.remainingTime(deadline) <= 0) {
          return this.finishGuidedStep('timeout', stepIndex, action, context.parentStepId);
        }
        if (runController.signal.aborted) {
          return this.finishGuidedStep('cancelled', stepIndex, action, context.parentStepId);
        }
        if (action.isSkippable) {
          return this.finishGuidedStep('skipped', stepIndex, action, context.parentStepId);
        }
        throw elementNotFoundError;
      }

      const prepared = await this.runBeforeDeadline(
        this.prepareElement(targetElement, runController.signal),
        deadline,
        runController
      );
      if (prepared === GUIDED_DEADLINE_EXPIRED || this.remainingTime(deadline) <= 0) {
        return this.finishGuidedStep(this.interruptedResult(deadline), stepIndex, action, context.parentStepId);
      }
      if (runController.signal.aborted) {
        return this.finishGuidedStep('cancelled', stepIndex, action, context.parentStepId);
      }
      // Attach before highlighting so click activation cannot beat the listener.
      this.createCompletionListener(action, targetElement, this.remainingTime(deadline), arbiter, onActionCompleted);
      if (action.isSkippable) {
        this.createSkipListener(stepIndex, arbiter);
      }
      this.createCancelListener(stepIndex, arbiter);
      const highlighted = await this.runBeforeDeadline(
        this.highlightTarget(
          targetElement,
          targetAction,
          stepIndex,
          totalSteps,
          commentForTargetState(action.targetComment, targetElement, action.targetState),
          action.isSkippable,
          action.formHint,
          action.targetValue,
          action.refTarget!,
          runController.signal
        ).finally(() => {
          if (runController.signal.aborted) {
            targetElement.classList.remove('interactive-guided-active');
            this.navigationManager.clearAllHighlights();
          }
        }),
        deadline,
        runController
      );
      if (highlighted === GUIDED_DEADLINE_EXPIRED) {
        const result = arbiter.getResult() ?? arbiter.settle(this.interruptedResult(deadline));
        return this.finishGuidedStep(result, stepIndex, action, context.parentStepId);
      }

      return this.finishGuidedStep(await arbiter.promise, stepIndex, action, context.parentStepId);
    } catch (error) {
      const settledResult = arbiter.getResult();
      if (settledResult === null) {
        logger.error(`Guided step ${stepIndex + 1} failed`, { error });
      } else if (settledResult !== 'error') {
        logger.warn(`Guided step ${stepIndex + 1} settled before setup failed`, { error, result: settledResult });
      }
      const result = settledResult ?? arbiter.settle('error');
      return this.finishGuidedStep(result, stepIndex, action, context.parentStepId);
    }
  }

  private finishGuidedStep(
    result: CompletionResult,
    stepIndex: number,
    action: GuidedAction,
    parentStepId?: string
  ): CompletionResult {
    this.publishSettledSubstep(action, stepIndex, parentStepId, result);
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
    if (this.currentRunController) {
      this.currentRunController.abort();
      this.currentRunController = null;
    }
    try {
      this.cleanupListeners(true);
    } catch (error) {
      logger.error('Guided cleanup failed', { error });
    }
    if ((result === 'completed' || result === 'skipped') && !this.completedSteps.includes(stepIndex)) {
      this.completedSteps.push(stepIndex);
    }
    return result;
  }

  private publishSettledSubstep(
    action: GuidedAction,
    stepIndex: number,
    parentStepId: string | undefined,
    result: CompletionResult
  ): void {
    if (!parentStepId || (result !== 'completed' && result !== 'skipped') || this.settledSteps.has(stepIndex)) {
      return;
    }
    this.settledSteps.add(stepIndex);
    const detail: GuidedSubstepSettledDetail = {
      stepId: parentStepId,
      index: stepIndex,
      action: action.targetAction,
      outcome: result === 'skipped' ? 'skipped' : 'passed',
    };
    document.dispatchEvent(new CustomEvent(GUIDED_SUBSTEP_SETTLED_EVENT, { detail }));
  }

  private remainingTime(deadline: number): number {
    return Math.max(0, deadline - Date.now());
  }

  private async runBeforeDeadline<T>(
    work: Promise<T>,
    deadline: number,
    runController: AbortController
  ): Promise<T | typeof GUIDED_DEADLINE_EXPIRED> {
    if (runController.signal.aborted) {
      return GUIDED_DEADLINE_EXPIRED;
    }
    const remaining = this.remainingTime(deadline);
    if (remaining <= 0) {
      runController.abort();
      return GUIDED_DEADLINE_EXPIRED;
    }
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<typeof GUIDED_DEADLINE_EXPIRED>((resolve) => {
      timeoutId = setTimeout(() => {
        runController.abort();
        resolve(GUIDED_DEADLINE_EXPIRED);
      }, remaining);
    });
    try {
      return await Promise.race([work, expired]);
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Execute a noop step - informational step with no target element
   * Shows a comment box and waits for user to click "Continue" or skip
   */
  private async executeNoopStep(
    action: GuidedAction,
    stepIndex: number,
    totalSteps: number,
    timeout: number,
    parentStepId?: string
  ): Promise<CompletionResult> {
    this.cleanupListeners();
    const arbiter = this.createGuidedStepArbiter(action, stepIndex, parentStepId);
    this.currentAbortController = new AbortController();
    const signal = this.currentAbortController.signal;
    if (action.isSkippable) {
      this.createSkipListener(stepIndex, arbiter);
    }
    this.createCancelListener(stepIndex, arbiter);
    const completionPromise = this.createNoopCompletionListener(stepIndex, timeout);
    void completionPromise.then((result) => arbiter.settle(result));
    const handleAbort = () => {
      arbiter.settle('cancelled');
    };
    signal.addEventListener('abort', handleAbort, { once: true });
    this.activeListeners.push({
      target: signal,
      type: 'abort',
      handler: handleAbort,
      options: { once: true },
    });
    await this.showNoopCommentBox(
      stepIndex,
      totalSteps,
      action.targetComment || 'Complete this step to continue',
      action.isSkippable
    );
    return this.finishGuidedStep(await arbiter.promise, stepIndex, action, parentStepId);
  }

  /**
   * Create a completion listener for noop steps - listens for "Continue" button click
   */
  private createNoopCompletionListener(stepIndex: number, timeout: number): Promise<CompletionResult> {
    return new Promise<CompletionResult>((resolve) => {
      const handleContinue = (event: Event) => {
        const customEvent = event as CustomEvent<{ stepIndex: number }>;
        if (customEvent.detail?.stepIndex === stepIndex) {
          resolve('completed');
        }
      };

      document.addEventListener('guided-noop-continue', handleContinue);
      this.activeListeners.push({
        target: document,
        type: 'guided-noop-continue',
        handler: handleContinue,
      });

      const timeoutId = setTimeout(() => resolve('timeout'), timeout);
      this.pendingTimeouts.push(timeoutId);
    });
  }

  private async showNoopCommentBox(
    stepIndex: number,
    totalSteps: number,
    comment: string,
    isSkippable?: boolean
  ): Promise<void> {
    this.navigationManager.clearAllHighlights();

    const commentBox = document.createElement('div');
    commentBox.className = 'interactive-comment-box';
    commentBox.setAttribute('data-position', 'center');
    commentBox.setAttribute('data-ready', 'true');
    commentBox.setAttribute('data-noop', 'true');

    applyE2ECommentBoxAttributes(commentBox, {
      actionType: 'noop',
      skippable: isSkippable === true,
    });

    const content = document.createElement('div');
    content.className = 'interactive-comment-content interactive-comment-glow';

    const stepsContainer = document.createElement('div');
    stepsContainer.className = 'interactive-comment-steps-list';
    for (let i = 0; i < totalSteps; i++) {
      const stepItem = document.createElement('div');
      stepItem.className = 'interactive-comment-step-item';
      if (this.completedSteps.includes(i)) {
        stepItem.classList.add('interactive-comment-step-completed');
      }
      if (i === stepIndex) {
        stepItem.classList.add('interactive-comment-step-current');
      }
      stepsContainer.appendChild(stepItem);
    }

    const logoContainer = document.createElement('div');
    logoContainer.className = 'interactive-comment-logo';
    const logo = document.createElement('img');
    logo.src = 'public/plugins/grafana-pathfinder-app/img/logo.svg';
    logo.alt = 'Pathfinder';
    logoContainer.appendChild(logo);

    const textContainer = document.createElement('div');
    textContainer.className = 'interactive-comment-text';
    // eslint-disable-next-line no-restricted-syntax -- Sanitized with DOMPurify via sanitizeDocumentationHTML (F5)
    textContainer.innerHTML = sanitizeDocumentationHTML(comment);

    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'interactive-comment-wrapper';
    contentWrapper.appendChild(logoContainer);
    contentWrapper.appendChild(textContainer);

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'interactive-comment-buttons';

    const continueButton = document.createElement('button');
    continueButton.className = 'interactive-comment-skip-btn';
    continueButton.textContent = 'Continue →';
    continueButton.style.backgroundColor = '#3871dc';
    continueButton.onclick = () => {
      document.dispatchEvent(new CustomEvent('guided-noop-continue', { detail: { stepIndex } }));
    };
    buttonContainer.appendChild(continueButton);

    if (isSkippable) {
      const skipButton = document.createElement('button');
      skipButton.className = 'interactive-comment-skip-btn';
      skipButton.textContent = 'Skip';
      skipButton.onclick = () => {
        document.dispatchEvent(new CustomEvent('guided-step-skipped', { detail: { stepIndex } }));
      };
      buttonContainer.appendChild(skipButton);
    }

    const cancelButton = document.createElement('button');
    cancelButton.className = 'interactive-comment-cancel-btn';
    cancelButton.textContent = 'Cancel';
    cancelButton.onclick = () => {
      document.dispatchEvent(new CustomEvent('guided-step-cancelled', { detail: { stepIndex } }));
    };
    buttonContainer.appendChild(cancelButton);

    content.appendChild(stepsContainer);
    content.appendChild(contentWrapper);
    content.appendChild(buttonContainer);
    commentBox.appendChild(content);

    document.body.appendChild(commentBox);
  }

  /**
   * Find target element with retry logic - keeps trying every retryInterval until timeout
   * @param skipRetryOnFailure - If true, throw immediately on first failure (for skippable steps)
   */
  private async findTargetElementWithRetry(
    selector: string,
    actionType: 'hover' | 'button' | 'highlight' | 'formfill',
    timeout: number,
    retryInterval: number,
    skipRetryOnFailure = false,
    signal?: AbortSignal
  ): Promise<HTMLElement> {
    const startTime = Date.now();
    let attemptCount = 0;

    while (Date.now() - startTime < timeout) {
      if (signal?.aborted) {
        throw new DOMException('Guided target retry cancelled', 'AbortError');
      }
      attemptCount++;
      try {
        const element = await this.findTargetElement(selector, actionType);
        return element;
      } catch (error) {
        if (signal?.aborted) {
          throw new DOMException('Guided target retry cancelled', 'AbortError');
        }
        const elapsed = Date.now() - startTime;
        const remaining = timeout - elapsed;

        // For skippable steps, fail immediately on first attempt - don't retry
        if (skipRetryOnFailure) {
          throw error;
        }

        if (remaining <= 0) {
          logger.error(`Element not found after ${attemptCount} attempts (${elapsed}ms): ${selector}`, {
            selector,
            action_type: actionType,
            attempt_count: attemptCount,
            elapsed_ms: elapsed,
          });
          throw error;
        }
        // Wait before retrying, but don't exceed timeout
        await this.waitForRetryDelay(Math.min(retryInterval, remaining), signal);
      }
    }

    throw new Error(`Timeout finding element: ${selector}`);
  }

  private async resolveGuidedTarget(
    action: GuidedAction,
    selector: string,
    actionType: 'hover' | 'button' | 'highlight' | 'formfill',
    deadline: number,
    signal: AbortSignal
  ): Promise<HTMLElement> {
    if (action.lazyRender) {
      try {
        return await this.findTargetElement(selector, actionType);
      } catch {
        const discovered = await scrollUntilElementFound(selector, {
          scrollContainerSelector: action.scrollContainer,
          deadlineMs: deadline,
          signal,
        });
        if (discovered) {
          return this.findTargetElement(selector, actionType);
        }
      }
    }

    return this.findTargetElementWithRetry(
      selector,
      actionType,
      this.remainingTime(deadline),
      INTERACTIVE_CONFIG.guided.retryInterval,
      action.isSkippable === true,
      signal
    );
  }

  private async expandNavigationParentIfNeeded(selector: string, signal: AbortSignal): Promise<void> {
    const targetHref = this.getNavigationTargetHref(selector);
    if (!targetHref) {
      return;
    }

    await this.navigationManager.expandParentNavigationSection(targetHref, signal);
  }

  private getNavigationTargetHref(selector: string): string | undefined {
    const resolvedSelector = resolveSelector(selector);
    const navigationMenuItemMatch = resolvedSelector.match(
      /a\[data-testid=['"]data-testid Nav menu item['"]\]\[href=['"]([^'"]+)['"]\]/
    );

    return navigationMenuItemMatch?.[1];
  }

  /**
   * Find target element using action-specific logic
   * Buttons support both CSS selectors and text matching with intelligent detection
   * Formfill targets form elements (input, textarea, select)
   */
  private async findTargetElement(
    selector: string,
    actionType: 'hover' | 'button' | 'highlight' | 'formfill'
  ): Promise<HTMLElement> {
    let targetElements: HTMLElement[];

    // Resolve grafana: prefix if present
    const resolvedSelector = resolveSelector(selector);

    // For button actions, try CSS selector first if it looks like one, then fall back to text
    if (actionType === 'button') {
      // Try CSS selector first if it looks like one
      if (isCssSelector(resolvedSelector)) {
        try {
          const enhancedResult = querySelectorAllEnhanced(resolvedSelector);
          targetElements = enhancedResult.elements.filter(
            (el) => el.tagName === 'BUTTON' || el.getAttribute('role') === 'button'
          );

          if (targetElements.length > 0) {
            if (targetElements.length > 1) {
              logger.warn(`Multiple buttons found matching selector: ${resolvedSelector}, using first button`);
            }
            return targetElements[0]!;
          }
        } catch (error) {
          logger.warn(`Button selector matching failed for "${resolvedSelector}", trying text match`, { error });
        }
      }

      // Fall back to text matching (existing behavior)
      try {
        targetElements = findButtonByText(resolvedSelector);
        if (targetElements.length > 0) {
          if (targetElements.length > 1) {
            logger.warn(`Multiple buttons found matching text: ${resolvedSelector}, using first button`);
          }
          return targetElements[0]!;
        }
      } catch (error) {
        // Fall through to enhanced selector as last resort
        logger.warn(`findButtonByText failed for "${resolvedSelector}", trying enhanced selector`, { error });
      }
    }

    // For formfill actions, find form elements (input, textarea, select)
    if (actionType === 'formfill') {
      const enhancedResult = querySelectorAllEnhanced(resolvedSelector);
      const formElements = enhancedResult.elements.filter((el) => {
        const tag = el.tagName.toLowerCase();
        return tag === 'input' || tag === 'textarea' || tag === 'select';
      });

      if (formElements.length > 0) {
        if (formElements.length > 1) {
          logger.warn(`Multiple form elements found matching selector: ${resolvedSelector}, using first element`);
        }
        return formElements[0]!;
      }

      // Try to find form element inside the matched element
      const container = enhancedResult.elements[0];
      if (container) {
        const nestedInput = container.querySelector('input:not([type="hidden"]), textarea, select');
        if (nestedInput instanceof HTMLElement) {
          return nestedInput;
        }
      }
    }

    // Fallback to enhanced selector for all action types
    const enhancedResult = querySelectorAllEnhanced(resolvedSelector);
    targetElements = enhancedResult.elements;

    if (targetElements.length === 0) {
      throw new Error(`No elements found matching selector: ${resolvedSelector}`);
    }

    if (targetElements.length > 1) {
      logger.warn(`Multiple elements found matching selector: ${resolvedSelector}, using first element`);
    }

    return targetElements[0]!;
  }

  /**
   * Prepare element for interaction (scroll, open navigation)
   */
  private async prepareElement(targetElement: HTMLElement, signal: AbortSignal): Promise<void> {
    // Validate visibility before interaction
    if (!isElementVisible(targetElement)) {
      logger.warn('Target element is not visible', { targetElement: describeElement(targetElement) });
      // Continue anyway (non-breaking)
    }

    await this.navigationManager.ensureNavigationOpen(targetElement, signal);
    await this.navigationManager.ensureElementVisible(targetElement, signal);
  }

  private async highlightTarget(
    element: HTMLElement,
    actionType: 'hover' | 'button' | 'highlight' | 'formfill',
    stepIndex: number,
    totalSteps: number,
    customComment?: string,
    isSkippable?: boolean,
    formHint?: string,
    targetValue?: string,
    refTarget?: string,
    signal?: AbortSignal
  ): Promise<void> {
    const message = customComment || this.getActionMessage(actionType, stepIndex, totalSteps);

    const stepInfo = {
      current: stepIndex,
      total: totalSteps,
      completedSteps: [...this.completedSteps],
    };

    const skipCallback = isSkippable
      ? () => {
          const skipEvent = new CustomEvent('guided-step-skipped', {
            detail: { stepIndex },
          });
          document.dispatchEvent(skipEvent);
        }
      : undefined;

    const cancelCallback = () => {
      const cancelEvent = new CustomEvent('guided-step-cancelled', {
        detail: { stepIndex },
      });
      document.dispatchEvent(cancelEvent);
    };

    await this.navigationManager.highlightWithComment(
      element,
      message,
      false,
      stepInfo,
      skipCallback,
      cancelCallback,
      undefined,
      undefined,
      {
        skipAnimations: stepIndex > 0,
        actionType,
        targetValue,
        refTarget,
        skippable: isSkippable === true,
        signal,
      }
    );
    if (!signal?.aborted) {
      element.classList.add('interactive-guided-active');
    }
  }

  private getActionMessage(
    actionType: 'hover' | 'button' | 'highlight' | 'formfill',
    stepIndex: number,
    totalSteps: number
  ): string {
    switch (actionType) {
      case 'hover':
        return 'Hover your mouse over this element';
      case 'button':
        return 'Click this element';
      case 'highlight':
        return 'Click this element';
      case 'formfill':
        return 'Fill in this form field';
      default:
        return 'Interact with this element';
    }
  }

  private createCompletionListener(
    action: GuidedAction,
    targetElement: HTMLElement,
    timeout: number,
    arbiter: GuidedStepArbiter,
    onActionCompleted?: () => void
  ): void {
    this.currentAbortController = new AbortController();
    const signal = this.currentAbortController.signal;
    const actionType = action.targetAction as 'hover' | 'button' | 'highlight' | 'formfill';
    // Do not click an already-satisfied toggle away from its target state.
    if (actionType === 'button' || actionType === 'highlight') {
      const target = parseTargetState(action.targetState);
      if (target && satisfiesTargetState(resolveStateSource(targetElement, target), target) === true) {
        arbiter.settle('completed');
        return;
      }
    }

    const completionPromise = this.attachCompletionListener(
      actionType,
      targetElement,
      signal,
      arbiter,
      action.targetValue,
      action.formHint,
      action.validateInput,
      onActionCompleted
    );
    void completionPromise.then(
      (result) => arbiter.settle(result),
      (error) => {
        logger.error('Guided completion listener failed', { error });
        arbiter.settle('error');
      }
    );

    const timeoutId = setTimeout(() => arbiter.settle('timeout'), timeout);
    this.pendingTimeouts.push(timeoutId);
    const handleAbort = () => {
      arbiter.settle('cancelled');
    };
    signal.addEventListener('abort', handleAbort, { once: true });
    this.activeListeners.push({
      target: signal,
      type: 'abort',
      handler: handleAbort,
      options: { once: true },
    });
  }

  private createSkipListener(stepIndex: number, arbiter: GuidedStepArbiter): void {
    const handleSkip = (event: Event) => {
      const customEvent = event as CustomEvent<{ stepIndex: number }>;
      if (customEvent.detail.stepIndex === stepIndex) {
        arbiter.settle('skipped');
      }
    };

    document.addEventListener('guided-step-skipped', handleSkip);
    this.activeListeners.push({
      target: document,
      type: 'guided-step-skipped',
      handler: handleSkip,
    });
  }

  private createCancelListener(stepIndex: number, arbiter: GuidedStepArbiter): void {
    const handleCancel = (event: Event) => {
      const customEvent = event as CustomEvent<{ stepIndex: number }>;
      if (customEvent.detail.stepIndex === stepIndex) {
        arbiter.settle('cancelled');
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        arbiter.settle('cancelled');
      }
    };

    document.addEventListener('guided-step-cancelled', handleCancel);
    document.addEventListener('keydown', handleKeyDown);
    this.activeListeners.push(
      {
        target: document,
        type: 'guided-step-cancelled',
        handler: handleCancel,
      },
      {
        target: document,
        type: 'keydown',
        handler: handleKeyDown as EventListener,
      }
    );
  }

  private async attachCompletionListener(
    actionType: 'hover' | 'button' | 'highlight' | 'formfill',
    element: HTMLElement,
    signal: AbortSignal,
    arbiter: GuidedStepArbiter,
    targetValue?: string,
    formHint?: string,
    validateInput?: boolean,
    onActionCompleted?: () => void
  ): Promise<CompletionResult> {
    switch (actionType) {
      case 'hover':
        return this.waitForHover(element, signal);
      case 'button':
      case 'highlight':
        return this.waitForClick(element, signal, arbiter, onActionCompleted);
      case 'formfill':
        return this.waitForFormfill(element, signal, targetValue, formHint, validateInput);
      default:
        throw new Error(`Unsupported guided action type: ${actionType}`);
    }
  }

  private async waitForHover(element: HTMLElement, signal: AbortSignal): Promise<CompletionResult> {
    return new Promise<CompletionResult>((resolve) => {
      let hoverTimeout: NodeJS.Timeout | null = null;
      let isResolved = false;
      const dwellTime = INTERACTIVE_CONFIG.guided.hoverDwell;
      const cleanup = (result: CompletionResult) => {
        if (isResolved) {
          return;
        }
        isResolved = true;
        if (hoverTimeout) {
          clearTimeout(hoverTimeout);
          hoverTimeout = null;
        }
        resolve(result);
      };

      const startDwellTimer = () => {
        if (hoverTimeout) {
          clearTimeout(hoverTimeout);
          hoverTimeout = null;
        }
        hoverTimeout = setTimeout(() => {
          cleanup('completed');
        }, dwellTime);
      };

      const handleMouseEnter = () => {
        if (!isResolved) {
          startDwellTimer();
        }
      };

      const handleMouseLeave = () => {
        if (hoverTimeout) {
          clearTimeout(hoverTimeout);
          hoverTimeout = null;
        }
      };

      element.addEventListener('mouseenter', handleMouseEnter);
      element.addEventListener('mouseleave', handleMouseLeave);
      this.activeListeners.push(
        { target: element, type: 'mouseenter', handler: handleMouseEnter },
        { target: element, type: 'mouseleave', handler: handleMouseLeave }
      );

      if (element.matches(':hover')) {
        startDwellTimer();
      }
      signal.addEventListener('abort', () => {
        cleanup('cancelled');
      });
    });
  }

  private async waitForClick(
    element: HTMLElement,
    signal: AbortSignal,
    arbiter: GuidedStepArbiter,
    onActionCompleted?: () => void
  ): Promise<CompletionResult> {
    return new Promise<CompletionResult>((resolve) => {
      let isResolved = false;
      let rectUpdateInterval: NodeJS.Timeout | null = null;
      const cleanup = (result: CompletionResult) => {
        if (isResolved) {
          return;
        }
        isResolved = true;
        if (rectUpdateInterval) {
          clearInterval(rectUpdateInterval);
          rectUpdateInterval = null;
        }
        resolve(result);
      };
      const complete = () => {
        if (isResolved) {
          return;
        }
        cleanup(arbiter.settle('completed', onActionCompleted));
      };
      rectUpdateInterval = setInterval(() => {
        if (!element.isConnected) {
          cleanup('cancelled');
        }
      }, INTERACTIVE_CONFIG.guided.connectivityCheckInterval);
      this.pendingIntervals.push(rectUpdateInterval);

      const handleClick = (event: Event) => {
        if (isResolved) {
          return;
        }

        const mouseEvent = event as MouseEvent;
        const clickedElement = mouseEvent.target as HTMLElement;

        const isTargetOrChild = element === clickedElement || element.contains(clickedElement);

        if (isTargetOrChild) {
          complete();
          return;
        }

        const elementRect = element.getBoundingClientRect();
        const padding = 16;
        const clickX = mouseEvent.clientX;
        const clickY = mouseEvent.clientY;

        const isWithinBounds =
          clickX >= elementRect.left - padding &&
          clickX <= elementRect.right + padding &&
          clickY >= elementRect.top - padding &&
          clickY <= elementRect.bottom + padding;

        if (isWithinBounds) {
          if (element.isConnected) {
            element.click();
          }
          complete();
        }
      };

      document.addEventListener('click', handleClick, { capture: true });
      this.activeListeners.push({
        target: document,
        type: 'click',
        handler: handleClick,
        options: { capture: true },
      });

      signal.addEventListener('abort', () => {
        cleanup('cancelled');
      });
    });
  }

  /**
   * Wait for user to fill a form field with valid content
   * Uses debounced validation with 2-second delay and regex pattern support
   *
   * @param element - The form input element to monitor
   * @param signal - AbortSignal for cancellation
   * @param targetValue - Expected value (may be regex pattern)
   * @param formHint - Hint to show when validation fails
   * @param validateInput - Enable strict validation (require targetValue match)
   */
  private async waitForFormfill(
    element: HTMLElement,
    signal: AbortSignal,
    targetValue?: string,
    formHint?: string,
    validateInput?: boolean
  ): Promise<CompletionResult> {
    return new Promise<CompletionResult>((resolve) => {
      let isResolved = false;
      let debounceTimer: NodeJS.Timeout | null = null;
      const DEBOUNCE_DELAY = 2000; // 2 second debounce
      const SUCCESS_ANIMATION_DELAY = 800; // Show success tick for 800ms

      // Centralized cleanup function
      const cleanup = (result: CompletionResult) => {
        if (isResolved) {
          return;
        }
        isResolved = true;
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        resolve(result);
      };

      // Get element value
      const getElementValue = (): string => {
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          return element.value;
        }
        if (element instanceof HTMLSelectElement) {
          return element.value;
        }
        return element.textContent || '';
      };

      // Show success animation then complete
      const showSuccessAndComplete = () => {
        this.updateFormValidationFeedback(element, 'valid');
        const successTimeoutId = setTimeout(() => {
          if (!isResolved) {
            cleanup('completed');
          }
        }, SUCCESS_ANIMATION_DELAY);
        this.pendingTimeouts.push(successTimeoutId);
      };

      // Validate current value against expected
      const validateValue = () => {
        const currentValue = getElementValue();

        // Clear any previous feedback before checking
        this.clearFormValidationFeedback();

        // If validation is disabled (default), accept any non-empty value
        if (validateInput !== true) {
          if (currentValue.trim() !== '') {
            showSuccessAndComplete();
          }
          return;
        }

        // Strict validation enabled - require targetValue match
        // If no targetValue even with validation enabled, accept any non-empty
        if (!targetValue || targetValue === '') {
          if (currentValue.trim() !== '') {
            showSuccessAndComplete();
          }
          return;
        }

        // Show checking state briefly while validating
        this.updateFormValidationFeedback(element, 'checking');

        // Use matchFormValue which supports regex patterns
        const matchResult = matchFormValue(currentValue, targetValue);

        if (matchResult.isMatch) {
          // Show success animation before completing
          showSuccessAndComplete();
        } else {
          // Validation failed - update comment box with hint
          this.updateFormValidationFeedback(element, 'invalid', formHint || `Expected: ${matchResult.expectedPattern}`);
        }
      };

      // Handle input events with debounce
      const handleInput = () => {
        if (isResolved) {
          return;
        }

        // Clear existing timer
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }

        // Show "Checking..." while user is typing to indicate we're watching
        this.updateFormValidationFeedback(element, 'checking');

        // Start debounce timer - validate after user stops typing
        debounceTimer = setTimeout(() => {
          if (!isResolved) {
            validateValue();
          }
        }, DEBOUNCE_DELAY);
      };

      // Focus the element to help user start typing
      element.focus();

      // Check if initial value already matches (auto-complete without showing checking state)
      const initialValue = getElementValue();
      if (initialValue.trim() !== '') {
        // If validation disabled, any non-empty initial value completes the step
        if (validateInput !== true) {
          showSuccessAndComplete();
          return;
        }
        // Validation enabled - check if initial value matches targetValue
        if (targetValue) {
          const matchResult = matchFormValue(initialValue, targetValue);
          if (matchResult.isMatch) {
            showSuccessAndComplete();
            return;
          }
        }
        // Don't show any feedback for initial values - wait for user to type
      }

      // Attach input listeners
      element.addEventListener('input', handleInput);
      element.addEventListener('change', handleInput);

      // Store for cleanup
      this.activeListeners.push(
        { target: element, type: 'input', handler: handleInput },
        { target: element, type: 'change', handler: handleInput }
      );

      // Handle cancellation
      signal.addEventListener('abort', () => {
        cleanup('cancelled');
      });
    });
  }

  /**
   * Clear the form validation feedback from comment box
   */
  private clearFormValidationFeedback(): void {
    const commentBox = document.querySelector('.interactive-comment-box');
    if (!commentBox) {
      return;
    }

    const statusElement = commentBox.querySelector('.interactive-form-validation-status');
    if (statusElement) {
      statusElement.remove();
    }
  }

  /**
   * Update the comment box with form validation feedback
   * Places the feedback inline with the Cancel button
   */
  private updateFormValidationFeedback(
    element: HTMLElement,
    state: 'checking' | 'invalid' | 'valid',
    hint?: string
  ): void {
    // Find the comment box associated with this element
    const commentBox = document.querySelector('.interactive-comment-box');
    if (!commentBox) {
      return;
    }

    // Find or create the validation status element - place it in the button container for inline display
    let statusElement = commentBox.querySelector('.interactive-form-validation-status') as HTMLElement;
    if (!statusElement) {
      statusElement = document.createElement('div');
      statusElement.className = 'interactive-form-validation-status';

      // Find the button container to place status inline with Cancel
      const buttonContainer = commentBox.querySelector('.interactive-comment-buttons');
      if (buttonContainer) {
        // Insert at the beginning of button container (before Cancel)
        buttonContainer.insertBefore(statusElement, buttonContainer.firstChild);
      } else {
        // Fallback to content wrapper if no button container
        const contentWrapper = commentBox.querySelector('.interactive-comment-wrapper');
        if (contentWrapper) {
          contentWrapper.appendChild(statusElement);
        }
      }
    }

    // Update status based on state
    /* eslint-disable no-restricted-syntax -- Static status icons + sanitized hint via sanitizeDocumentationHTML */
    if (state === 'checking') {
      statusElement.className = 'interactive-form-validation-status form-checking';
      statusElement.innerHTML = '<span class="interactive-form-spinner">⟳</span> Checking...';
    } else if (state === 'valid') {
      statusElement.className = 'interactive-form-validation-status form-valid';
      statusElement.innerHTML = '<span class="interactive-form-success-icon">✓</span> Looks good!';
    } else if (state === 'invalid' && hint) {
      statusElement.className = 'interactive-form-validation-status form-hint-warning';
      statusElement.innerHTML = `<span class="interactive-form-warning-icon">⚠</span> ${sanitizeDocumentationHTML(hint)}`;
    }
    /* eslint-enable no-restricted-syntax */
  }

  private cleanupListeners(clearHighlights = false): void {
    for (const timeoutId of this.pendingTimeouts) {
      clearTimeout(timeoutId);
    }
    this.pendingTimeouts = [];
    for (const intervalId of this.pendingIntervals) {
      clearInterval(intervalId);
    }
    this.pendingIntervals = [];

    this.activeListeners.forEach(({ target, type, handler, options }) => {
      if (options) {
        target.removeEventListener(type, handler, options);
      } else {
        target.removeEventListener(type, handler);
      }
    });
    this.activeListeners = [];
    if (clearHighlights) {
      this.navigationManager.clearAllHighlights();
    }
  }
  cancel(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
    if (this.currentRunController) {
      this.currentRunController.abort();
      this.currentRunController = null;
    }
    try {
      this.cleanupListeners(true);
    } catch (error) {
      logger.error('Guided cleanup failed', { error });
    }
  }
}
