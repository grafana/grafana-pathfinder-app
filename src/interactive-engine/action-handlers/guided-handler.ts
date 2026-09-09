import { InteractiveStateManager } from '../interactive-state-manager';
import { NavigationManager, type CommentBoxStepInfo } from '../navigation-manager';
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
import { GuidedAction, GuidedStepOptions } from '../../types/interactive-actions.types';
import { getGuidedStepTimeout, INTERACTIVE_CONFIG } from '../../constants/interactive-config';
import { conditionTokens } from '../../lib/condition-input';
import { assertExhaustive } from '../../lib/assert-exhaustive';
import { sanitizeDocumentationHTML } from '../../security/html-sanitizer';
import { matchFormValue } from '../auto-completion/action-matcher';
import { applyE2ECommentBoxAttributes } from '../e2e-attributes';
import { commentForTargetState } from './toggle-click';

export type { CompletionResult };

interface ActiveListener {
  target: EventTarget;
  type: string;
  handler: EventListener;
  options?: AddEventListenerOptions;
}

interface GuidedStepArbiter {
  promise: Promise<CompletionResult>;
  settle: (result: CompletionResult) => CompletionResult;
  getResult: () => CompletionResult | null;
  isActive: () => boolean;
}

interface GuidedStepContext {
  arbiter: GuidedStepArbiter;
  signal: AbortSignal;
  deadline: number;
  lazyScrollAttempted: boolean;
  navigationExpanded: boolean;
}

export class GuidedHandler {
  private activeListeners: ActiveListener[] = [];
  private pendingTimeouts: Array<ReturnType<typeof setTimeout>> = [];
  private pendingIntervals: Array<ReturnType<typeof setInterval>> = [];
  private currentAbortController: AbortController | null = null;
  private completedSteps: number[] = [];

  constructor(
    private stateManager: InteractiveStateManager,
    private navigationManager: NavigationManager,
    private waitForReactUpdates: () => Promise<void>
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

  resetProgress(): void {
    this.completedSteps = [];
  }
  async executeGuidedStep(
    action: GuidedAction,
    stepIndex: number,
    totalSteps: number,
    timeout?: number,
    onActionCompleted?: () => void,
    options: GuidedStepOptions = {}
  ): Promise<CompletionResult> {
    const effectiveTimeout = getGuidedStepTimeout(timeout);
    return withFaroUserAction(
      createInteractionName(UserInteraction.DoItButtonClick),
      {
        target_action: action.targetAction,
        ref_target: action.refTarget ?? '',
        step_index: stepIndex,
        total_steps: totalSteps,
      },
      () => this.runGuidedStep(action, stepIndex, totalSteps, effectiveTimeout, onActionCompleted, options),
      // Internal waits are bounded by `timeout`; the margin only catches a hung step.
      effectiveTimeout + 10_000,
      { critical: true, outcomeFrom: outcomeFromCompletionResult }
    );
  }

  private createGuidedStepArbiter(
    action: GuidedAction,
    stepIndex: number,
    startedAt: number,
    deadline: number,
    controller: AbortController,
    options: GuidedStepOptions,
    onActionCompleted?: () => void
  ): GuidedStepArbiter {
    let result: CompletionResult | null = null;
    let resolvePromise!: (result: CompletionResult) => void;
    const promise = new Promise<CompletionResult>((resolve) => {
      resolvePromise = resolve;
    });
    const publish = (status: CompletionResult) => {
      options.onSettled?.({
        index: stepIndex,
        action: action.targetAction,
        status,
        durationMs: Math.max(0, Date.now() - startedAt),
      });
    };
    const settle = (nextResult: CompletionResult): CompletionResult => {
      if (result !== null) {
        return result;
      }
      result = Date.now() >= deadline ? 'timeout' : nextResult;
      controller.abort();
      try {
        // Publish before a completion callback can detach the guided root.
        publish(result);
        if (result === 'completed') {
          onActionCompleted?.();
        }
      } catch (error) {
        logger.error('Guided settlement callback failed', { error });
        result = 'error';
        try {
          publish(result);
        } catch (publishError) {
          logger.error('Guided error publication failed', { error: publishError });
        }
      }
      resolvePromise(result);
      return result;
    };

    return {
      promise,
      settle,
      getResult: () => result,
      isActive: () => {
        if (result === null && (controller.signal.aborted || Date.now() >= deadline)) {
          settle(controller.signal.aborted ? 'cancelled' : 'timeout');
        }
        return result === null;
      },
    };
  }

  private async runGuidedStep(
    action: GuidedAction,
    stepIndex: number,
    totalSteps: number,
    timeout: number,
    onActionCompleted: (() => void) | undefined,
    options: GuidedStepOptions
  ): Promise<CompletionResult> {
    this.currentAbortController?.abort();
    this.cleanupListeners();
    const controller = new AbortController();
    this.currentAbortController = controller;
    const startedAt = Date.now();
    const deadline = startedAt + timeout;
    const arbiter = this.createGuidedStepArbiter(
      action,
      stepIndex,
      startedAt,
      deadline,
      controller,
      options,
      onActionCompleted
    );
    const context: GuidedStepContext = {
      arbiter,
      signal: controller.signal,
      deadline,
      lazyScrollAttempted: false,
      navigationExpanded: false,
    };
    const handleAbort = () => {
      arbiter.settle('cancelled');
    };
    controller.signal.addEventListener('abort', handleAbort, { once: true });
    this.activeListeners.push({ target: controller.signal, type: 'abort', handler: handleAbort });
    this.pendingTimeouts.push(setTimeout(() => arbiter.settle('timeout'), timeout));
    if (action.isSkippable) {
      this.createSkipListener(stepIndex, arbiter);
    }
    this.createCancelListener(stepIndex, arbiter);
    void this.prepareGuidedStep(action, stepIndex, totalSteps, context, options).catch((error) => {
      if (arbiter.isActive()) {
        logger.error(`Guided step ${stepIndex + 1} failed`, { error });
        arbiter.settle('error');
      } else if (arbiter.getResult() === 'completed') {
        logger.warn(`Guided step ${stepIndex + 1} settled before setup failed`, { error });
      }
    });

    const result = await arbiter.promise;
    if (this.currentAbortController === controller) {
      this.currentAbortController = null;
      try {
        this.cleanupListeners(true);
      } catch (error) {
        logger.error('Guided cleanup failed', { error });
      }
    }
    if ((result === 'completed' || result === 'skipped') && !this.completedSteps.includes(stepIndex)) {
      this.completedSteps.push(stepIndex);
    }
    return result;
  }

  private async prepareGuidedStep(
    action: GuidedAction,
    stepIndex: number,
    totalSteps: number,
    context: GuidedStepContext,
    options: GuidedStepOptions
  ): Promise<void> {
    const { arbiter, signal } = context;
    if (!(await this.checkStepRequirements(action, context, options)) || !arbiter.isActive()) {
      return;
    }
    if (action.targetAction === 'noop') {
      this.createNoopCompletionListener(stepIndex, arbiter);
      this.showNoopCommentBox(
        stepIndex,
        totalSteps,
        action.targetComment || 'Complete this step to continue',
        action.isSkippable
      );
      return;
    }
    if (!action.refTarget) {
      throw new Error(`Non-noop action ${action.targetAction} requires a refTarget`);
    }
    await this.expandNavigationParentIfNeeded(action.refTarget, context);
    if (!arbiter.isActive()) {
      return;
    }
    const targetElement = await this.findTargetElementWithRetry(action, context);
    if (!targetElement || !arbiter.isActive()) {
      return;
    }
    await this.prepareElement(targetElement, context);
    if (!arbiter.isActive()) {
      return;
    }
    const targetState = parseTargetState(action.targetState);
    const alreadySatisfied =
      (action.targetAction === 'button' || action.targetAction === 'highlight') &&
      targetState !== null &&
      satisfiesTargetState(resolveStateSource(targetElement, targetState), targetState) === true;

    // Attach before highlighting so click activation cannot beat the listener.
    if (!alreadySatisfied) {
      this.createCompletionListener(action, targetElement, signal, arbiter);
    }
    if (!arbiter.isActive()) {
      return;
    }
    await this.highlightTarget(
      targetElement,
      action.targetAction,
      stepIndex,
      totalSteps,
      context,
      commentForTargetState(action.targetComment, targetElement, action.targetState),
      action.isSkippable,
      action.targetValue,
      action.refTarget
    );
    if (alreadySatisfied && arbiter.isActive()) {
      arbiter.settle('completed');
    }
  }

  private createNoopCompletionListener(stepIndex: number, arbiter: GuidedStepArbiter): void {
    const handleContinue = (event: Event) => {
      const customEvent = event as CustomEvent<{ stepIndex: number }>;
      if (customEvent.detail?.stepIndex === stepIndex) {
        arbiter.settle('completed');
      }
    };
    document.addEventListener('guided-noop-continue', handleContinue);
    this.activeListeners.push({
      target: document,
      type: 'guided-noop-continue',
      handler: handleContinue,
    });
  }

  private showNoopCommentBox(stepIndex: number, totalSteps: number, comment: string, isSkippable?: boolean): void {
    this.navigationManager.clearAllHighlights();

    const commentBox = document.createElement('div');
    commentBox.className = 'interactive-comment-box';
    commentBox.setAttribute('data-position', 'center');
    commentBox.setAttribute('data-ready', 'true');
    commentBox.setAttribute('data-noop', 'true');

    applyE2ECommentBoxAttributes(commentBox, {
      actionType: 'noop',
      substepIndex: stepIndex,
      substepSkippable: isSkippable === true,
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

  private async checkStepRequirements(
    action: GuidedAction,
    context: GuidedStepContext,
    options: GuidedStepOptions
  ): Promise<boolean> {
    if (conditionTokens(action.requirements).length === 0) {
      return true;
    }
    if (!options.checkRequirements) {
      throw new Error('Guided requirements need an injected checker');
    }
    const { arbiter } = context;
    while (arbiter.isActive()) {
      const result = await options.checkRequirements(action);
      if (!arbiter.isActive()) {
        return false;
      }
      if (result.pass) {
        return true;
      }
      const failures = result.error.filter((check) => !check.pass);
      const onlyTargetFixes =
        failures.length > 0 &&
        failures.every(
          (check) =>
            check.requirement === 'exists-reftarget' &&
            check.canFix &&
            (check.fixType === 'lazy-scroll' || check.fixType === 'expand-parent-navigation')
        );
      if (onlyTargetFixes && action.targetAction !== 'noop' && action.refTarget) {
        const navigationFix = failures.find((check) => check.fixType === 'expand-parent-navigation');
        if (navigationFix?.targetHref && !context.navigationExpanded) {
          context.navigationExpanded = true;
          await this.navigationManager.expandParentNavigationSection(navigationFix.targetHref, context.signal);
          continue;
        }
        const lazyFix = failures.find((check) => check.fixType === 'lazy-scroll');
        if (lazyFix && action.lazyRender && !context.lazyScrollAttempted) {
          await this.discoverLazyTarget(action, context, lazyFix.scrollContainer);
          continue;
        }
      }
      if (action.isSkippable) {
        arbiter.settle('skipped');
        return false;
      }
      await this.waitForRetry(context);
    }
    return false;
  }

  private async findTargetElementWithRetry(
    action: GuidedAction,
    context: GuidedStepContext
  ): Promise<HTMLElement | null> {
    if (action.targetAction === 'noop' || !action.refTarget) {
      return null;
    }
    const { arbiter } = context;
    while (arbiter.isActive()) {
      try {
        return this.findTargetElement(action.refTarget, action.targetAction);
      } catch {
        if (action.lazyRender && !context.lazyScrollAttempted) {
          await this.discoverLazyTarget(action, context);
          continue;
        }
        if (action.isSkippable) {
          arbiter.settle('skipped');
          return null;
        }
        await this.waitForRetry(context);
      }
    }
    return null;
  }

  private async discoverLazyTarget(
    action: GuidedAction,
    context: GuidedStepContext,
    scrollContainer?: string
  ): Promise<void> {
    if (!action.refTarget || context.lazyScrollAttempted || !context.arbiter.isActive()) {
      return;
    }
    context.lazyScrollAttempted = true;
    await scrollUntilElementFound(action.refTarget, {
      scrollContainerSelector: scrollContainer ?? action.scrollContainer,
      signal: context.signal,
      deadline: context.deadline,
    });
  }

  private waitForRetry(context: GuidedStepContext): Promise<void> {
    if (!context.arbiter.isActive()) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        context.signal.removeEventListener('abort', finish);
        resolve();
      };
      const timer = setTimeout(
        finish,
        Math.min(INTERACTIVE_CONFIG.guided.retryInterval, Math.max(0, context.deadline - Date.now()))
      );
      context.signal.addEventListener('abort', finish, { once: true });
      if (context.signal.aborted) {
        finish();
      }
    });
  }

  private async expandNavigationParentIfNeeded(selector: string, context: GuidedStepContext): Promise<void> {
    const targetHref = this.getNavigationTargetHref(selector);
    if (!targetHref || context.navigationExpanded || !context.arbiter.isActive()) {
      return;
    }
    context.navigationExpanded = true;
    await this.navigationManager.expandParentNavigationSection(targetHref, context.signal);
  }

  private getNavigationTargetHref(selector: string): string | undefined {
    const resolvedSelector = resolveSelector(selector);
    const navigationMenuItemMatch = resolvedSelector.match(
      /a\[data-testid=['"]data-testid Nav menu item['"]\]\[href=['"]([^'"]+)['"]\]/
    );

    return navigationMenuItemMatch?.[1];
  }

  private findTargetElement(selector: string, actionType: 'hover' | 'button' | 'highlight' | 'formfill'): HTMLElement {
    let targetElements: HTMLElement[];

    const resolvedSelector = resolveSelector(selector);

    if (actionType === 'button') {
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

      try {
        targetElements = findButtonByText(resolvedSelector);
        if (targetElements.length > 0) {
          if (targetElements.length > 1) {
            logger.warn(`Multiple buttons found matching text: ${resolvedSelector}, using first button`);
          }
          return targetElements[0]!;
        }
      } catch (error) {
        logger.warn(`findButtonByText failed for "${resolvedSelector}", trying enhanced selector`, { error });
      }
    }

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

      const container = enhancedResult.elements[0];
      if (container) {
        const nestedInput = container.querySelector('input:not([type="hidden"]), textarea, select');
        if (nestedInput instanceof HTMLElement) {
          return nestedInput;
        }
      }
    }

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

  private async prepareElement(targetElement: HTMLElement, context: GuidedStepContext): Promise<void> {
    if (!context.arbiter.isActive()) {
      return;
    }
    if (!isElementVisible(targetElement)) {
      logger.warn('Target element is not visible', { targetElement: describeElement(targetElement) });
    }

    await this.navigationManager.ensureNavigationOpen(targetElement, context.signal);
    if (!context.arbiter.isActive()) {
      return;
    }
    await this.navigationManager.ensureElementVisible(targetElement, context.signal);
  }
  private async highlightTarget(
    element: HTMLElement,
    actionType: 'hover' | 'button' | 'highlight' | 'formfill',
    stepIndex: number,
    totalSteps: number,
    context: GuidedStepContext,
    customComment?: string,
    isSkippable?: boolean,
    targetValue?: string,
    refTarget?: string
  ): Promise<void> {
    if (!context.arbiter.isActive()) {
      return;
    }
    const message = customComment || this.getActionMessage(actionType);
    const stepInfo: CommentBoxStepInfo = {
      current: stepIndex,
      total: totalSteps,
      completedSteps: [...this.completedSteps],
      progress: 'performed',
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
        substepIndex: stepIndex,
        substepSkippable: isSkippable === true,
        signal: context.signal,
      }
    );

    if (context.arbiter.isActive()) {
      element.classList.add('interactive-guided-active');
    }
  }

  private getActionMessage(actionType: 'hover' | 'button' | 'highlight' | 'formfill'): string {
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
        assertExhaustive(actionType);
        return 'Interact with this element';
    }
  }

  private createCompletionListener(
    action: GuidedAction,
    targetElement: HTMLElement,
    signal: AbortSignal,
    arbiter: GuidedStepArbiter
  ): void {
    if (action.targetAction === 'noop' || !arbiter.isActive()) {
      return;
    }

    const completionPromise = this.attachCompletionListener(
      action.targetAction,
      targetElement,
      signal,
      arbiter,
      action.targetValue,
      action.formHint,
      action.validateInput
    );
    void completionPromise.then(
      (result) => arbiter.settle(result),
      (error) => {
        logger.error('Guided completion listener failed', { error });
        arbiter.settle('error');
      }
    );
  }

  private createSkipListener(stepIndex: number, arbiter: GuidedStepArbiter): void {
    const handleSkip = (event: Event) => {
      const customEvent = event as CustomEvent<{ stepIndex: number }>;
      if (customEvent.detail?.stepIndex === stepIndex) {
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
      if (customEvent.detail?.stepIndex === stepIndex) {
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
    validateInput?: boolean
  ): Promise<CompletionResult> {
    switch (actionType) {
      case 'hover':
        return this.waitForHover(element, signal, arbiter);
      case 'button':
      case 'highlight':
        return this.waitForClick(element, signal, arbiter);
      case 'formfill':
        return this.waitForFormfill(element, signal, arbiter, targetValue, formHint, validateInput);
      default:
        assertExhaustive(actionType);
        throw new Error(`Unsupported guided action type: ${actionType}`);
    }
  }

  private async waitForHover(
    element: HTMLElement,
    signal: AbortSignal,
    arbiter: GuidedStepArbiter
  ): Promise<CompletionResult> {
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
        resolve(arbiter.settle(result));
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
        if (!isResolved && arbiter.isActive()) {
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

      if (arbiter.isActive() && element.matches(':hover')) {
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
    arbiter: GuidedStepArbiter
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
        resolve(arbiter.settle(result));
      };
      const complete = () => {
        if (isResolved) {
          return;
        }
        cleanup('completed');
      };
      rectUpdateInterval = setInterval(() => {
        if (!element.isConnected) {
          cleanup('cancelled');
        }
      }, INTERACTIVE_CONFIG.guided.connectivityCheckInterval);
      this.pendingIntervals.push(rectUpdateInterval);

      const handleClick = (event: Event) => {
        if (isResolved || !arbiter.isActive()) {
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
          if (element.isConnected && arbiter.isActive()) {
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

  private async waitForFormfill(
    element: HTMLElement,
    signal: AbortSignal,
    arbiter: GuidedStepArbiter,
    targetValue?: string,
    formHint?: string,
    validateInput?: boolean
  ): Promise<CompletionResult> {
    return new Promise<CompletionResult>((resolve) => {
      let isResolved = false;
      let debounceTimer: NodeJS.Timeout | undefined;
      let successTimer: NodeJS.Timeout | undefined;
      const DEBOUNCE_DELAY = 2000;
      const SUCCESS_ANIMATION_DELAY = 800;

      const cleanup = (result: CompletionResult) => {
        if (isResolved) {
          return;
        }
        isResolved = true;
        clearTimeout(debounceTimer);
        clearTimeout(successTimer);
        resolve(arbiter.settle(result));
      };
      signal.addEventListener('abort', () => cleanup('cancelled'), { once: true });
      if (!arbiter.isActive()) {
        cleanup('cancelled');
        return;
      }

      const getElementValue = (): string => {
        if (
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
        ) {
          return element.value;
        }
        return element.textContent || '';
      };
      const showSuccessAndComplete = () => {
        if (isResolved || !arbiter.isActive()) {
          return;
        }
        this.updateFormValidationFeedback(element, 'valid');
        clearTimeout(successTimer);
        successTimer = setTimeout(() => cleanup('completed'), SUCCESS_ANIMATION_DELAY);
      };
      const validateValue = () => {
        if (isResolved || !arbiter.isActive()) {
          return;
        }
        const currentValue = getElementValue();
        this.clearFormValidationFeedback();
        if (validateInput !== true || !targetValue) {
          if (currentValue.trim() !== '') {
            showSuccessAndComplete();
          }
          return;
        }
        this.updateFormValidationFeedback(element, 'checking');
        const matchResult = matchFormValue(currentValue, targetValue);
        if (matchResult.isMatch) {
          showSuccessAndComplete();
        } else {
          this.updateFormValidationFeedback(element, 'invalid', formHint || `Expected: ${matchResult.expectedPattern}`);
        }
      };
      const handleInput = () => {
        if (isResolved || !arbiter.isActive()) {
          return;
        }
        clearTimeout(debounceTimer);
        clearTimeout(successTimer);
        this.updateFormValidationFeedback(element, 'checking');
        debounceTimer = setTimeout(validateValue, DEBOUNCE_DELAY);
      };
      element.addEventListener('input', handleInput);
      element.addEventListener('change', handleInput);
      this.activeListeners.push(
        { target: element, type: 'input', handler: handleInput },
        { target: element, type: 'change', handler: handleInput }
      );

      element.focus();
      if (!arbiter.isActive()) {
        return;
      }
      const initialValue = getElementValue();
      if (
        initialValue.trim() !== '' &&
        (validateInput !== true || (targetValue && matchFormValue(initialValue, targetValue).isMatch))
      ) {
        showSuccessAndComplete();
      }
    });
  }

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
    try {
      this.cleanupListeners(true);
    } catch (error) {
      logger.error('Guided cleanup failed', { error });
    }
  }
}
