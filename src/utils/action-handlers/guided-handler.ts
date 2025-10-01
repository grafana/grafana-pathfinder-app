import { InteractiveStateManager } from '../interactive-state-manager';
import { NavigationManager } from '../navigation-manager';
import { InteractiveElementData } from '../../types/interactive.types';
import { querySelectorAllEnhanced } from '../enhanced-selector';
import { findButtonByText } from '../dom-utils';

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
      // Find target element using action-specific logic
      const targetElement = await this.findTargetElement(action.refTarget, action.targetAction);

      // Prepare element (scroll into view, open navigation if needed)
      await this.prepareElement(targetElement);

      // Highlight the target element with persistent highlight
      // Note: highlightTarget uses navigationManager.highlightWithComment which includes
      // the 300ms DOM settling delay after scroll
      await this.highlightTarget(targetElement, action.targetAction, stepIndex, totalSteps, action.targetComment);

      // Wait for user to complete the action
      const result = await this.waitForUserCompletion(action, targetElement, timeout);

      // Clean up highlight after completion
      this.removeHighlight(targetElement);

      return result;
    } catch (error) {
      console.error(`Guided step ${stepIndex + 1} failed:`, error);
      return 'cancelled';
    }
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
    await this.navigationManager.highlightWithComment(element, message);

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
   * Remove highlight from element
   */
  private removeHighlight(element: HTMLElement): void {
    element.classList.remove('interactive-guided-active');
    element.classList.remove('interactive-highlighted');
  }

  /**
   * Wait for user to complete the action with timeout
   */
  private async waitForUserCompletion(
    action: InternalAction,
    targetElement: HTMLElement,
    timeout: number
  ): Promise<CompletionResult> {
    // Create abort controller for cancellation
    this.currentAbortController = new AbortController();
    const signal = this.currentAbortController.signal;

    // Create completion promise based on action type
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
    const result = await Promise.race([completionPromise, timeoutPromise, cancellationPromise]);

    // Clean up listeners
    this.cleanupListeners();

    return result;
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
   */
  private async waitForHover(element: HTMLElement, signal: AbortSignal): Promise<CompletionResult> {
    return new Promise<CompletionResult>((resolve) => {
      let hoverTimeout: NodeJS.Timeout | null = null;
      const dwellTime = 500; // User must hover for 500ms

      const handleMouseEnter = () => {
        // Start dwell timer
        hoverTimeout = setTimeout(() => {
          resolve('completed');
        }, dwellTime);
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
   */
  private async waitForClick(
    element: HTMLElement,
    signal: AbortSignal,
    preventDefaultClick = false
  ): Promise<CompletionResult> {
    return new Promise<CompletionResult>((resolve) => {
      const elementRect = element.getBoundingClientRect();

      const handleClick = (event: Event) => {
        const mouseEvent = event as MouseEvent;

        // Check if click is within or near the highlighted element bounds
        // Add padding to make it more forgiving (matches highlight padding of 8px)
        const padding = 12; // Slightly larger than highlight padding for easier clicking
        const clickX = mouseEvent.clientX;
        const clickY = mouseEvent.clientY;

        const isWithinBounds =
          clickX >= elementRect.left - padding &&
          clickX <= elementRect.right + padding &&
          clickY >= elementRect.top - padding &&
          clickY <= elementRect.bottom + padding;

        if (isWithinBounds) {
          // For guided mode, we want to detect the click but NOT block it
          // The user should be able to actually interact with the button/element
          // We use non-capture phase and don't preventDefault to let click work normally
          resolve('completed');
        }
      };

      // Listen on document level but NOT in capture phase
      // This lets the click reach the target element first, then we detect it
      document.addEventListener('click', handleClick, { capture: false });

      // Store for cleanup
      this.activeListeners.push({ element: document.body as HTMLElement, type: 'click', handler: handleClick });

      // Handle cancellation
      signal.addEventListener('abort', () => {
        resolve('cancelled');
      });
    });
  }

  /**
   * Clean up all active event listeners
   */
  private cleanupListeners(): void {
    this.activeListeners.forEach(({ element, type, handler }) => {
      element.removeEventListener(type, handler as EventListener);
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
