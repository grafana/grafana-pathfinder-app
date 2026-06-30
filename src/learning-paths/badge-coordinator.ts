/**
 * Badge + progress coordinator.
 *
 * Owns the "a guide just completed" orchestration that previously lived
 * inside `learningProgressStorage.markGuideCompleted` in `lib/user-storage.ts`.
 * Moving it here resolves the smoking-gun structural violation captured in
 * `.cursor/local/USER_STORAGE.md` Section 3:
 *
 *     'lib/user-storage.ts -> learning-paths'
 *
 * The Tier 1 storage module used to dynamically import Tier 2 badge logic
 * (`getBadgesToAward`, `getBadgeById`, `getPathsData`,
 * `calculateUpdatedStreak`) and fire `reportAppInteraction(BadgeUnlocked)`
 * from inside a storage write. That inverted the layering rule that Tier 1
 * may not depend on Tier 2.
 *
 * This module now sits in Tier 2 (`learning-paths/`) and imports *down*
 * into Tier 1 (`learningProgressStorage`) for persistence, which is the
 * direction the architecture test enforces. Storage stores; the coordinator
 * orchestrates.
 */

import { reportAppInteraction, UserInteraction } from '../lib/analytics';
import { StorageEvents } from '../lib/event-names';
import { learningProgressStorage } from '../lib/user-storage';

import { getBadgeById, getBadgesToAward } from './badges';
import { getPathsData } from './paths-data';
import { calculateUpdatedStreak } from './streak-tracker';

/**
 * Marks a guide as completed, evaluates badge awards, updates the streak,
 * persists the new progress, and fires both the `BadgeUnlocked` analytics
 * event and the `StorageEvents.LearningProgressUpdated` window event.
 *
 * Idempotent for already-completed guides — repeats are a no-op except for
 * the trailing event dispatch (preserved so UI listeners that re-render
 * off completion still receive a tick).
 *
 * Replaces the previous `learningProgressStorage.markGuideCompleted` entry
 * point. Callers that used to invoke storage directly should call this
 * coordinator instead.
 */
export async function markGuideCompleted(guideId: string): Promise<void> {
  try {
    const paths = getPathsData().paths;
    const progress = await learningProgressStorage.get();

    if (!progress.completedGuides.includes(guideId)) {
      progress.completedGuides.push(guideId);

      // Calculate the streak using the previous lastActivityDate, then advance
      // lastActivityDate to today.
      const today = new Date().toISOString().split('T')[0]!;
      progress.streakDays = calculateUpdatedStreak(progress.streakDays, progress.lastActivityDate);
      progress.lastActivityDate = today;

      // Track only the badges newly awarded in this call so the
      // `LearningProgressUpdated` event payload doesn't include badges the
      // user already saw a celebration for.
      const newlyAwardedBadges: string[] = [];
      const badgesToAward = getBadgesToAward(progress, paths);

      for (const badgeId of badgesToAward) {
        if (!progress.earnedBadges.some((b) => b.id === badgeId)) {
          progress.earnedBadges.push({ id: badgeId, earnedAt: Date.now() });
          if (!progress.pendingCelebrations.includes(badgeId)) {
            progress.pendingCelebrations.push(badgeId);
          }
          newlyAwardedBadges.push(badgeId);

          const badge = getBadgeById(badgeId);
          reportAppInteraction(UserInteraction.BadgeUnlocked, {
            badge_id: badgeId,
            badge_title: badge?.title || badgeId,
            trigger_type: badge?.trigger?.type || 'unknown',
          });
        }
      }

      await learningProgressStorage.update(progress);

      window.dispatchEvent(
        new CustomEvent(StorageEvents.LearningProgressUpdated, {
          detail: {
            type: 'guide-completed',
            guideId,
            newBadges: newlyAwardedBadges,
            progress: { ...progress }, // Clone so listeners can't mutate stored state
          },
        })
      );
    }
  } catch (error) {
    console.error('Failed to mark guide as completed:', error);
    // Still dispatch the event so UI components that wait on completion
    // are not left hanging.
    window.dispatchEvent(
      new CustomEvent(StorageEvents.LearningProgressUpdated, {
        detail: {
          type: 'guide-completed',
          guideId,
          newBadges: [],
          error: true,
        },
      })
    );
  }
}
