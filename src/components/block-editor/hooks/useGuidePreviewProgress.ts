import { useCallback, useEffect, useState } from 'react';
import { interactiveStepStorage, interactiveCompletionStorage } from '../../../lib/user-storage';
import { evictContentCache } from '../../../global-state/completion-store';
import { getContentKey } from '../../../global-state/content-key';
import { dispatchProgress, matchesContentKey, subscribeProgressEvent } from '../../../global-state/progress-events';

export interface GuidePreviewProgress {
  hasProgress: boolean;
  reset: () => Promise<void>;
}

/**
 * Tracks interactive progress for a previewed guide and exposes a reset action.
 *
 * The same logical state needs to be observable from both BlockPreview (which
 * remounts the renderer on reset) and BlockEditorHeader (which renders the
 * Reset button in preview mode). Both call-sites use this hook with the same
 * `progressKey` and stay in sync via the unified `pathfinder:progress` event
 * (kind === 'guide'). `hasProgress: false` is the canonical clear signal;
 * `contentKey: '*'` broadcasts a clear across every preview.
 */
export function useGuidePreviewProgress(progressKey: string): GuidePreviewProgress {
  const [hasProgress, setHasProgress] = useState(false);

  useEffect(() => {
    let cancelled = false;
    interactiveStepStorage.hasProgress(progressKey).then((value) => {
      if (!cancelled) {
        setHasProgress(value);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [progressKey]);

  useEffect(() => {
    return subscribeProgressEvent((detail) => {
      if (detail.kind === 'guide' && matchesContentKey(detail, progressKey)) {
        setHasProgress(detail.hasProgress);
        return;
      }
      // MF-3 — preview mode suppresses `kind: 'guide'` in `persistSection`
      // (no document total → no percentage), so the Reset button would
      // otherwise be unreachable in preview. Flip on per-step / per-section
      // completion events whose active content key matches this preview
      // hook's progress key. Reads `getContentKey()` lazily because the
      // hook isn't necessarily mounted under the same active tab.
      if (
        (detail.kind === 'step' || detail.kind === 'section') &&
        detail.completed === true &&
        getContentKey() === progressKey
      ) {
        setHasProgress(true);
      }
    });
  }, [progressKey]);

  const reset = useCallback(async () => {
    try {
      await interactiveStepStorage.clearAllForContent(progressKey);
      await interactiveCompletionStorage.clear(progressKey);
      // Drop the completion store's in-memory cache too — otherwise
      // `useStepCompletion` subscribers still see the prior snapshot
      // and the preview keeps showing steps as completed until remount.
      evictContentCache(progressKey);
      setHasProgress(false);
      dispatchProgress({ kind: 'guide', contentKey: progressKey, percentage: 0, hasProgress: false });
    } catch (error) {
      console.error('[useGuidePreviewProgress] Failed to reset progress:', error);
    }
  }, [progressKey]);

  return { hasProgress, reset };
}
