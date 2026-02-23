import { InteractiveStateManager } from '../interactive-state-manager';
import { NavigationManager } from '../navigation-manager';
import { InteractiveElementData } from '../../types/interactive.types';
import { INTERACTIVE_CONFIG } from '../../constants/interactive-config';
import { querySelectorAllEnhanced, isElementVisible, resolveSelector } from '../../lib/dom';

/**
 * Handler for hover actions that simulate mouse hover to trigger CSS :hover states
 * Useful for revealing hover-dependent UI elements before interacting with them
 */
export class HoverHandler {
  constructor(
    private stateManager: InteractiveStateManager,
    private navigationManager: NavigationManager,
    private waitForReactUpdates: () => Promise<void>
  ) {}

  async execute(data: InteractiveElementData, performHover: boolean): Promise<void> {
    this.stateManager.setState(data, 'running');

    try {
      const targetElement = await this.findTargetElement(data.reftarget);
      await this.prepareElement(targetElement);

      if (!performHover) {
        await this.handleShowMode(targetElement, data.targetcomment);
        await this.markAsCompleted(data);
        return;
      }

      await this.handleDoMode(targetElement);
      await this.markAsCompleted(data);
    } catch (error) {
      this.stateManager.handleError(error as Error, 'HoverHandler', data, false);
    }
  }

  private async findTargetElement(selector: string): Promise<HTMLElement> {
    // Resolve grafana: prefix if present
    const resolvedSelector = resolveSelector(selector);

    const enhancedResult = querySelectorAllEnhanced(resolvedSelector);
    const targetElements = enhancedResult.elements;

    if (targetElements.length === 0) {
      throw new Error(`No elements found matching selector: ${resolvedSelector}`);
    }

    if (targetElements.length > 1) {
      console.warn(`Multiple elements found matching selector: ${resolvedSelector}, using first element`);
    }

    return targetElements[0]!;
  }

  private async prepareElement(targetElement: HTMLElement): Promise<void> {
    // Validate visibility before interaction
    if (!isElementVisible(targetElement)) {
      console.warn('Target element is not visible:', targetElement);
      // Continue anyway (non-breaking)
    }

    await this.navigationManager.ensureNavigationOpen(targetElement);
    await this.navigationManager.ensureElementVisible(targetElement);
  }

  private async handleShowMode(targetElement: HTMLElement, comment?: string): Promise<void> {
    // Show mode: highlight the element that will be hovered
    await this.navigationManager.highlightWithComment(targetElement, comment);
  }

  private async handleDoMode(targetElement: HTMLElement): Promise<void> {
    // Clear any existing highlights before performing action
    this.navigationManager.clearAllHighlights();

    // CRITICAL: JavaScript events don't trigger CSS :hover pseudo-classes
    // We need to programmatically apply hover styles for frameworks like Tailwind
    this.applyProgrammaticHoverState(targetElement);

    // Also dispatch hover events for JavaScript event listeners
    this.dispatchHoverEvents(targetElement);

    // If element is focusable (has tabindex), also focus it
    // This triggers tooltips and other focus-based interactions
    if (
      targetElement.hasAttribute('tabindex') ||
      targetElement instanceof HTMLInputElement ||
      targetElement instanceof HTMLButtonElement ||
      targetElement instanceof HTMLAnchorElement
    ) {
      try {
        targetElement.focus();
      } catch (error) {
        // Ignore focus errors - element might not be focusable despite attributes
      }
    }

    // Maintain hover state for configured duration
    await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.perceptual.hover));

    // Note: We intentionally don't remove hover state to keep elements visible
    // This allows subsequent actions to interact with hover-revealed elements
    // The hover state persists until explicitly cleaned up or page changes
  }

  /**
   * Programmatically apply hover state to trigger CSS-based hover effects
   * Since JavaScript events don't trigger CSS :hover, we need to manually apply styles
   * This handles Tailwind's group-hover pattern and similar CSS-based hover mechanics
   */
  private applyProgrammaticHoverState(element: HTMLElement): void {
    // Add a data attribute to track that we've applied hover state
    element.setAttribute('data-interactive-hover', 'true');

    // For Tailwind's group pattern: find all children with group-hover classes
    // and manually apply the hover styles
    const groupHoverElements = element.querySelectorAll('[class*="group-hover:"]');

    groupHoverElements.forEach((child) => {
      const classList = Array.from(child.classList);

      classList.forEach((className) => {
        if (className.startsWith('group-hover:')) {
          // Extract the actual style class (e.g., "flex" from "group-hover:flex")
          const hoverClass = className.replace('group-hover:', '');

          // Apply the hover class directly
          child.classList.add(hoverClass);

          // Track which classes we added for potential cleanup
          const addedClasses = child.getAttribute('data-interactive-added-classes') || '';
          child.setAttribute(
            'data-interactive-added-classes',
            addedClasses ? `${addedClasses},${hoverClass}` : hoverClass
          );
        }
      });

      // Also handle group-hover utility classes that hide elements (like group-hover:hidden)
      // We need to remove conflicting base classes
      if (
        child.classList.contains('hidden') &&
        classList.some((c) => c.includes('group-hover:flex') || c.includes('group-hover:block'))
      ) {
        child.classList.remove('hidden');
        child.setAttribute('data-interactive-removed-hidden', 'true');
      }
    });
  }

  /**
   * Dispatch mouse events to trigger JavaScript event listeners
   * Note: These events do NOT trigger CSS :hover pseudo-classes
   * Includes mouseenter, mouseover, and mousemove for maximum compatibility
   */
  private dispatchHoverEvents(element: HTMLElement): void {
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;

    const eventOptions = {
      view: window,
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
    };

    // Dispatch events in the order they naturally occur
    const events = ['mouseenter', 'mouseover', 'mousemove'];
    events.forEach((eventType) => {
      const event = new MouseEvent(eventType, eventOptions);
      element.dispatchEvent(event);
    });
  }

  /**
   * Remove programmatically applied hover state
   * Currently unused - we keep hover state active for subsequent interactions
   * Reserved for future use if hover cleanup is needed
   */
  // @ts-ignore - Reserved for future use

  private removeProgrammaticHoverState(element: HTMLElement): void {
    element.removeAttribute('data-interactive-hover');

    const groupHoverElements = element.querySelectorAll('[data-interactive-added-classes]');

    groupHoverElements.forEach((child) => {
      const addedClasses = child.getAttribute('data-interactive-added-classes');
      if (addedClasses) {
        addedClasses.split(',').forEach((className) => {
          child.classList.remove(className);
        });
        child.removeAttribute('data-interactive-added-classes');
      }

      if (child.getAttribute('data-interactive-removed-hidden') === 'true') {
        child.classList.add('hidden');
        child.removeAttribute('data-interactive-removed-hidden');
      }
    });
  }

  /**
   * Dispatch mouse events to remove hover state
   * Currently unused - we keep hover state active for subsequent interactions
   * Reserved for future use if hover cleanup is needed
   */
  // @ts-ignore - Reserved for future use

  private dispatchUnhoverEvents(element: HTMLElement): void {
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;

    const eventOptions = {
      view: window,
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
    };

    // Dispatch events in the order they naturally occur
    const events = ['mouseleave', 'mouseout'];
    events.forEach((eventType) => {
      const event = new MouseEvent(eventType, eventOptions);
      element.dispatchEvent(event);
    });
  }

  private async markAsCompleted(data: InteractiveElementData): Promise<void> {
    // Wait for React to process all hover events and state updates
    await this.waitForReactUpdates();

    // Additional settling time for React state propagation and reactive checks
    // This ensures the sequential requirements system has time to unlock the next step
    await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.debouncing.reactiveCheck));

    // Mark as completed after state has settled
    this.stateManager.setState(data, 'completed');

    // Final wait to ensure completion state propagates
    await this.waitForReactUpdates();
  }
}
