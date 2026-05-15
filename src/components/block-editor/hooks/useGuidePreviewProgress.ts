import { useCallback, useEffect, useState } from 'react';
import { interactiveStepStorage, interactiveCompletionStorage } from '../../../lib/user-storage';

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
 * `progressKey` and stay in sync via the `interactive-progress-saved` /
 * `interactive-progress-cleared` document events.
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
    const handleSaved = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.contentKey === progressKey && detail?.hasProgress) {
        setHasProgress(true);
      }
    };
    const handleCleared = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.contentKey === progressKey) {
        setHasProgress(false);
      }
    };

    window.addEventListener('interactive-progress-saved', handleSaved);
    window.addEventListener('interactive-progress-cleared', handleCleared);
    return () => {
      window.removeEventListener('interactive-progress-saved', handleSaved);
      window.removeEventListener('interactive-progress-cleared', handleCleared);
    };
  }, [progressKey]);

  const reset = useCallback(async () => {
    try {
      await interactiveStepStorage.clearAllForContent(progressKey);
      await interactiveCompletionStorage.clear(progressKey);
      setHasProgress(false);
      window.dispatchEvent(
        new CustomEvent('interactive-progress-cleared', {
          detail: { contentKey: progressKey },
        })
      );
    } catch (error) {
      console.error('[useGuidePreviewProgress] Failed to reset progress:', error);
    }
  }, [progressKey]);

  return { hasProgress, reset };
}
