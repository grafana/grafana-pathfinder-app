/**
 * Owns the `pathfinder-auto-open-docs` CustomEvent listener — the contract by
 * which the global link interceptor (and other surfaces) request that the docs
 * panel open a URL in a new tab.
 *
 * The handler routes to `model.openLearningJourney` for `/learning-journeys/`
 * and `/learning-paths/` URLs and to `model.openDocsPage` otherwise. The
 * untrusted `event.detail.source` is coerced via `coerceLaunchSource` at the
 * boundary so typo'd strings fall through to `null` ("needs check") instead of
 * leaking into the model.
 *
 * Load-bearing ordering quirk (do not "fix" during this refactor):
 *   The post-`addEventListener` `setTimeout(() => processQueuedLinks(), 0)`
 *   call defers the queue drain to the end of the current tick so the listener
 *   is registered *before* queued links are replayed. Pre-mortem H2 in the
 *   refactor plan pins this — preserved verbatim with its `// todo` comment.
 *
 * Contract surfaces preserved (Pattern J — pinned by
 * docs-panel.auto-open-event.test.tsx):
 *   - CustomEvent name: `pathfinder-auto-open-docs`
 *   - Detail shape: `{ url: string; title: string; source?: string }`,
 *     plus an optional opaque `launchKey` redeeming a prepared launch from
 *     the module-owned `guideLaunchStore` (the payload itself never rides
 *     this forgeable event)
 *   - Routing predicate: `/learning-journeys/` or `/learning-paths/` pathname
 *   - Source coercion via `coerceLaunchSource`
 */
import * as React from 'react';
import { guideLaunchStore } from '../../../global-state/guide-launch';
import { linkInterceptionState } from '../../../global-state/link-interception';
import { panelModeManager, type PanelMode } from '../../../global-state/panel-mode';
import { coerceLaunchSource } from '../../../recovery';
import { AUTO_OPEN_DOCS_EVENT } from '../../../lib/event-names';
import { isLearningJourneyUrl } from '../utils/url-validation';
import type { DocsPanelModelOperations } from '../types';

/**
 * Mounted on every surface that renders a `DocsPanelModelOperations` model —
 * the sidebar (`docs-panel.tsx`), the floating panel, and the full-screen page
 * (#1450). `AUTO_OPEN_DOCS_EVENT` is fire-and-forget, so a dispatcher (link
 * interception, `HomePanel`, the cold-sidebar queue drain) drops the launch if
 * no live listener exists; before #1450 only the sidebar listened, so a
 * docs-link click while floating/fullscreen owned the surface did nothing.
 *
 * `surface` is the panel mode this listener belongs to. The handler is
 * mode-gated: it acts only when `panelModeManager.getMode()` matches, so during
 * a dock-back — when the old and new surfaces are both briefly mounted — exactly
 * one listener handles the event (and drains the queue) instead of two racing to
 * open the same tab across two models.
 */
export function useAutoOpenListener(model: DocsPanelModelOperations, surface: PanelMode = 'sidebar'): void {
  React.useEffect(() => {
    const handleAutoOpen = (event: Event) => {
      // Mode-gate (#1450): only the surface that currently owns the display
      // acts. Prevents double-open during the transient dock-back overlap.
      if (panelModeManager.getMode() !== surface) {
        return;
      }

      const customEvent = event as CustomEvent<{
        url: string;
        title: string;
        source?: string;
        launchKey?: string;
      }>;
      const { url, title, source, launchKey } = customEvent.detail;

      // Coerce the untrusted event.detail.source to a typed LaunchSource at
      // the boundary. Unknown literals fall through to `null` ("needs check"),
      // which is the safer default than passing typo'd strings into the model.
      const typedSource = coerceLaunchSource(source);

      // Redeem a prepared (one-fetch) launch at the trusted boundary. The
      // document-level event is forgeable, so it carries only an opaque key;
      // the payload never crosses it. A forged/replayed/mismatched key
      // redeems to null and the loader runs its normal validated fetch.
      const staged = guideLaunchStore.consume(launchKey, url);

      if (isLearningJourneyUrl(url)) {
        model.openLearningJourney(url, title, {
          source: typedSource ?? undefined,
          preparedContent: staged?.preparedContent,
          packageInfo: staged?.packageInfo,
        });
      } else {
        model.openDocsPage(url, title, {
          source: typedSource ?? undefined,
          preparedContent: staged?.preparedContent,
          packageInfo: staged?.packageInfo,
        });
      }
    };

    // Listen for all auto-open events
    document.addEventListener(AUTO_OPEN_DOCS_EVENT, handleAutoOpen);

    // todo: investigate why this needs to be kicked to the end of the event loop
    setTimeout(() => linkInterceptionState.processQueuedLinks(), 0);

    return () => {
      document.removeEventListener(AUTO_OPEN_DOCS_EVENT, handleAutoOpen);
    };
  }, [model, surface]); // model is stable across tab changes; surface is stable per mount
}
