import { getDocsLinkFromEvent } from 'global-state/utils.link-interception';
import { sidebarState } from 'global-state/sidebar';

export interface QueuedDocsLink {
  url: string;
  title: string;
  timestamp: number;
}

/**
 * Global state manager for the Pathfinder plugin's link interception.
 * Manages link interception and pending docs queue.
 */
class GlobalLinkInterceptionState {
  private _isInterceptionEnabled = false;
  private _pendingDocsQueue: QueuedDocsLink[] = [];

  // Getter methods
  public getIsInterceptionEnabled(): boolean {
    return this._isInterceptionEnabled;
  }

  public getPendingDocsQueue(): QueuedDocsLink[] {
    return this._pendingDocsQueue;
  }

  // Setter methods
  public setInterceptionEnabled(enabled: boolean): void {
    this._isInterceptionEnabled = enabled;

    // Manage event listener registration
    if (enabled) {
      document.addEventListener('click', this.handleGlobalClick, { capture: true });
    } else {
      document.removeEventListener('click', this.handleGlobalClick, { capture: true });
    }
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
    document.dispatchEvent(
      new CustomEvent('pathfinder-auto-open-docs', {
        detail: {
          url: link.url,
          title: link.title,
          origin: 'queued_link',
        },
      })
    );
  }

  // Arrow function to preserve 'this' binding when used as event listener
  public handleGlobalClick = (event: MouseEvent): void => {
    const docsLink = getDocsLinkFromEvent(event);

    if (!docsLink) {
      return;
    }

    event.preventDefault();

    // if sidebar is mounted, auto-open the link
    if (sidebarState.getIsSidebarMounted()) {
      document.dispatchEvent(
        new CustomEvent('pathfinder-auto-open-docs', {
          detail: docsLink,
        })
      );
    } else {
      sidebarState.openSidebar('Interactive learning', {
        url: docsLink.url,
        title: docsLink.title,
        timestamp: Date.now(),
      });

      this.addToQueue({
        url: docsLink.url,
        title: docsLink.title,
        timestamp: Date.now(),
      });
    }
  };
}

export const linkInterceptionState = new GlobalLinkInterceptionState();
