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
 * Pending open info for analytics tracking
 */
interface PendingOpenInfo {
  source: string;
  isAutoOpen: boolean;
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
   * @param isAutoOpen - Whether this is a programmatic auto-open (true) or user-initiated (false)
   */
  public setPendingOpenSource(source: string, isAutoOpen = false): void {
    this._pendingOpenInfo = { source, isAutoOpen };
  }

  /**
   * Gets and clears the pending open info.
   * Returns the source and isAutoOpen flag if set, otherwise returns defaults.
   */
  public consumePendingOpenSource(): PendingOpenInfo {
    const info = this._pendingOpenInfo || { source: 'sidebar_toggle', isAutoOpen: false };
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
