import { evictContentCache } from '../../../global-state/completion-store';
import { dispatchInteractiveProgressCleared } from '../../../lib/event-names';
import { interactiveCompletionStorage, interactiveStepStorage } from '../../../lib/user-storage';

export async function resetGuideProgress(contentKey: string): Promise<void> {
  await interactiveStepStorage.clearAllForContent(contentKey);
  await interactiveCompletionStorage.clear(contentKey);
  // Storage removal does not invalidate mounted completion-store subscribers.
  evictContentCache(contentKey);
  dispatchInteractiveProgressCleared({ scope: 'content', contentKey });
}
