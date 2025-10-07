import { InteractiveStateManager } from '../interactive-state-manager';
import { NavigationManager } from '../navigation-manager';
import { InteractiveElementData } from '../../types/interactive.types';
import { querySelectorAllEnhanced } from '../enhanced-selector';
import { findButtonByText } from '../dom-utils';
import { isElementVisible } from '../element-validator';

interface InternalAction {
  targetAction: 'hover' | 'button' | 'highlight';
  refTarget: string;
  targetValue?: string;
  requirements?: string;
  targetComment?: string; // Optional comment to display in tooltip during this step
}

type CompletionResult = 'completed' | 'timeout' | 'cancelled';

/**
 * Handler for guided interactions where users manually perform actions
 * System highlights elements and waits for user to complete actions naturally
 * Useful for hover-dependent UIs and teaching users actual interaction patterns
 */
export class GuidedHandler {
  private activeListeners: Array<{ element: HTMLElement; type: string; handler: EventListener }> = [];
  private currentAbortController: AbortController | null = null;

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
   * Execute a single guided step: highlight target and wait for user action
   * Returns true if user completed, false if timeout/cancelled
   */
  async executeGuidedStep(
    action: InternalAction,
    stepIndex: number,
    totalSteps: number,
    timeout = 30000
  ): Promise<CompletionResult> {
    try {
      // Find target element using action-specific logic with retry
      const targetElement = await this.findTargetElementWithRetry(
        action.refTarget,
        action.targetAction,
        timeout,
        2000 // Retry every 2 seconds
      );

      // Prepare element (scroll into view, open navigation if needed)
      await this.prepareElement(targetElement);

      // CRITICAL FIX: Attach listener BEFORE highlighting to avoid race condition
      // If we highlight first, fast users might click before the listener is ready
      const completionPromise = this.createCompletionListener(action, targetElement, timeout);

      // Now highlight the target element with persistent highlight
      // Note: highlightTarget uses navigationManager.highlightWithComment which includes
      // the 300ms DOM settling delay after scroll
      await this.highlightTarget(targetElement, action.targetAction, stepIndex, totalSteps, action.targetComment);

      // Wait for user to complete the action (listener already attached)
      const result = await completionPromise;

      // Don't remove highlight after completion - let it persist until next action
      // Highlights will be cleared when:
      // 1. Next guided step starts (highlightTarget calls navigationManager.highlightWithComment which clears all)
      // 2. User clicks close button on comment box
      // 3. Section execution completes

      return result;
    } catch (error) {
      console.error(`Guided step ${stepIndex + 1} failed:`, error);
      return 'cancelled';
    }
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
        if (attemptCount > 1) {
          console.warn(`✅ Element found after ${attemptCount} attempts (${Date.now() - startTime}ms)`);
        }
        return element;
      } catch (error) {
        const elapsed = Date.now() - startTime;
        const remaining = timeout - elapsed;

        if (remaining <= 0) {
          console.error(`❌ Element not found after ${attemptCount} attempts (${elapsed}ms): ${selector}`);
          throw error;
        }

        console.warn(
          `🔄 Element not found (attempt ${attemptCount}), retrying in ${retryInterval}ms... (${Math.round(remaining / 1000)}s remaining)`
        );

        // Wait before retrying, but don't exceed timeout
        await new Promise((resolve) => setTimeout(resolve, Math.min(retryInterval, remaining)));
      }
    }

    throw new Error(`Timeout finding element: ${selector}`);
  }

  /**
   * Find target element using action-specific logic
   * Buttons use findButtonByText, others use enhanced selector
   */
  private async findTargetElement(
    selector: string,
    actionType: 'hover' | 'button' | 'highlight'
  ): Promise<HTMLElement> {
    let targetElements: HTMLElement[];

    // For button actions, try button-specific finder first (handles text matching with HTML entities)
    if (actionType === 'button') {
      try {
        targetElements = findButtonByText(selector);
        if (targetElements.length > 0) {
          if (targetElements.length > 1) {
            console.warn(`Multiple buttons found matching text: ${selector}, using first button`);
          }
          return targetElements[0];
        }
      } catch (error) {
        // Fall through to enhanced selector
        console.warn(`findButtonByText failed for "${selector}", trying enhanced selector:`, error);
      }
    }

    // Fallback to enhanced selector for all action types
    const enhancedResult = querySelectorAllEnhanced(selector);
    targetElements = enhancedResult.elements;

    if (targetElements.length === 0) {
      throw new Error(`No elements found matching selector: ${selector}`);
    }

    if (targetElements.length > 1) {
      console.warn(`Multiple elements found matching selector: ${selector}, using first element`);
    }

    return targetElements[0];
  }

  /**
   * Prepare element for interaction (scroll, open navigation)
   */
  private async prepareElement(targetElement: HTMLElement): Promise<void> {
    // Validate visibility before interaction
    if (!isElementVisible(targetElement)) {
      console.warn('Target element is not visible:', targetElement);
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
    customComment?: string
  ): Promise<void> {
    // Use custom comment if provided, otherwise generate default message
    const message = customComment || this.getActionMessage(actionType, stepIndex, totalSteps);

    // Use existing highlight system with persistent highlight

    // Disable auto-cleanup for guided mode - highlights should only clear when step completes
    await this.navigationManager.highlightWithComment(element, message, false);

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
    const stepLabel = `Step ${stepIndex + 1}/${totalSteps}`;

    switch (actionType) {
      case 'hover':
        return `${stepLabel}: Hover your mouse over this element`;
      case 'button':
        return `${stepLabel}: Click this element`;
      case 'highlight':
        return `${stepLabel}: Click this element`;
      default:
        return `${stepLabel}: Interact with this element`;
    }
  }

  /**
   * Create completion listener and return promise that resolves when user completes action
   * Listener is attached immediately to avoid race condition with fast clicks
   */
  private createCompletionListener(
    action: InternalAction,
    targetElement: HTMLElement,
    timeout: number
  ): Promise<CompletionResult> {
    // Create abort controller for cancellation
    this.currentAbortController = new AbortController();
    const signal = this.currentAbortController.signal;

    // Create completion promise based on action type (listener attached immediately)
    const completionPromise = this.attachCompletionListener(action.targetAction, targetElement, signal);

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
      const dwellTime = 500; // User must hover for 500ms

      const startDwellTimer = () => {
        // Start dwell timer
        hoverTimeout = setTimeout(() => {
          resolve('completed');
        }, dwellTime);
      };

      const handleMouseEnter = () => {
        startDwellTimer();
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
        { element, type: 'mouseenter', handler: handleMouseEnter },
        { element, type: 'mouseleave', handler: handleMouseLeave }
      );

      // CRITICAL FIX: Check if mouse is already hovering over the element
      // If the element matches :hover pseudo-class, start the dwell timer immediately
      if (element.matches(':hover')) {
        startDwellTimer();
      }

      // Handle cancellation
      signal.addEventListener('abort', () => {
        if (hoverTimeout) {
          clearTimeout(hoverTimeout);
        }
        resolve('cancelled');
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
   */
  private async waitForClick(
    element: HTMLElement,
    signal: AbortSignal,
    preventDefaultClick = false
  ): Promise<CompletionResult> {
    return new Promise<CompletionResult>((resolve) => {
      // Periodically update rect for dynamic elements (like hover-revealed items)
      // This ensures we always have fresh bounds for click detection
      const rectUpdateInterval = setInterval(() => {
        // Just verify element is still connected - rect is recalculated on each click
        if (!element.isConnected) {
          clearInterval(rectUpdateInterval);
        }
      }, 100);

      const handleClick = (event: Event) => {
        const mouseEvent = event as MouseEvent;
        const clickedElement = mouseEvent.target as HTMLElement;

        // Primary check: Did user click the target element or something inside it?
        // This handles:
        // - Direct clicks on the element
        // - Clicks on child elements (like SVG icons inside buttons)
        // - Clicks on deeply nested elements
        const isTargetOrChild = element === clickedElement || element.contains(clickedElement);

        if (isTargetOrChild) {
          clearInterval(rectUpdateInterval);
          resolve('completed');
          return;
        }

        // Fallback check: Is click within slightly expanded bounds?
        // Marginally larger padding (16px) provides some forgiveness without being excessive
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
          clearInterval(rectUpdateInterval);
          // Click is within bounds - programmatically trigger click on target element
          // This helps when an overlay or SVG is blocking the actual element
          element.click();
          resolve('completed');
        }
      };

      // CRITICAL: Listen in CAPTURE PHASE to catch events before other handlers
      // This prevents issues where an SVG or overlay stops event propagation
      // We still let the event continue (don't preventDefault) so the actual click happens
      document.addEventListener('click', handleClick, { capture: true });

      // Store for cleanup
      this.activeListeners.push({
        element: document.body as HTMLElement,
        type: 'click',
        handler: handleClick,
      });

      // Handle cancellation
      signal.addEventListener('abort', () => {
        clearInterval(rectUpdateInterval);
        resolve('cancelled');
      });
    });
  }

  /**
   * Clean up all active event listeners
   */
  private cleanupListeners(): void {
    this.activeListeners.forEach(({ element, type, handler }) => {
      // Remove with capture: true for click events to match how they were added
      if (type === 'click') {
        element.removeEventListener(type, handler as EventListener, { capture: true });
      } else {
        element.removeEventListener(type, handler as EventListener);
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
