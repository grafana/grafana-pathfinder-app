import { InteractiveStateManager } from '../interactive-state-manager';
import { NavigationManager } from '../navigation-manager';
import { InteractiveElementData } from '../../types/interactive.types';
import { querySelectorAllEnhanced, findButtonByText, isElementVisible, resolveSelector } from '../../lib/dom';
import { isCssSelector } from '../../lib/dom/selector-detector';
import { GuidedAction } from '../../types/interactive-actions.types';
import { INTERACTIVE_CONFIG } from '../../constants/interactive-config';

type CompletionResult = 'completed' | 'timeout' | 'cancelled' | 'skipped';

/**
 * Handler for guided interactions where users manually perform actions
 * System highlights elements and waits for user to complete actions naturally
 * Useful for hover-dependent UIs and teaching users actual interaction patterns
 */
/**
 * Represents an active event listener that needs cleanup
 */
interface ActiveListener {
  target: EventTarget; // EventTarget instead of HTMLElement to support document listeners
  type: string;
  handler: EventListener;
  options?: AddEventListenerOptions;
}

export class GuidedHandler {
  private activeListeners: ActiveListener[] = [];
  private currentAbortController: AbortController | null = null;
  private completedSteps: number[] = []; // Track completed steps for progress display

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

  /**
   * Reset completed steps tracking (call before starting new guided sequence)
   */
  resetProgress(): void {
    this.completedSteps = [];
  }

  /**
   * Execute a single guided step: highlight target and wait for user action
   * Returns true if user completed, false if timeout/cancelled
   */
  async executeGuidedStep(
    action: GuidedAction,
    stepIndex: number,
    totalSteps: number,
    timeout: number = INTERACTIVE_CONFIG.guided.stepTimeout
  ): Promise<CompletionResult> {
    try {
      if (action.targetAction === 'noop') {
        return this.executeNoopStep(action, stepIndex, totalSteps, timeout);
      }

      // At this point, action is not noop, so refTarget must exist and targetAction is hover/button/highlight
      const refTarget = action.refTarget;
      const targetAction = action.targetAction as 'hover' | 'button' | 'highlight';

      if (!refTarget) {
        throw new Error(`Non-noop action ${targetAction} requires a refTarget`);
      }

      // Find target element using action-specific logic with retry
      const targetElement = await this.findTargetElementWithRetry(
        refTarget,
        targetAction,
        timeout,
        INTERACTIVE_CONFIG.guided.retryInterval
      );

      // Prepare element (scroll into view, open navigation if needed)
      await this.prepareElement(targetElement);

      // CRITICAL FIX: Attach listener BEFORE highlighting to avoid race condition
      // If we highlight first, fast users might click before the listener is ready
      const completionPromise = this.createCompletionListener(action, targetElement, timeout);

      // Create skip promise if step is skippable
      const skipPromise = action.isSkippable
        ? this.createSkipListener(stepIndex)
        : new Promise<CompletionResult>(() => {}); // Never resolves if not skippable

      // Create cancel promise - always available via comment box cancel button
      const cancelPromise = this.createCancelListener(stepIndex);

      // Now highlight the target element with persistent highlight
      // Note: highlightTarget uses navigationManager.highlightWithComment which includes
      // the 300ms DOM settling delay after scroll
      await this.highlightTarget(
        targetElement,
        targetAction,
        stepIndex,
        totalSteps,
        action.targetComment,
        action.isSkippable
      );

      // Wait for user to complete the action, skip, cancel, or timeout
      const result = await Promise.race([completionPromise, skipPromise, cancelPromise]);

      // Track completion for progress display (both completed and skipped count as done)
      if (result === 'completed' || result === 'skipped') {
        this.completedSteps.push(stepIndex);
      }

      // Don't remove highlight after completion - let it persist until next action
      // Highlights will be cleared when:
      // 1. Next guided step starts (highlightTarget calls navigationManager.highlightWithComment which clears all)
      // 2. User clicks close button on comment box
      // 3. Section execution completes

      return result;
    } catch (error) {
      console.error('[pathfinder]', `Guided step ${stepIndex + 1} failed:`, error);
      // Clean up abort controller and listeners on error to prevent resource leaks
      this.cancel();
      return 'cancelled';
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
    timeout: number
  ): Promise<CompletionResult> {
    this.currentAbortController = new AbortController();

    const skipPromise = action.isSkippable
      ? this.createSkipListener(stepIndex)
      : new Promise<CompletionResult>(() => {}); // Never resolves if not skippable

    const cancelPromise = this.createCancelListener(stepIndex);
    const completionPromise = this.createNoopCompletionListener(stepIndex, timeout);

    // Show comment box without highlighting any element
    // Use navigationManager to show a floating comment box
    await this.showNoopCommentBox(
      stepIndex,
      totalSteps,
      action.targetComment || 'Complete this step to continue',
      action.isSkippable
    );

    // Wait for user to complete, skip, cancel, or timeout
    const result = await Promise.race([completionPromise, skipPromise, cancelPromise]);

    // Track completion for progress display
    if (result === 'completed' || result === 'skipped') {
      this.completedSteps.push(stepIndex);
    }

    this.navigationManager.clearAllHighlights();

    return result;
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

      setTimeout(() => resolve('timeout'), timeout);
    });
  }

  /**
   * Show a comment box for noop steps (no element highlight)
   */
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
    textContainer.innerHTML = comment;

    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'interactive-comment-wrapper';
    contentWrapper.appendChild(logoContainer);
    contentWrapper.appendChild(textContainer);

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'interactive-comment-buttons';

    const continueButton = document.createElement('button');
    continueButton.className = 'interactive-comment-skip-btn'; // Reuse skip button styling
    continueButton.textContent = 'Continue →';
    continueButton.style.backgroundColor = '#3871dc'; // Primary color
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
   */
  private async findTargetElementWithRetry(
    selector: string,
    actionType: 'hover' | 'button' | 'highlight',
    timeout: number,
    retryInterval: number
  ): Promise<HTMLElement> {
    const startTime = Date.now();
    let attemptCount = 0;

    while (Date.now() - startTime < timeout) {
      attemptCount++;
      try {
        const element = await this.findTargetElement(selector, actionType);
        return element;
      } catch (error) {
        const elapsed = Date.now() - startTime;
        const remaining = timeout - elapsed;

        if (remaining <= 0) {
          console.error('[pathfinder]', `Element not found after ${attemptCount} attempts (${elapsed}ms): ${selector}`);
          throw error;
        }
        // Wait before retrying, but don't exceed timeout
        await new Promise((resolve) => setTimeout(resolve, Math.min(retryInterval, remaining)));
      }
    }

    throw new Error(`Timeout finding element: ${selector}`);
  }

  /**
   * Find target element using action-specific logic
   * Buttons support both CSS selectors and text matching with intelligent detection
   */
  private async findTargetElement(
    selector: string,
    actionType: 'hover' | 'button' | 'highlight'
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
              console.warn(
                '[pathfinder]',
                `Multiple buttons found matching selector: ${resolvedSelector}, using first button`
              );
            }
            return targetElements[0];
          }
        } catch (error) {
          console.warn(
            '[pathfinder]',
            `Button selector matching failed for "${resolvedSelector}", trying text match:`,
            error
          );
        }
      }

      // Fall back to text matching (existing behavior)
      try {
        targetElements = findButtonByText(resolvedSelector);
        if (targetElements.length > 0) {
          if (targetElements.length > 1) {
            console.warn(
              '[pathfinder]',
              `Multiple buttons found matching text: ${resolvedSelector}, using first button`
            );
          }
          return targetElements[0];
        }
      } catch (error) {
        // Fall through to enhanced selector as last resort
        console.warn(
          '[pathfinder]',
          `findButtonByText failed for "${resolvedSelector}", trying enhanced selector:`,
          error
        );
      }
    }

    // Fallback to enhanced selector for all action types
    const enhancedResult = querySelectorAllEnhanced(resolvedSelector);
    targetElements = enhancedResult.elements;

    if (targetElements.length === 0) {
      throw new Error(`No elements found matching selector: ${resolvedSelector}`);
    }

    if (targetElements.length > 1) {
      console.warn(
        '[pathfinder]',
        `Multiple elements found matching selector: ${resolvedSelector}, using first element`
      );
    }

    return targetElements[0];
  }

  /**
   * Prepare element for interaction (scroll, open navigation)
   */
  private async prepareElement(targetElement: HTMLElement): Promise<void> {
    // Validate visibility before interaction
    if (!isElementVisible(targetElement)) {
      console.warn('[pathfinder]', 'Target element is not visible:', targetElement);
      // Continue anyway (non-breaking)
    }

    await this.navigationManager.ensureNavigationOpen(targetElement);
    await this.navigationManager.ensureElementVisible(targetElement);
  }

  /**
   * Highlight target element with action-specific messaging
   */
  private async highlightTarget(
    element: HTMLElement,
    actionType: 'hover' | 'button' | 'highlight',
    stepIndex: number,
    totalSteps: number,
    customComment?: string,
    isSkippable?: boolean
  ): Promise<void> {
    // Use custom comment if provided, otherwise generate default message
    const message = customComment || this.getActionMessage(actionType, stepIndex, totalSteps);

    // Build step info for progress display in comment tooltip
    const stepInfo = {
      current: stepIndex,
      total: totalSteps,
      completedSteps: [...this.completedSteps], // Copy to avoid mutations
    };

    // Create skip callback if step is skippable
    const skipCallback = isSkippable
      ? () => {
          // Dispatch skip event when skip button is clicked
          const skipEvent = new CustomEvent('guided-step-skipped', {
            detail: { stepIndex },
          });
          document.dispatchEvent(skipEvent);
        }
      : undefined;

    // Create cancel callback - always available during guided execution
    const cancelCallback = () => {
      // Dispatch cancel event when cancel button is clicked
      const cancelEvent = new CustomEvent('guided-step-cancelled', {
        detail: { stepIndex },
      });
      document.dispatchEvent(cancelEvent);
    };

    // Use existing highlight system with persistent highlight
    // Disable auto-cleanup for guided mode - highlights should only clear when step completes
    await this.navigationManager.highlightWithComment(element, message, false, stepInfo, skipCallback, cancelCallback);

    // Add a persistent highlight class that won't auto-remove
    element.classList.add('interactive-guided-active');
  }

  /**
   * Generate user-friendly message for each action type
   */
  private getActionMessage(
    actionType: 'hover' | 'button' | 'highlight',
    stepIndex: number,
    totalSteps: number
  ): string {
    // Step number is now shown in checkbox list, so just show the instruction
    switch (actionType) {
      case 'hover':
        return 'Hover your mouse over this element';
      case 'button':
        return 'Click this element';
      case 'highlight':
        return 'Click this element';
      default:
        return 'Interact with this element';
    }
  }

  /**
   * Create completion listener and return promise that resolves when user completes action
   * Listener is attached immediately to avoid race condition with fast clicks
   */
  private createCompletionListener(
    action: GuidedAction,
    targetElement: HTMLElement,
    timeout: number
  ): Promise<CompletionResult> {
    // Create abort controller for cancellation
    this.currentAbortController = new AbortController();
    const signal = this.currentAbortController.signal;

    // Create completion promise based on action type (listener attached immediately)
    // Note: This method is only called for non-noop actions, so we can safely narrow the type
    const actionType = action.targetAction as 'hover' | 'button' | 'highlight';
    const completionPromise = this.attachCompletionListener(actionType, targetElement, signal);

    // Create timeout promise
    const timeoutPromise = new Promise<CompletionResult>((resolve) => {
      setTimeout(() => resolve('timeout'), timeout);
    });

    // Create cancellation promise
    const cancellationPromise = new Promise<CompletionResult>((resolve) => {
      signal.addEventListener('abort', () => resolve('cancelled'));
    });

    // Race between completion, timeout, and cancellation
    return Promise.race([completionPromise, timeoutPromise, cancellationPromise]).then((result) => {
      // Clean up listeners when promise resolves
      this.cleanupListeners();
      return result;
    });
  }

  /**
   * Create skip listener that resolves when user clicks skip button in comment box
   */
  private createSkipListener(stepIndex: number): Promise<CompletionResult> {
    return new Promise<CompletionResult>((resolve) => {
      const handleSkip = (event: Event) => {
        const customEvent = event as CustomEvent<{ stepIndex: number }>;
        if (customEvent.detail.stepIndex === stepIndex) {
          document.removeEventListener('guided-step-skipped', handleSkip);
          resolve('skipped');
        }
      };

      document.addEventListener('guided-step-skipped', handleSkip);
    });
  }

  /**
   * Create cancel listener that resolves when user clicks cancel button in comment box
   */
  private createCancelListener(stepIndex: number): Promise<CompletionResult> {
    return new Promise<CompletionResult>((resolve) => {
      const handleCancel = (event: Event) => {
        const customEvent = event as CustomEvent<{ stepIndex: number }>;
        if (customEvent.detail.stepIndex === stepIndex) {
          document.removeEventListener('guided-step-cancelled', handleCancel);
          // Clear highlights when cancelled from comment box
          this.navigationManager.clearAllHighlights();
          resolve('cancelled');
        }
      };

      document.addEventListener('guided-step-cancelled', handleCancel);
    });
  }

  /**
   * Attach completion listener based on action type
   */
  private async attachCompletionListener(
    actionType: 'hover' | 'button' | 'highlight',
    element: HTMLElement,
    signal: AbortSignal
  ): Promise<CompletionResult> {
    switch (actionType) {
      case 'hover':
        return this.waitForHover(element, signal);
      case 'button':
      case 'highlight':
        // For guided mode, ALWAYS let clicks pass through naturally
        // We just want to detect that the user clicked, not block the action
        return this.waitForClick(element, signal, false);
      default:
        throw new Error(`Unsupported guided action type: ${actionType}`);
    }
  }

  /**
   * Wait for user to hover over element and dwell for specified time
   * If mouse is already hovering, counts immediately
   */
  private async waitForHover(element: HTMLElement, signal: AbortSignal): Promise<CompletionResult> {
    return new Promise<CompletionResult>((resolve) => {
      let hoverTimeout: NodeJS.Timeout | null = null;
      let isResolved = false; // Prevent double resolution
      const dwellTime = INTERACTIVE_CONFIG.guided.hoverDwell;

      // Centralized cleanup function to clear timer and resolve
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
        // Clear any existing timer first
        if (hoverTimeout) {
          clearTimeout(hoverTimeout);
          hoverTimeout = null;
        }
        // Start dwell timer
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
        // Cancel dwell timer if user leaves too early
        if (hoverTimeout) {
          clearTimeout(hoverTimeout);
          hoverTimeout = null;
        }
      };

      // Attach listeners
      element.addEventListener('mouseenter', handleMouseEnter);
      element.addEventListener('mouseleave', handleMouseLeave);

      // Store for cleanup
      this.activeListeners.push(
        { target: element, type: 'mouseenter', handler: handleMouseEnter },
        { target: element, type: 'mouseleave', handler: handleMouseLeave }
      );

      // CRITICAL FIX: Check if mouse is already hovering over the element
      // If the element matches :hover pseudo-class, start the dwell timer immediately
      if (element.matches(':hover')) {
        startDwellTimer();
      }

      // Handle cancellation - uses centralized cleanup to ensure timer is cleared
      signal.addEventListener('abort', () => {
        cleanup('cancelled');
      });
    });
  }

  /**
   * Wait for user to click element or within its highlighted bounds
   * For guided mode, we detect clicks but let them pass through to the actual element
   *
   * IMPROVEMENTS:
   * - Slightly expanded click zone (16px padding) for better targeting
   * - Capture phase listening to catch events before they can be stopped
   * - Better SVG/nested element handling
   * - Fixed listener cleanup bug (was attaching to document but cleaning up from document.body)
   * - Centralized cleanup to prevent resource leaks
   */
  private async waitForClick(
    element: HTMLElement,
    signal: AbortSignal,
    preventDefaultClick = false
  ): Promise<CompletionResult> {
    return new Promise<CompletionResult>((resolve) => {
      let isResolved = false; // Prevent double resolution
      let rectUpdateInterval: NodeJS.Timeout | null = null;

      // Centralized cleanup function to clear interval and resolve
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

      // Periodically verify element is still connected
      rectUpdateInterval = setInterval(() => {
        if (!element.isConnected) {
          cleanup('cancelled');
        }
      }, INTERACTIVE_CONFIG.guided.connectivityCheckInterval);

      const handleClick = (event: Event) => {
        // Prevent double resolution
        if (isResolved) {
          return;
        }

        const mouseEvent = event as MouseEvent;
        const clickedElement = mouseEvent.target as HTMLElement;

        // Primary check: Did user click the target element or something inside it?
        // This handles:
        // - Direct clicks on the element
        // - Clicks on child elements (like SVG icons inside buttons)
        // - Clicks on deeply nested elements
        const isTargetOrChild = element === clickedElement || element.contains(clickedElement);

        if (isTargetOrChild) {
          cleanup('completed');
          return;
        }

        // Fallback check: Is click within slightly expanded bounds?
        // Recalculate rect on each click to handle dynamic/hover-revealed elements
        const elementRect = element.getBoundingClientRect();
        const padding = 16; // Slightly increased from 12px for better targeting
        const clickX = mouseEvent.clientX;
        const clickY = mouseEvent.clientY;

        const isWithinBounds =
          clickX >= elementRect.left - padding &&
          clickX <= elementRect.right + padding &&
          clickY >= elementRect.top - padding &&
          clickY <= elementRect.bottom + padding;

        if (isWithinBounds) {
          // Click is within bounds - programmatically trigger click on target element
          // This helps when an overlay or SVG is blocking the actual element
          // SAFETY: Only click if element is still connected to DOM (avoid "form not connected" errors)
          if (element.isConnected) {
            element.click();
          }
          cleanup('completed');
        }
      };

      // CRITICAL: Listen in CAPTURE PHASE to catch events before other handlers
      // This prevents issues where an SVG or overlay stops event propagation
      // We still let the event continue (don't preventDefault) so the actual click happens
      document.addEventListener('click', handleClick, { capture: true });

      // Store for cleanup - using EventTarget type so no cast needed
      this.activeListeners.push({
        target: document,
        type: 'click',
        handler: handleClick,
        options: { capture: true },
      });

      // Handle cancellation - uses centralized cleanup to ensure interval is cleared
      signal.addEventListener('abort', () => {
        cleanup('cancelled');
      });
    });
  }

  /**
   * Clean up all active event listeners
   */
  private cleanupListeners(): void {
    this.activeListeners.forEach(({ target, type, handler, options }) => {
      // Use stored options if available, otherwise no options
      if (options) {
        target.removeEventListener(type, handler, options);
      } else {
        target.removeEventListener(type, handler);
      }
    });
    this.activeListeners = [];
  }

  /**
   * Cancel current guided step
   */
  cancel(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
    this.cleanupListeners();
  }
}
