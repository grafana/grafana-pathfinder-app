import { InteractiveStateManager } from '../interactive-state-manager';
import { InteractiveElementData } from '../../types/interactive.types';
import { INTERACTIVE_CONFIG } from '../../constants/interactive-config';
import { config, locationService } from '@grafana/runtime';
import { parseUrlSafely, validateRedirectPath } from '../../security/url-validator';

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
      // SECURITY: Validate internal path against denied routes (F-1 / ASE26016)
      // Treat Grafana server admins as Admin even if orgRole is Viewer/Editor.
      const user = config.bootData?.user;
      const userRole = user?.isGrafanaAdmin === true || user?.orgRole === 'Admin' ? 'Admin' : user?.orgRole;
      const safePath = validateRedirectPath(data.reftarget, userRole);

      // validateRedirectPath strips query/fragment, so compare against pathname only
      let inputPathname: string;
      try {
        inputPathname = new URL(data.reftarget, window.location.origin).pathname;
      } catch {
        inputPathname = data.reftarget;
      }

      const hasSingleLeadingSlash = data.reftarget.startsWith('/') && !data.reftarget.startsWith('//');
      const rejectedAsRootFallback = safePath === '/' && !hasSingleLeadingSlash;

      if (safePath !== inputPathname || rejectedAsRootFallback) {
        console.warn(`[NavigateHandler] Blocked navigation to restricted path: ${data.reftarget.slice(0, 100)}`);
        return;
      }
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
