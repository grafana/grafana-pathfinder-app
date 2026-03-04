import { getAppEvents } from '@grafana/runtime';
import { BusEventWithPayload } from '@grafana/data';
import { reportAppInteraction, UserInteraction } from 'lib';
import pluginJson from '../plugin.json';

interface OpenExtensionSidebarPayload {
  pluginId: string;
  componentTitle: string;
  props?: Record<string, unknown>;
}

export class OpenExtensionSidebarEvent extends BusEventWithPayload<OpenExtensionSidebarPayload> {
  static type = 'open-extension-sidebar';
}

/**
 * Action types for sidebar open analytics
 */
export type OpenAction = 'open' | 'auto-open' | 'restore';

/**
 * Pending open info for analytics tracking
 */
interface PendingOpenInfo {
  source: string;
  action: OpenAction;
}

/**
 * Global state manager for the Pathfinder plugin's sidebar management.
 * Manages sidebar mounting and unmounting.
 */
class GlobalSidebarState {
  private _isSidebarMounted = false;
  private _pendingOpenInfo: PendingOpenInfo | null = null;

  public getIsSidebarMounted(): boolean {
    return this._isSidebarMounted;
  }

  public setIsSidebarMounted(isSidebarMounted: boolean): void {
    this._isSidebarMounted = isSidebarMounted;
  }

  /**
   * Sets the source for the next sidebar open event.
   * This is consumed by the sidebar mount analytics and cleared after use.
   *
   * @param source - The source identifier for analytics
   * @param action - The action type: 'open' (user-initiated), 'auto-open' (programmatic), or 'restore' (browser cache)
   */
  public setPendingOpenSource(source: string, action: OpenAction = 'open'): void {
    this._pendingOpenInfo = { source, action };
  }

  /**
   * Gets and clears the pending open info.
   * Returns the source and action if set, otherwise returns defaults.
   */
  public consumePendingOpenSource(): PendingOpenInfo {
    const info = this._pendingOpenInfo || { source: 'sidebar_toggle', action: 'open' };
    this._pendingOpenInfo = null;
    return info;
  }

  // Sidebar management
  public openSidebar(componentTitle: string, props?: Record<string, unknown>): void {
    this.setIsSidebarMounted(true);

    getAppEvents().publish(
      new OpenExtensionSidebarEvent({
        pluginId: pluginJson.id,
        componentTitle,
        props,
      })
    );

    // Note: Analytics are now fired in the ContextSidebar mount effect
    // to properly track the source via consumePendingOpenSource()
  }

  /**
   * Opens the Pathfinder sidebar and launches a specific bundled guide by ID.
   * Used by the MCP launch_guide tool via the frontend polling hook.
   *
   * @param guideId - The bundled guide ID (e.g. 'prometheus-grafana-101')
   */
  public openWithGuide(guideId: string): void {
    this.setPendingOpenSource('mcp_launch', 'auto-open');

    const dispatch = () => {
      // Small delay so docs-panel's useEffect listener is registered after mount
      setTimeout(() => {
        document.dispatchEvent(
          new CustomEvent('auto-launch-tutorial', {
            detail: {
              url: `bundled:${guideId}`,
              title: guideId,
              type: 'docs-page',
            },
          })
        );
      }, 300);
    };

    if (this.getIsSidebarMounted()) {
      // Sidebar is already open — dispatch directly (typical case from polling hook)
      dispatch();
    } else {
      // Sidebar needs to open first — wait for mount before dispatching
      window.addEventListener('pathfinder-sidebar-mounted', dispatch, { once: true });
      this.openSidebar('Interactive learning');
    }
  }

  public closeSidebar(): void {
    this.setIsSidebarMounted(false);

    reportAppInteraction(UserInteraction.DocsPanelInteraction, {
      action: 'close',
      source: 'sidebar_unmount',
      timestamp: Date.now(),
    });
  }
}

export const sidebarState = new GlobalSidebarState();
