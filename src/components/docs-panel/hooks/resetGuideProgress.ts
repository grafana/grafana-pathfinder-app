import { evictContentCache } from '../../../global-state/completion-store';
import { StorageEvents } from '../../../lib/event-names';
import { interactiveCompletionStorage, interactiveStepStorage } from '../../../lib/user-storage';

export async function resetGuideProgress(contentKey: string): Promise<void> {
  await interactiveStepStorage.clearAllForContent(contentKey);
  await interactiveCompletionStorage.clear(contentKey);
  // Storage removal does not invalidate mounted completion-store subscribers.
  evictContentCache(contentKey);
  window.dispatchEvent(
    new CustomEvent(StorageEvents.InteractiveProgressCleared, {
      detail: { contentKey },
    })
  );
}
