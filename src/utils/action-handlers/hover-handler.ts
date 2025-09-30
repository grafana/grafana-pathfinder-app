import { InteractiveStateManager } from '../interactive-state-manager';
import { NavigationManager } from '../navigation-manager';
import { InteractiveElementData } from '../../types/interactive.types';
import { INTERACTIVE_CONFIG } from '../../constants/interactive-config';
import { querySelectorAllEnhanced } from '../enhanced-selector';

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
    const enhancedResult = querySelectorAllEnhanced(selector);
    const targetElements = enhancedResult.elements;

    if (targetElements.length === 0) {
      throw new Error(`No elements found matching selector: ${selector}`);
    }

    if (targetElements.length > 1) {
      console.warn(`Multiple elements found matching selector: ${selector}, using first element`);
    }

    return targetElements[0];
  }

  private async prepareElement(targetElement: HTMLElement): Promise<void> {
    await this.navigationManager.ensureNavigationOpen(targetElement);
    await this.navigationManager.ensureElementVisible(targetElement);
  }

  private async handleShowMode(targetElement: HTMLElement, comment?: string): Promise<void> {
    // Show mode: highlight the element that will be hovered
    await this.navigationManager.highlightWithComment(targetElement, comment);
  }

  private async handleDoMode(targetElement: HTMLElement): Promise<void> {
    console.warn('🎯 Hover action starting on element:', targetElement);
    console.warn('Element details:', {
      tagName: targetElement.tagName,
      className: targetElement.className,
      id: targetElement.id,
      hasTabindex: targetElement.hasAttribute('tabindex'),
      tabindex: targetElement.getAttribute('tabindex'),
    });

    // Do mode: dispatch hover events and maintain hover state
    this.dispatchHoverEvents(targetElement);
    console.warn('✅ Dispatched hover mouse events');

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
        console.warn('✅ Focused element (for tooltip trigger)');
      } catch (error) {
        // Ignore focus errors - element might not be focusable despite attributes
        console.warn('⚠️ Could not focus element:', error);
      }
    }

    console.warn(`⏱️ Maintaining hover for ${INTERACTIVE_CONFIG.delays.perceptual.hover}ms...`);
    // Maintain hover state for configured duration
    await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.perceptual.hover));
    console.warn('✅ Hover action complete');

    // Note: We intentionally don't dispatch unhover events to keep the element in hover state
    // This allows subsequent actions to interact with hover-revealed elements
    // The natural mouse movement will trigger mouseout when the user interacts next
  }

  /**
   * Dispatch mouse events to trigger CSS :hover pseudo-classes
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
   * Dispatch mouse events to remove hover state
   * Currently unused - we keep hover state active for subsequent interactions
   * Reserved for future use if hover cleanup is needed
   */
  // @ts-ignore - Reserved for future use
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
    await this.waitForReactUpdates();
    this.stateManager.setState(data, 'completed');
  }
}
