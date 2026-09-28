import { useCallback, useEffect, useState } from 'react';
import { StorageEvents } from '../lib/event-names';
import { guideCompletionMarkStorage, interactiveStepStorage } from '../lib/user-storage';
import { subscribeProgressEvent } from '../global-state/progress-events';

interface ActiveTabSummary {
  currentUrl?: string;
  baseUrl?: string;
}

export function useGuideProgressState(activeTab: ActiveTabSummary | null | undefined): {
  hasInteractiveProgress: boolean;
  progressKey: string;
} {
  const progressKey = activeTab?.currentUrl || activeTab?.baseUrl || '';
  const [hasInteractiveProgress, setHasInteractiveProgress] = useState(false);

  // The guide-level mark counts as progress too, and it is the only progress a
  // prose-only guide can carry — without it the reset affordance would be
  // hidden on exactly the guides the Mark complete control exists for.
  const readHasProgress = useCallback(async (): Promise<boolean> => {
    if (!progressKey) {
      return false;
    }
    const [hasSteps, mark] = await Promise.all([
      interactiveStepStorage.hasProgress(progressKey),
      guideCompletionMarkStorage.get(progressKey),
    ]);
    return hasSteps || mark === true;
  }, [progressKey]);

  useEffect(() => {
    let cancelled = false;
    void readHasProgress().then((value) => {
      if (!cancelled) {
        setHasInteractiveProgress(value);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [readHasProgress]);

  useEffect(() => {
    let cancelled = false;
    const unsubscribeProgress = subscribeProgressEvent((detail) => {
      if (detail.kind === 'guide' && detail.contentKey === progressKey && detail.hasProgress) {
        setHasInteractiveProgress(true);
      }
    });
    const handleProgressCleared = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.contentKey !== progressKey) {
        return;
      }
      // Not every clear is a guide reset — a step total falling to zero sends
      // the same signal — so re-read rather than assume: whatever the reset
      // paths actually cleared is what decides.
      void readHasProgress().then((value) => {
        if (!cancelled) {
          setHasInteractiveProgress(value);
        }
      });
    };
    window.addEventListener(StorageEvents.InteractiveProgressCleared, handleProgressCleared);
    return () => {
      cancelled = true;
      unsubscribeProgress();
      window.removeEventListener(StorageEvents.InteractiveProgressCleared, handleProgressCleared);
    };
  }, [progressKey, readHasProgress]);

  return { hasInteractiveProgress, progressKey };
}
