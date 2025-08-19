import { InteractiveStateManager } from '../interactive-state-manager';
import { NavigationManager } from '../navigation-manager';
import { InteractiveElementData } from '../../types/interactive.types';
import { findButtonByText } from '../dom-utils';

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
      await this.navigationManager.ensureNavigationOpen(button);
      await this.navigationManager.ensureElementVisible(button);
      await this.navigationManager.highlightWithComment(button, comment);
    }
  }

  private async handleDoMode(buttons: HTMLElement[]): Promise<void> {
    // Do mode: ensure visibility then click, don't highlight
    for (const button of buttons) {
      await this.navigationManager.ensureNavigationOpen(button);
      await this.navigationManager.ensureElementVisible(button);
      button.click();
    }
  }

  private async markAsCompleted(data: InteractiveElementData): Promise<void> {
    await this.waitForReactUpdates();
    this.stateManager.setState(data, 'completed');
  }
}
