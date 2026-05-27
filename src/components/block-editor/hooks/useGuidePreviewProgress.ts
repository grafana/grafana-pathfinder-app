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
 * Shared by BlockPreview (remounts the renderer on reset) and
 * BlockEditorHeader (renders the Reset button) — both subscribe to
 * `pathfinder:progress` with `kind: 'guide'` and stay in sync.
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
      // A `kind: 'guide'` payload for a preview key is authoritative when
      // it does land. Today the only producer is `reset()` below
      // (`hasProgress: false`); a `hasProgress: true` arrival would have
      // to come from a future non-preview producer that already knows
      // the preview key — in which case skipping the MF-3 fallback is
      // the correct behaviour, since the guide-level signal supersedes
      // the per-step inference.
      if (detail.kind === 'guide' && matchesContentKey(detail, progressKey)) {
        setHasProgress(detail.hasProgress);
        return;
      }
      // MF-3 — preview mode suppresses `kind: 'guide'` in `persistSection`
      // (no document total → no percentage), so fall back to step / section
      // events when the active content key matches.
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
      // Otherwise `useStepCompletion` subscribers still see the prior
      // snapshot until remount.
      evictContentCache(progressKey);
      setHasProgress(false);
      dispatchProgress({ kind: 'guide', contentKey: progressKey, percentage: 0, hasProgress: false });
    } catch (error) {
      console.error('[useGuidePreviewProgress] Failed to reset progress:', error);
    }
  }, [progressKey]);

  return { hasProgress, reset };
}
