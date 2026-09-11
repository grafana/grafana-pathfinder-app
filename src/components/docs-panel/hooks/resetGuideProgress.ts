import { invalidateEmittedCompletion, resolveCompletionIdentity } from '../../../completion-records';
import { evictContentCache } from '../../../global-state/completion-store';
import { StorageEvents } from '../../../lib/event-names';
import {
  guideCompletionMarkStorage,
  interactiveCompletionStorage,
  interactiveStepStorage,
} from '../../../lib/user-storage';

export interface ResetGuideProgressIdentity {
  packageManifest?: Record<string, unknown>;
  repository?: string;
}

/** Best-effort fallback identity when no manifest is in hand — matches the stripping already used in learning-journey-helpers.ts. */
function fallbackGuideIdFromContentKey(contentKey: string): string {
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
