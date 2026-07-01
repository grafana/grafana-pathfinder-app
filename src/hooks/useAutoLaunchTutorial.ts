// Shared auto-launch routing: the panel surfaces (sidebar, floating, fullscreen)
// subscribe to `autoLaunchChannel` through this hook so source coercion and the
// learning-journey rule live in one place instead of drifting across copies.

import { useEffect } from 'react';

import { coerceLaunchSource, type LaunchSource } from '../recovery';
import { shouldOpenAsLearningJourney } from '../utils/pathfinder-search-params';
import { autoLaunchChannel, type AutoLaunchTutorialDetail } from '../global-state/auto-launch';

export type { AutoLaunchTutorialDetail };

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
   * Called synchronously when an auto-launch arrives, BEFORE the panel is
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
   * When true, the incoming auto-launch is skipped. Fullscreen uses this to
   * skip the deep-link handler's delayed auto-launch emit when a pending-guide
   * handoff already opened the guide on mount.
   */
  skipLaunch?: () => boolean;
}

export function useAutoLaunchTutorial(panel: AutoLaunchPanel, options?: UseAutoLaunchTutorialOptions): void {
  const onIncoming = options?.onIncoming;
  const onLaunched = options?.onLaunched;
  const skipLaunch = options?.skipLaunch;

  useEffect(() => {
    const handleAutoLaunch = (detail: AutoLaunchTutorialDetail) => {
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

    return autoLaunchChannel.subscribe(handleAutoLaunch);
  }, [panel, onIncoming, onLaunched, skipLaunch]);
}
