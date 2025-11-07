import { getAppEvents } from '@grafana/runtime';
import { BusEventWithPayload } from "@grafana/data";

import { getDocsLinkFromEvent } from "global-state/getDocsLinkFromEvent";

import pluginJson from '../plugin.json';

export interface QueuedDocsLink {
  url: string;
  title: string;
  timestamp: number;
}

interface OpenExtensionSidebarPayload {
  pluginId: string;
  componentTitle: string;
  props?: Record<string, unknown>;
}

class OpenExtensionSidebarEvent extends BusEventWithPayload<OpenExtensionSidebarPayload> {
  static type = 'open-extension-sidebar';
}

/**
 * Global state manager for the Pathfinder plugin.
 * Manages link interception, sidebar state, and pending docs queue.
 */
class GlobalState {
  private _isSidebarMounted = false;
  private _isInterceptionEnabled = false;
  private _pendingDocsQueue: QueuedDocsLink[] = [];

  // Getter methods
  public getIsSidebarMounted(): boolean {
    return this._isSidebarMounted;
  }

  public getIsInterceptionEnabled(): boolean {
    return this._isInterceptionEnabled;
  }

  public getPendingDocsQueue(): QueuedDocsLink[] {
    return this._pendingDocsQueue;
  }

  // Setter methods
  public setSidebarMounted(mounted: boolean): void {
    this._isSidebarMounted = mounted;
  }

  public setInterceptionEnabled(enabled: boolean): void {
    this._isInterceptionEnabled = enabled;

    // Manage event listener registration
    if (enabled) {
      document.addEventListener('click', this.handleGlobalClick, { capture: true });
    } else {
      document.removeEventListener('click', this.handleGlobalClick, { capture: true });
    }
  }

  // Sidebar management
  public openSidebar(componentTitle: string, props?: Record<string, unknown>): void {
    const event = new OpenExtensionSidebarEvent({
      pluginId: pluginJson.id,
      componentTitle,
      props,
    });
    this.setSidebarMounted(true);
    getAppEvents().publish(event);
  }

  // Queue manipulation methods
  public addToQueue(link: QueuedDocsLink): void {
    this._pendingDocsQueue.push(link);
  }

  public shiftFromQueue(): QueuedDocsLink | undefined {
    return this._pendingDocsQueue.shift();
  }

  public clearQueue(): void {
    this._pendingDocsQueue = [];
  }

  public getQueueLength(): number {
    return this._pendingDocsQueue.length;
  }

  public hasQueuedLinks(): boolean {
    return this._pendingDocsQueue.length > 0;
  }

  public processQueuedLinks(): void {
    while (this.hasQueuedLinks()) {
      const docsLink = this.shiftFromQueue();

      if (docsLink) {
        this.processLink(docsLink);
      }
    }
  }

  public processLink(link: QueuedDocsLink): void {
    document.dispatchEvent(new CustomEvent('pathfinder-auto-open-docs', {
      detail: {
        url: link.url,
        title: link.title,
        origin: 'queued_link',
      },
    }));
  }

  // Arrow function to preserve 'this' binding when used as event listener
  public handleGlobalClick = (event: MouseEvent): void => {
    const docsLink = getDocsLinkFromEvent(event);

    if (!docsLink) {
      return;
    }

    event.preventDefault();

    // if sidebar is mounted, auto-open the link
    if (this._isSidebarMounted) {
      document.dispatchEvent(new CustomEvent('pathfinder-auto-open-docs', {
        detail: docsLink,
      }));
    } else {

      // if sidebar is not mounted, open it and add the link to the queue
      const appEvents = getAppEvents();
      appEvents.publish({
        type: 'open-extension-sidebar',
        payload: {
          pluginId: pluginJson.id,
          componentTitle: 'Interactive learning',
        },
      });

      this.addToQueue({
        url: docsLink.url,
        title: docsLink.title,
        timestamp: Date.now(),
      });
    }
  };
}

export const globalState = new GlobalState();
