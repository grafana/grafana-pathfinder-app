import { InteractiveStateManager } from '../interactive-state-manager';
import { InteractiveElementData } from '../../types/interactive.types';
import { locationService } from '@grafana/runtime';

export class NavigateHandler {
  constructor(
    private stateManager: InteractiveStateManager,
    private waitForReactUpdates: () => Promise<void>
  ) {}

  async execute(data: InteractiveElementData, navigate: boolean): Promise<void> {
    this.stateManager.setState(data, 'running');
    
    try {
      if (!navigate) {
        await this.handleShowMode(data);
        // Mark show actions as completed too for proper state cleanup
        await this.markAsCompleted(data);
        return;
      }

      await this.handleDoMode(data);
      await this.markAsCompleted(data);
    } catch (error) {
      this.stateManager.handleError(error as Error, 'NavigateHandler', data);
    }
  }

  private async handleShowMode(data: InteractiveElementData): Promise<void> {
    // Show mode: highlight the current location or show where we would navigate
    // For navigation, we can highlight the current URL or show a visual indicator
    // Since there's no specific element to highlight, we'll just show a brief visual feedback
    console.log(`🔍 Show mode: Would navigate to ${data.reftarget}`);
    
    // Provide visual feedback by briefly highlighting the browser location bar concept
    // or show a toast/notification (for now, just log and complete)
    await this.waitForReactUpdates();
    this.stateManager.setState(data, 'completed');
  }

  private async handleDoMode(data: InteractiveElementData): Promise<void> {
    // Do mode: actually navigate to the target URL
    console.log(`🧭 Navigating to: ${data.reftarget}`);
    
    // Use Grafana's idiomatic navigation pattern via locationService
    // This handles both internal Grafana routes and external URLs appropriately
    if (data.reftarget.startsWith('http://') || data.reftarget.startsWith('https://')) {
      // External URL - open in new tab to preserve current Grafana session
      window.open(data.reftarget, '_blank', 'noopener,noreferrer');
    } else {
      // Internal Grafana route - use locationService for proper routing
      locationService.push(data.reftarget);
    }
  }

  private async markAsCompleted(data: InteractiveElementData): Promise<void> {
    await this.waitForReactUpdates();
    this.stateManager.setState(data, 'completed');
  }
}
