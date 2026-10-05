import { getDocsLinkFromEvent } from 'global-state/utils.link-interception';
import { panelModeManager } from 'global-state/panel-mode';
import { sidebarState } from 'global-state/sidebar';
import { reportAppInteraction, UserInteraction } from 'lib/analytics';
import { AUTO_OPEN_DOCS_EVENT } from 'lib/event-names';
import type { QueuedDocsLink } from 'types/link-interception.types';

function isGrafanaKioskMode(): boolean {
  return new URLSearchParams(window.location.search).has('kiosk');
}

class GlobalLinkInterceptionState {
  private _isInterceptionEnabled = false;
  private _pendingDocsQueue: QueuedDocsLink[] = [];

  private handleGlobalClick = (event: MouseEvent): void => {
    if (isGrafanaKioskMode()) {
      return;
    }

    const docsLink = getDocsLinkFromEvent(event);

    if (!docsLink) {
      return;
    }

    // A mounted surface's listener cancels the event; the mounted flag alone goes stale.
    const delivered = !document.dispatchEvent(
      new CustomEvent(AUTO_OPEN_DOCS_EVENT, {
        cancelable: true,
        detail: { ...docsLink, source: 'link_interception' },
      })
    );

    if (!delivered) {
      if (panelModeManager.getMode() !== 'sidebar') {
        return;
      }

      sidebarState.setPendingOpenSource('link_interception');
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

    event.preventDefault();

    reportAppInteraction(UserInteraction.GlobalDocsLinkIntercepted, {
      intercepted_url: docsLink.url,
      link_title: docsLink.title,
      sidebar_was_open: delivered,
      timestamp: Date.now(),
    });
  };

  public getIsInterceptionEnabled(): boolean {
    return this._isInterceptionEnabled;
  }

  public setInterceptionEnabled(enabled: boolean): void {
    this._isInterceptionEnabled = enabled;

    if (enabled) {
      // Capture phase: page handlers may stopPropagation() in bubble, so we have to
      // see the click before they do or we miss every link inside React event trees.
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
          new CustomEvent(AUTO_OPEN_DOCS_EVENT, {
            detail: {
              url: docsLink.url,
              title: docsLink.title,
              source: 'queued_link',
              // Preserve a prepared (one-fetch) launch through the cold-sidebar
              // queue: the key redeems the payload from guideLaunchStore at the
              // listener's trusted boundary.
              launchKey: docsLink.launchKey,
            },
          })
        );
      }
    }
  }
}

export const linkInterceptionState = new GlobalLinkInterceptionState();
