import { useEffect, useState } from 'react';
import { interactiveStepStorage } from '../lib/user-storage';
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

  useEffect(() => {
    let cancelled = false;
    const lookup = progressKey ? interactiveStepStorage.hasProgress(progressKey) : Promise.resolve(false);
    void lookup.then((value) => {
      if (!cancelled) {
        setHasInteractiveProgress(value);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [progressKey]);

  useEffect(() => {
    const unsubscribeProgress = subscribeProgressEvent((detail) => {
      if (detail.kind === 'guide' && detail.contentKey === progressKey && detail.hasProgress) {
        setHasInteractiveProgress(true);
      }
    });
    const handleProgressCleared = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.contentKey === progressKey) {
        setHasInteractiveProgress(false);
      }
    };
    window.addEventListener('interactive-progress-cleared', handleProgressCleared);
    return () => {
      unsubscribeProgress();
      window.removeEventListener('interactive-progress-cleared', handleProgressCleared);
    };
  }, [progressKey]);

  return { hasInteractiveProgress, progressKey };
}
