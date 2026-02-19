import { InteractiveStateManager } from '../interactive-state-manager';
import { InteractiveElementData } from '../../types/interactive.types';
import { INTERACTIVE_CONFIG } from '../../constants/interactive-config';
import { locationService } from '@grafana/runtime';
import { parseUrlSafely } from '../../security/url-validator';

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
    // Since there's no specific element to highlight, we provide visual feedback
    await this.waitForReactUpdates();
    this.stateManager.setState(data, 'completed');
  }

  private async handleDoMode(data: InteractiveElementData): Promise<void> {
    // Note: No need to clear highlights for navigate - user is leaving the page
    // The page navigation will naturally clean up all DOM elements

    // Do mode: actually navigate to the target URL
    // Use Grafana's idiomatic navigation pattern via locationService
    // This handles both internal Grafana routes and external URLs appropriately
    if (data.reftarget.startsWith('http://') || data.reftarget.startsWith('https://')) {
      // SECURITY: Validate external URL scheme to prevent javascript:/data: injection
      const parsed = parseUrlSafely(data.reftarget);
      if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
        console.warn(`[NavigateHandler] Blocked navigation to invalid URL: ${data.reftarget.slice(0, 100)}`);
        return;
      }
      // External URL - open in new tab to preserve current Grafana session
      window.open(data.reftarget, '_blank', 'noopener,noreferrer');
    } else {
      // Internal Grafana route - use locationService for proper routing
      locationService.push(data.reftarget);
    }
  }

  private async markAsCompleted(data: InteractiveElementData): Promise<void> {
    // Wait for React to process all navigation events and state updates
    await this.waitForReactUpdates();

    // Mark as completed after state has settled
    this.stateManager.setState(data, 'completed');

    // Additional settling time for React state propagation, navigation completion, and reactive checks
    // This ensures the sequential requirements system has time to unlock the next step
    await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.debouncing.reactiveCheck));

    // Final wait to ensure completion state propagates
    await this.waitForReactUpdates();
  }
}
