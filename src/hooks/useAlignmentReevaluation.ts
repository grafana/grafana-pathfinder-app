import { useEffect, useRef, useState } from 'react';
import { locationService } from '@grafana/runtime';
import { interactiveStepStorage } from '../lib/user-storage';
import { isInteractiveNavigationInProgress } from '../global-state/interactive-navigation';

interface ActiveTabSummary {
  currentUrl?: string;
  baseUrl?: string;
}

interface AlignmentReevaluationTarget {
  reevaluateAlignment: (tabId: string, currentPath: string) => void;
}

/**
 * Reactive implied-0th-step re-evaluation.
 *
 * While the user has not made progress on the active guide, listen for
 * location changes and call `panel.reevaluateAlignment(tabId, pathname)` so
 * the alignment prompt appears (or clears) as they navigate. Once the user
 * completes any step, the gate flips off — we trust they are "in" the guide
 * and should not be second-guessed by location alone.
 *
 * Returns `hasInteractiveProgress` so consumers can gate UI on the same
 * state used by the listener, plus the derived `progressKey` for callers
 * that need to act on the same key (e.g. reset-guide actions).
 */
export function useAlignmentReevaluation(
  panel: AlignmentReevaluationTarget,
  activeTabId: string | undefined,
  activeTab: ActiveTabSummary | null | undefined
): { hasInteractiveProgress: boolean; progressKey: string } {
  const progressKey = activeTab?.currentUrl || activeTab?.baseUrl || '';
  const [hasInteractiveProgress, setHasInteractiveProgress] = useState(false);

  useEffect(() => {
    if (progressKey) {
      void interactiveStepStorage.hasProgress(progressKey).then(setHasInteractiveProgress);
    } else {
      setHasInteractiveProgress(false);
    }
  }, [progressKey]);

  useEffect(() => {
    const handleProgressSaved = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.contentKey === progressKey && detail?.hasProgress) {
        setHasInteractiveProgress(true);
      }
    };
    const handleProgressCleared = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.contentKey === progressKey) {
        setHasInteractiveProgress(false);
      }
    };
    window.addEventListener('interactive-progress-saved', handleProgressSaved);
    window.addEventListener('interactive-progress-cleared', handleProgressCleared);
    return () => {
      window.removeEventListener('interactive-progress-saved', handleProgressSaved);
      window.removeEventListener('interactive-progress-cleared', handleProgressCleared);
    };
  }, [progressKey]);

  const activeTabIdRef = useRef(activeTabId);
  const hasInteractiveProgressRef = useRef(hasInteractiveProgress);
  // Refs must be current at the moment the listener fires. `history.listen`
  // can fire synchronously during a `locationService.push`, before any
  // pending effect from the same render cycle has run — so updating the refs
  // in an effect leaves a stale-read window. Assigning during render matches
  // commit timing and is the established pattern for closure-mirror refs.
  /* eslint-disable react-hooks/refs -- Intentional: closure-mirror refs must be in sync at commit time, not after effects. */
  activeTabIdRef.current = activeTabId;
  hasInteractiveProgressRef.current = hasInteractiveProgress;
  /* eslint-enable react-hooks/refs */

  useEffect(() => {
    const history = locationService.getHistory();
    const unlisten = history.listen((newLocation: { pathname: string }) => {
      // Skip guide-driven navigations (e.g. "Go there", "Fix this") — they are
      // not user wandering, and at this moment the just-completed step's
      // progress flag may not have propagated yet.
      if (isInteractiveNavigationInProgress()) {
        return;
      }
      if (hasInteractiveProgressRef.current) {
        return;
      }
      const tabId = activeTabIdRef.current;
      if (!tabId || tabId === 'recommendations' || tabId === 'editor' || tabId === 'devtools') {
        return;
      }
      panel.reevaluateAlignment(tabId, newLocation.pathname);
    });
    return unlisten;
  }, [panel]);

  return { hasInteractiveProgress, progressKey };
}
