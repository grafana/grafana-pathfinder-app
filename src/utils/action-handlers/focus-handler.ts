import { InteractiveStateManager } from '../interactive-state-manager';
import { NavigationManager } from '../navigation-manager';
import { InteractiveElementData } from '../../types/interactive.types';
import { querySelectorAllEnhanced } from '../enhanced-selector';

export class FocusHandler {
  constructor(
    private stateManager: InteractiveStateManager,
    private navigationManager: NavigationManager,
    private waitForReactUpdates: () => Promise<void>
  ) {}

  async execute(data: InteractiveElementData, click: boolean): Promise<void> {
    this.stateManager.setState(data, 'running');

    try {
      // Check if selector should return only one element (contains pseudo-selectors like :first-child, :last-child, etc.)
      const shouldSelectSingle = this.shouldSelectSingleElement(data.reftarget);

      let targetElements: HTMLElement[];
      if (shouldSelectSingle) {
        // Use enhanced selector for single element with complex selector support
        const enhancedResult = querySelectorAllEnhanced(data.reftarget);
        targetElements = enhancedResult.elements.length > 0 ? [enhancedResult.elements[0]] : [];
      } else {
        // Use enhanced selector for multiple elements with complex selector support
        const enhancedResult = querySelectorAllEnhanced(data.reftarget);
        targetElements = enhancedResult.elements;
      }

      if (!click) {
        await this.handleShowMode(targetElements, data.targetcomment);
        return;
      }

      await this.handleDoMode(targetElements);
      await this.markAsCompleted(data);
    } catch (error) {
      this.stateManager.handleError(error as Error, 'FocusHandler', data, false);
    }
  }

  private async handleShowMode(targetElements: HTMLElement[], comment?: string): Promise<void> {
    // Show mode: ensure visibility and highlight, don't click - NO step completion
    for (const element of targetElements) {
      await this.navigationManager.ensureNavigationOpen(element);
      await this.navigationManager.ensureElementVisible(element);
      await this.navigationManager.highlightWithComment(element, comment);
    }
  }

  private async handleDoMode(targetElements: HTMLElement[]): Promise<void> {
    // Clear any existing highlights before performing action
    this.navigationManager.clearAllHighlights();

    // Do mode: ensure visibility then click, don't highlight
    for (const element of targetElements) {
      await this.navigationManager.ensureNavigationOpen(element);
      await this.navigationManager.ensureElementVisible(element);
      element.click();
    }
  }

  private async markAsCompleted(data: InteractiveElementData): Promise<void> {
    await this.waitForReactUpdates();
    this.stateManager.setState(data, 'completed');
  }

  private shouldSelectSingleElement(selector: string): boolean {
    // Pseudo-selectors that should only return a single element
    const singleElementPseudos = [
      ':first-child',
      ':last-child',
      ':first-of-type',
      ':last-of-type',
      ':only-child',
      ':only-of-type',
      ':nth-child(1)',
      ':nth-of-type(1)',
    ];

    return singleElementPseudos.some((pseudo) => selector.includes(pseudo));
  }
}
