import { useEffect, useState } from 'react';
import { interactiveStepStorage } from '../lib/user-storage';
import { matchesContentKey, subscribeProgressEvent } from '../global-state/progress-events';

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
    return subscribeProgressEvent((detail) => {
      if (detail.kind === 'guide' && matchesContentKey(detail, progressKey)) {
        setHasInteractiveProgress(detail.hasProgress);
      }
    });
  }, [progressKey]);

  return { hasInteractiveProgress, progressKey };
}
