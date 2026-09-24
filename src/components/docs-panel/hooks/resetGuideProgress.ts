import {
  invalidateEmittedCompletion,
  normalizeGuideId,
  resolveMilestoneCompletionIdentity,
  resolveBundledGuideCompletionIdentity,
  resolveStandaloneGuideCompletionIdentity,
} from '../../../completion-records';
import { evictContentCache } from '../../../global-state/completion-store';
import { StorageEvents } from '../../../lib/event-names';
import { getMilestoneSlug } from '../../../lib/learning-journey-url';
import {
  guideCompletionMarkStorage,
  interactiveCompletionStorage,
  interactiveStepStorage,
  milestoneCompletionStorage,
} from '../../../lib/user-storage';

export interface ResetGuideProgressIdentity {
  packageManifest?: Record<string, unknown>;
  repository?: string;
  /**
   * Set exactly when `resolveActiveMilestoneSlug` (learning-journey-helpers.ts)
   * resolves one for the content being reset — the same predicate
   * `recordGuideCompletionForSurface` uses to decide whether to call
   * `markMilestoneDone`. When present, identity resolves through
   * `resolveMilestoneCompletionIdentity` (always the slug) rather than the
   * ordinary manifest-preferring path, matching the writer exactly.
   */
  milestoneSlug?: string;
  /**
   * The journey base URL `resolveActiveMilestoneSlug` resolved `milestoneSlug`
   * against — required to also clear the legacy `milestoneCompletionStorage`
   * record for this one slug. Without this, a pre-migration completion still
   * sitting in that read-only legacy store gets read back by
   * `backfillLegacyMilestoneCompletion` on the very next render and silently
   * rewrites this reset back to done. Absent exactly when `milestoneSlug` is
   * (see that field's own doc comment).
   */
  journeyBaseUrl?: string;
}

/**
 * Best-effort fallback identity for an ORDINARY (non-milestone) guide when no
 * manifest is in hand. Never used for a milestone — see `milestoneSlug` above.
 */
function fallbackGuideIdFromContentKey(contentKey: string): string {
  if (/^https?:\/\//.test(contentKey)) {
    return getMilestoneSlug(contentKey) || contentKey;
  }
  // Suffix stripping goes through the single shared derivation so the reset path
  // and the journey writer can never disagree about a bundled guide's identity.
  return normalizeGuideId(contentKey.replace(/^(bundled|backend-guide):/, ''));
}

export async function resetGuideProgress(contentKey: string, identity?: ResetGuideProgressIdentity): Promise<void> {
  await interactiveStepStorage.clearAllForContent(contentKey);
  await interactiveCompletionStorage.clear(contentKey);
  await guideCompletionMarkStorage.clear(contentKey);
  if (identity?.milestoneSlug && identity.journeyBaseUrl) {
    await milestoneCompletionStorage.removeCompleted(identity.journeyBaseUrl, identity.milestoneSlug);
  }
  // Storage removal does not invalidate mounted completion-store subscribers.
  evictContentCache(contentKey);
  // Lifts the write-side exactly-once guard so re-marking this guide after
  // the reset emits a fresh durable record instead of deduping against the
  // completion this reset just erased. A milestone's identity is derived
  // through the SAME function markMilestoneDone uses, not resolved here
  // independently — a manifest, if present, is never allowed to outrank the
  // slug for a milestone the way it correctly does for an ordinary guide.
  // Which writer would have recorded this guide decides which shared
  // identity derivation the reset must match — recordGuideCompletionForSurface
  // uses the exact same `bundled:` prefix check to choose between
  // recordBundledGuideCompletion and recordStandaloneGuideCompletion, and
  // each keys its fallback source differently ('bundled' vs the schema
  // default). Guessing one fallback for both is what let a standalone
  // guide's manifest-with-no-repository shape drop its guard
  // (identity-divergence, guideSource axis).
  const resolveIdentity = contentKey.startsWith('bundled:')
    ? resolveBundledGuideCompletionIdentity
    : resolveStandaloneGuideCompletionIdentity;
  const { guideSource, guideId } = identity?.milestoneSlug
    ? resolveMilestoneCompletionIdentity({
        repository: identity.repository,
        packageManifest: identity.packageManifest,
        milestoneSlug: identity.milestoneSlug,
      })
    : resolveIdentity({
        packageManifest: identity?.packageManifest,
        repository: identity?.repository,
        guideId: fallbackGuideIdFromContentKey(contentKey),
      });
  invalidateEmittedCompletion(guideSource, guideId);
  window.dispatchEvent(
    new CustomEvent(StorageEvents.InteractiveProgressCleared, {
      detail: { contentKey },
    })
  );
}
