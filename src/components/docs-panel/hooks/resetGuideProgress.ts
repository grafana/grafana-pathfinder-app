import { invalidateEmittedCompletion, resolveCompletionIdentity } from '../../../completion-records';
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
}

/**
 * Best-effort fallback identity when no manifest is in hand. A journey
 * milestone is addressed by a web URL but recorded under its slug alone
 * (`markMilestoneDone`), so reduce one the same way `getMilestoneSlug` does —
 * otherwise the reset lifts the guard under a key no record was ever written
 * under. Scheme-addressed keys keep the stripping the recorders use for them.
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
  // completion this reset just erased.
  const { guideSource, guideId } = resolveCompletionIdentity({
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
