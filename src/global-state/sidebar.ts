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
 * Global state manager for the Pathfinder plugin's sidebar management.
 * Manages sidebar mounting and unmounting.
 */
class GlobalSidebarState {
  private _isSidebarMounted = false;
  private _pendingOpenSource: string | null = null;

  public getIsSidebarMounted(): boolean {
    return this._isSidebarMounted;
  }

  public setIsSidebarMounted(isSidebarMounted: boolean): void {
    this._isSidebarMounted = isSidebarMounted;
  }

  /**
   * Sets the source for the next sidebar open event.
   * This is consumed by the sidebar mount analytics and cleared after use.
   */
  public setPendingOpenSource(source: string): void {
    this._pendingOpenSource = source;
  }

  /**
   * Gets and clears the pending open source.
   * Returns the source if set, otherwise returns 'sidebar_toggle' as default.
   */
  public consumePendingOpenSource(): string {
    const source = this._pendingOpenSource || 'sidebar_toggle';
    this._pendingOpenSource = null;
    return source;
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
      event_time: Date.now(),
    });
  }
}

export const sidebarState = new GlobalSidebarState();
