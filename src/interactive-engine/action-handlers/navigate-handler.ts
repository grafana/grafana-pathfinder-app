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
      // SECURITY: Reject protocol-relative URLs before URL parsing.
      // '//evil.com' parses via new URL() as cross-origin with pathname '/', which
      // collides with validateRedirectPath's rejection sentinel and bypasses the check.
      if (!data.reftarget.startsWith('/') || data.reftarget.startsWith('//')) {
        console.warn(`[NavigateHandler] Blocked navigation to invalid path: ${data.reftarget.slice(0, 100)}`);
        return;
      }

      // SECURITY: Validate internal path against denied routes (F-1 / ASE26016)
      const user = config.bootData?.user;
      const isAdmin = user?.isGrafanaAdmin === true || user?.orgRole === 'Admin';
      const safePath = validateRedirectPath(data.reftarget, isAdmin);

      let parsed: URL;
      try {
        parsed = new URL(data.reftarget, window.location.origin);
      } catch {
        console.warn(`[NavigateHandler] Blocked navigation to unparseable path: ${data.reftarget.slice(0, 100)}`);
        return;
      }

      if (safePath !== parsed.pathname) {
        console.warn(`[NavigateHandler] Blocked navigation to restricted path: ${data.reftarget.slice(0, 100)}`);
        return;
      }

      // Strip doc= from the URL before navigation — we handle it via auto-launch event instead
      const guideParam = this.resolveGuideParam(data, parsed);
      if (guideParam) {
        parsed.searchParams.delete('doc');
      }

      // SECURITY: Navigate using validated pathname + original query/fragment.
      // Never push raw data.reftarget — even if the comparison above were bypassed,
      // locationService only receives the validated path.
      locationService.push(safePath + parsed.search + parsed.hash);

      // After SPA navigation, open a guide if specified
      if (guideParam) {
        await this.openGuideAfterNavigation(guideParam);
      }
    }
  }

  /**
   * Resolve which guide to open after navigation.
   * Priority: explicit openGuide field > doc= param in the URL.
   */
  private resolveGuideParam(data: InteractiveElementData, parsedUrl: URL): string | null {
    // 1. Explicit openGuide field takes priority
    if (data.openGuide) {
      return data.openGuide;
    }

    // 2. Backward compat: extract doc= from the navigation URL
    const docParam = parsedUrl.searchParams.get('doc');
    if (docParam) {
      return docParam;
    }

    return null;
  }

  /**
   * Open a guide in the sidebar after SPA navigation completes.
   * Uses the same auto-launch-tutorial event pattern as module.tsx.
   */
  private async openGuideAfterNavigation(guideParam: string): Promise<void> {
    // Dynamic import to keep find-doc-page in a lazy chunk
    const { findDocPage } = await import('../../utils/find-doc-page');
    const docPage = findDocPage(guideParam);

    if (!docPage) {
      console.warn(`[NavigateHandler] Could not resolve guide param: ${guideParam}`);
      return;
    }

    // Wait for navigation to settle before dispatching
    await new Promise((resolve) => setTimeout(resolve, 500));

    const autoLaunchEvent = new CustomEvent('auto-launch-tutorial', {
      detail: {
        url: docPage.url,
        title: docPage.title,
        type: docPage.type,
        source: 'navigate-action',
      },
    });
    document.dispatchEvent(autoLaunchEvent);
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
