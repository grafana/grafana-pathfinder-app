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
 *   - Detail shape: `{ url: string; title: string; source?: string }`
 *   - Routing predicate: `/learning-journeys/` or `/learning-paths/` pathname
 *   - Source coercion via `coerceLaunchSource`
 */
import * as React from 'react';
import { linkInterceptionState } from '../../../global-state/link-interception';
import { coerceLaunchSource } from '../../../recovery';
import { parseUrlSafely } from '../../../security';
import type { DocsPanelModelOperations } from '../types';

export function useAutoOpenListener(model: DocsPanelModelOperations): void {
  React.useEffect(() => {
    const handleAutoOpen = (event: Event) => {
      const customEvent = event as CustomEvent<{ url: string; title: string; source?: string }>;
      const { url, title, source } = customEvent.detail;

      // Coerce the untrusted event.detail.source to a typed LaunchSource at
      // the boundary. Unknown literals fall through to `null` ("needs check"),
      // which is the safer default than passing typo'd strings into the model.
      const typedSource = coerceLaunchSource(source);

      // Always create a new tab for each intercepted link
      // Call the model method directly to ensure new tabs are created
      // Use proper URL parsing for security (defense in depth)
      const urlObj = parseUrlSafely(url);
      const isLearningJourney =
        urlObj?.pathname.includes('/learning-journeys/') || urlObj?.pathname.includes('/learning-paths/');

      if (isLearningJourney) {
        model.openLearningJourney(url, title, { source: typedSource ?? undefined });
      } else {
        model.openDocsPage(url, title, { source: typedSource ?? undefined });
      }
    };

    // Listen for all auto-open events
    document.addEventListener('pathfinder-auto-open-docs', handleAutoOpen);

    // todo: investigate why this needs to be kicked to the end of the event loop
    setTimeout(() => linkInterceptionState.processQueuedLinks(), 0);

    return () => {
      document.removeEventListener('pathfinder-auto-open-docs', handleAutoOpen);
    };
  }, [model]); // Only model as dependency - this component doesn't remount on tab changes
}
