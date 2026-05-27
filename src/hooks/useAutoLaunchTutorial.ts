/**
 * Subscribe a panel model to the `auto-launch-tutorial` event.
 *
 * Why this exists: the same listener was duplicated across the three
 * surfaces that consume `auto-launch-tutorial` — the sidebar, the floating
 * panel manager, and the fullscreen panel. All three call
 * `coerceLaunchSource` and apply the same "open as learning journey" rule
 * (`type === 'learning-journey' || source === 'learning-hub'`). Drift
 * between those copies has produced real bugs and the routing decision
 * is exactly the kind of cross-surface contract that should live in one
 * place.
 *
 * The sidebar variant additionally fires `OpenResourceClick` analytics and
 * a `auto-launch-complete` window event — the consumer wires those in via
 * the optional `onLaunched` callback so the hook stays minimal for the
 * floating / fullscreen consumers that don't need them.
 */

import { useEffect } from 'react';

import { coerceLaunchSource, type LaunchSource } from '../recovery';
import { shouldOpenAsLearningJourney } from '../utils/pathfinder-search-params';

/**
 * Detail payload of the `auto-launch-tutorial` CustomEvent.
 *
 * `type` and `source` are intentionally untyped strings here — they arrive
 * from external consumers (`module.tsx`, the link interceptor) and are
 * narrowed inside the hook via `coerceLaunchSource` and the shared
 * `shouldOpenAsLearningJourney` rule.
 */
export interface AutoLaunchTutorialDetail {
  url: string;
  title: string;
  type?: string;
  source?: string;
}

/**
 * Minimal panel shape the hook depends on. Inlined here (rather than
 * imported from `components/`) so the hook stays in tier 2 and doesn't
 * cross the components-tier boundary.
 */
export interface AutoLaunchPanel {
  openLearningJourney(url: string, title: string, opts?: { source?: LaunchSource }): void;
  openDocsPage(url: string, title: string, opts?: { source?: LaunchSource }): void;
}

export interface UseAutoLaunchTutorialOptions {
  /**
   * Called synchronously when the event arrives, BEFORE the panel is
   * mutated. Used by floating / fullscreen surfaces to flip their
   * `guideOpenInFlightRef` so the empty-state fallback doesn't fire on top
   * of an incoming guide.
   */
  onIncoming?: (detail: AutoLaunchTutorialDetail) => void;
  /**
   * Called after the panel has been routed to the right open method.
   * Used by the sidebar to fire `OpenResourceClick` analytics and a
   * follow-up `auto-launch-complete` window event so external callers
   * can wait for completion.
   */
  onLaunched?: (detail: AutoLaunchTutorialDetail, openedAsLearningJourney: boolean) => void;
  /**
   * When true, the auto-launch event is ignored. Fullscreen uses this to
   * skip the deep-link handler's delayed `auto-launch-tutorial` dispatch
   * when a pending-guide handoff already opened the guide on mount.
   */
  skipLaunch?: () => boolean;
}

export function useAutoLaunchTutorial(panel: AutoLaunchPanel, options?: UseAutoLaunchTutorialOptions): void {
  const onIncoming = options?.onIncoming;
  const onLaunched = options?.onLaunched;
  const skipLaunch = options?.skipLaunch;

  useEffect(() => {
    const handleAutoLaunch = (event: Event) => {
      const detail = (event as CustomEvent<AutoLaunchTutorialDetail>).detail;
      if (!detail) {
        return;
      }
      onIncoming?.(detail);

      if (skipLaunch?.()) {
        return;
      }

      const { url, title, type, source } = detail;
      if (!url || !title) {
        return;
      }

      // Coerce the untrusted detail.source to a typed LaunchSource at the
      // boundary. Unknown literals fall through to undefined ("needs check"),
      // which is the safer default than passing typo'd strings into the model.
      const typedSource = coerceLaunchSource(source) ?? undefined;
      const openedAsLearningJourney = shouldOpenAsLearningJourney(type, source);
      if (openedAsLearningJourney) {
        panel.openLearningJourney(url, title, { source: typedSource });
      } else {
        panel.openDocsPage(url, title, { source: typedSource });
      }

      onLaunched?.(detail, openedAsLearningJourney);
    };

    document.addEventListener('auto-launch-tutorial', handleAutoLaunch);
    return () => {
      document.removeEventListener('auto-launch-tutorial', handleAutoLaunch);
    };
  }, [panel, onIncoming, onLaunched, skipLaunch]);
}
