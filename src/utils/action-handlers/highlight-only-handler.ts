import { InteractiveStateManager } from '../interactive-state-manager';
import { NavigationManager } from '../navigation-manager';
import { InteractiveElementData } from '../../types/interactive.types';

export class HighlightOnlyHandler {
  constructor(
    private stateManager: InteractiveStateManager,
    private navigationManager: NavigationManager,
    private waitForReactUpdates: () => Promise<void>
  ) {}

  async execute(data: InteractiveElementData, show: boolean): Promise<void> {
    this.stateManager.setState(data, 'running');

    try {
      // Check if selector should return only one element (contains pseudo-selectors like :first-child, :last-child, etc.)
      const shouldSelectSingle = this.shouldSelectSingleElement(data.reftarget);

      let targetElements: NodeListOf<Element>;
      if (shouldSelectSingle) {
        // Use querySelector to get only the first match for single-element selectors
        const singleElement = document.querySelector(data.reftarget);
        targetElements = singleElement ? ([singleElement] as any) : document.querySelectorAll('__no_match__');
      } else {
        targetElements = document.querySelectorAll(data.reftarget);
      }

      if (!show) {
        // For highlight-only, there's no "do" mode - just complete immediately
        await this.markAsCompleted(data);
        return;
      }

      await this.handleShowMode(targetElements, data);
      await this.markAsCompleted(data); // Mark as completed after showing
    } catch (error) {
      this.stateManager.handleError(error as Error, 'HighlightOnlyHandler', data, false);
    }
  }

  private async handleShowMode(targetElements: NodeListOf<Element>, data: InteractiveElementData): Promise<void> {
    // Show mode: ensure visibility and highlight with optional comment - automatically marks as completed
    for (const element of targetElements) {
      const htmlElement = element as HTMLElement;
      await this.navigationManager.ensureNavigationOpen(htmlElement);
      await this.navigationManager.ensureElementVisible(htmlElement);

      // Use highlightWithComment to show comment box if targetcomment is provided
      await this.navigationManager.highlightWithComment(htmlElement, data.targetcomment);
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
