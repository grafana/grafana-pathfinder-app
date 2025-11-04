import { InteractiveStateManager } from '../interactive-state-manager';
import { NavigationManager } from '../navigation-manager';
import { InteractiveElementData } from '../../types/interactive.types';
import { INTERACTIVE_CONFIG } from '../../constants/interactive-config';
import { findButtonByText } from '../dom-utils';
import { isElementVisible } from '../element-validator';

export class ButtonHandler {
  constructor(
    private stateManager: InteractiveStateManager,
    private navigationManager: NavigationManager,
    private waitForReactUpdates: () => Promise<void>
  ) {}

  async execute(data: InteractiveElementData, click: boolean): Promise<void> {
    this.stateManager.setState(data, 'running');

    try {
      const buttons = findButtonByText(data.reftarget);

      if (!click) {
        await this.handleShowMode(buttons, data.targetcomment);
        return;
      }

      await this.handleDoMode(buttons);
      await this.markAsCompleted(data);
    } catch (error) {
      this.stateManager.handleError(error as Error, 'ButtonHandler', data, false);
    }
  }

  private async handleShowMode(buttons: HTMLElement[], comment?: string): Promise<void> {
    // Show mode: ensure visibility and highlight, don't click - NO step completion
    for (const button of buttons) {
      // Validate visibility before interaction
      if (!isElementVisible(button)) {
        console.warn('Target button is not visible:', button);
        // Continue anyway (non-breaking)
      }

      await this.navigationManager.ensureNavigationOpen(button);
      await this.navigationManager.ensureElementVisible(button);
      await this.navigationManager.highlightWithComment(button, comment);
    }
  }

  private async handleDoMode(buttons: HTMLElement[]): Promise<void> {
    // Clear any existing highlights before performing action
    this.navigationManager.clearAllHighlights();

    // Do mode: ensure visibility then click, don't highlight
    for (const button of buttons) {
      // Validate visibility before interaction
      if (!isElementVisible(button)) {
        console.warn('Target button is not visible:', button);
        // Continue anyway (non-breaking)
      }

      await this.navigationManager.ensureNavigationOpen(button);
      await this.navigationManager.ensureElementVisible(button);
      button.click();
    }
  }

  private async markAsCompleted(data: InteractiveElementData): Promise<void> {
    // Wait for React to process all button click events and state updates
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
