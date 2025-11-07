import { getAppEvents } from '@grafana/runtime';
import { BusEventWithPayload } from "@grafana/data";
import { reportAppInteraction, UserInteraction } from 'lib';
import pluginJson from '../plugin.json';

interface OpenExtensionSidebarPayload {
  pluginId: string;
  componentTitle: string;
  props?: Record<string, unknown>;
}

class OpenExtensionSidebarEvent extends BusEventWithPayload<OpenExtensionSidebarPayload> {
  static type = 'open-extension-sidebar';
}

class GlobalSidebarState {
  private _isSidebarMounted = false;

  public getIsSidebarMounted(): boolean {
    return this._isSidebarMounted;
  }

  public setIsSidebarMounted(isSidebarMounted: boolean): void {
    this._isSidebarMounted = isSidebarMounted;
  }

  // Sidebar management
  public openSidebar(componentTitle: string, props?: Record<string, unknown>): void {
    this.setIsSidebarMounted(true);

    getAppEvents().publish(new OpenExtensionSidebarEvent({
      pluginId: pluginJson.id,
      componentTitle,
      props,
    }));

    reportAppInteraction(UserInteraction.DocsPanelInteraction, {
      action: 'open',
      source: 'sidebar_mount',
      timestamp: Date.now(),
    });
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
