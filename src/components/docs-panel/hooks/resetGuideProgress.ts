import {
  invalidateEmittedCompletion,
  resolveCompletionIdentity,
  resolveMilestoneCompletionIdentity,
} from '../../../completion-records';
import { evictContentCache } from '../../../global-state/completion-store';
import { StorageEvents } from '../../../lib/event-names';
import { getMilestoneSlug } from '../../../lib/learning-journey-url';
import {
  guideCompletionMarkStorage,
  interactiveCompletionStorage,
  interactiveStepStorage,
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
}

/**
 * Best-effort fallback identity for an ORDINARY (non-milestone) guide when no
 * manifest is in hand. Never used for a milestone — see `milestoneSlug` above.
 */
function fallbackGuideIdFromContentKey(contentKey: string): string {
  if (/^https?:\/\//.test(contentKey)) {
    return getMilestoneSlug(contentKey) || contentKey;
  }
  return contentKey.replace(/^(bundled|backend-guide):/, '').replace(/\/content\.json$/, '');
}

export async function resetGuideProgress(contentKey: string, identity?: ResetGuideProgressIdentity): Promise<void> {
  await interactiveStepStorage.clearAllForContent(contentKey);
  await interactiveCompletionStorage.clear(contentKey);
  await guideCompletionMarkStorage.clear(contentKey);
  // Storage removal does not invalidate mounted completion-store subscribers.
  evictContentCache(contentKey);
  // Lifts the write-side exactly-once guard so re-marking this guide after
  // the reset emits a fresh durable record instead of deduping against the
  // completion this reset just erased. A milestone's identity is derived
  // through the SAME function markMilestoneDone uses, not resolved here
  // independently — a manifest, if present, is never allowed to outrank the
  // slug for a milestone the way it correctly does for an ordinary guide.
  const { guideSource, guideId } = identity?.milestoneSlug
    ? resolveMilestoneCompletionIdentity({
        repository: identity.repository,
        packageManifest: identity.packageManifest,
        milestoneSlug: identity.milestoneSlug,
      })
    : resolveCompletionIdentity({
        packageManifest: identity?.packageManifest,
        repository: identity?.repository,
        fallbackId: fallbackGuideIdFromContentKey(contentKey),
        fallbackSource: 'bundled',
      });
  invalidateEmittedCompletion(guideSource, guideId);
  window.dispatchEvent(
    new CustomEvent(StorageEvents.InteractiveProgressCleared, {
      detail: { contentKey },
    })
  );
}
