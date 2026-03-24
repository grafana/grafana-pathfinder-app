/**
 * Hook that tracks guide session duration and partial progress for CRD recording.
 *
 * - Starts a session timer when the active guide changes
 * - Listens for interactive-progress-saved events to record partial progress
 *
 * Does nothing when the backend API is unavailable.
 */

import { useEffect, useRef } from 'react';
import { startGuideSession, recordPartialProgress } from './guide-completion-tracker';
import { isBackendApiAvailable } from '../utils/fetchBackendGuides';

/**
 * Extracts a guide ID from a content URL.
 * Bundled guides: "bundled:explore-logs" → "explore-logs"
 * URL-based guides: uses the last path segment as an identifier.
 */
function extractGuideId(url: string): string {
  if (url.startsWith('bundled:')) {
    return url.slice('bundled:'.length);
  }
  // Use last meaningful path segment
  const segments = url.replace(/\/+$/, '').split('/');
  return segments[segments.length - 1] || url;
}

export function useGuideCompletionTracking(opts: {
  guideUrl: string | undefined;
  guideTitle: string | undefined;
  guideType: string | undefined;
}): void {
  const { guideUrl, guideTitle, guideType } = opts;
  const prevGuideUrlRef = useRef<string | undefined>();

  // Start session timer when guide changes
  useEffect(() => {
    if (!guideUrl || guideUrl === prevGuideUrlRef.current || !isBackendApiAvailable()) {
      return;
    }
    prevGuideUrlRef.current = guideUrl;
    const guideId = extractGuideId(guideUrl);
    const category = guideType === 'learning-journey' ? 'learning-journey' : 'interactive';
    startGuideSession(guideId, guideTitle || guideId, category);
  }, [guideUrl, guideTitle, guideType]);

  // Listen for partial progress events
  useEffect(() => {
    if (!guideUrl || !isBackendApiAvailable()) {
      return;
    }

    const handleProgressSaved = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const percent = detail?.completionPercentage;
      if (typeof percent !== 'number' || percent >= 100 || percent <= 0) {
        return;
      }

      const guideId = extractGuideId(guideUrl);
      const category: 'interactive' | 'documentation' | 'learning-journey' =
        guideType === 'learning-journey' ? 'learning-journey' : 'interactive';

      recordPartialProgress({
        guideId,
        guideTitle: guideTitle || guideId,
        guideCategory: category,
        pathId: '',
        completionPercent: percent,
      });
    };

    window.addEventListener('interactive-progress-saved', handleProgressSaved);
    return () => {
      window.removeEventListener('interactive-progress-saved', handleProgressSaved);
    };
  }, [guideUrl, guideTitle, guideType]);
}
