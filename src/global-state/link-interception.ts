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

  // Arrow function to preserve 'this' binding when used as event listener
  private handleGlobalClick = (event: MouseEvent): void => {
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

  public getIsInterceptionEnabled(): boolean {
    return this._isInterceptionEnabled;
  }

  public setInterceptionEnabled(enabled: boolean): void {
    this._isInterceptionEnabled = enabled;

    if (enabled) {
      document.addEventListener('click', this.handleGlobalClick, { capture: true });
    } else {
      document.removeEventListener('click', this.handleGlobalClick, { capture: true });
    }
  }

  public addToQueue(link: QueuedDocsLink): void {
    this._pendingDocsQueue.push(link);
  }

  public shiftFromQueue(): QueuedDocsLink | undefined {
    return this._pendingDocsQueue.shift();
  }

  public hasQueuedLinks(): boolean {
    return this._pendingDocsQueue.length > 0;
  }

  public processQueuedLinks(): void {
    while (this.hasQueuedLinks()) {
      const docsLink = this.shiftFromQueue();

      if (docsLink) {
        document.dispatchEvent(
          new CustomEvent('pathfinder-auto-open-docs', {
            detail: {
              url: docsLink.url,
              title: docsLink.title,
              origin: 'queued_link',
            },
          })
        );
      }
    }
  }
}

export const linkInterceptionState = new GlobalLinkInterceptionState();
