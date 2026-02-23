/**
 * Hook that owns the global badge celebration queue: state, queue processing,
 * subscription to learning-progress-updated, and dismiss handler.
 * Returns current badge to show, queue count, and onDismiss for BadgeUnlockedToast.
 */

import React from 'react';
import { learningProgressStorage } from '../../../lib/user-storage';

export interface UseBadgeCelebrationQueueResult {
  currentCelebrationBadge: string | null;
  queueCount: number;
  onDismiss: () => Promise<void>;
}

export function useBadgeCelebrationQueue(): UseBadgeCelebrationQueueResult {
  const [badgeCelebrationQueue, setBadgeCelebrationQueue] = React.useState<string[]>([]);
  const [currentCelebrationBadge, setCurrentCelebrationBadge] = React.useState<string | null>(null);
  const isProcessingQueueRef = React.useRef(false);

  // Process the badge queue - show next badge toast
  React.useEffect(() => {
    if (badgeCelebrationQueue.length > 0 && !currentCelebrationBadge && !isProcessingQueueRef.current) {
      isProcessingQueueRef.current = true;
      const timer = setTimeout(
        () => {
          const [nextBadge, ...remaining] = badgeCelebrationQueue;
          setBadgeCelebrationQueue(remaining);
          setCurrentCelebrationBadge(nextBadge ?? null);
          isProcessingQueueRef.current = false;
        },
        currentCelebrationBadge === null ? 0 : 500
      );

      return () => clearTimeout(timer);
    }
    return undefined;
  }, [badgeCelebrationQueue, currentCelebrationBadge]);

  // Listen for badge award events globally (only set up once)
  React.useEffect(() => {
    const handleProgressUpdate = (event: Event) => {
      const detail = (event as CustomEvent).detail;

      if (detail?.type === 'guide-completed' && detail?.newBadges?.length > 0) {
        const newBadges = detail.newBadges.slice(0, 3) as string[];
        setBadgeCelebrationQueue((prev) => [...prev, ...newBadges]);
      }
    };

    window.addEventListener('learning-progress-updated', handleProgressUpdate);

    return () => {
      window.removeEventListener('learning-progress-updated', handleProgressUpdate);
    };
  }, []);

  const onDismiss = React.useCallback(async () => {
    const badgeId = currentCelebrationBadge;
    if (badgeId) {
      setCurrentCelebrationBadge(null);
      await learningProgressStorage.dismissCelebration(badgeId);
    }
  }, [currentCelebrationBadge]);

  return {
    currentCelebrationBadge,
    queueCount: badgeCelebrationQueue.length,
    onDismiss,
  };
}
