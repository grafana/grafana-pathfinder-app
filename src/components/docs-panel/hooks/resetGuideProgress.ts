import { evictContentCache } from '../../../global-state/completion-store';
import { StorageEvents } from '../../../lib/event-names';
import { interactiveCompletionStorage, interactiveStepStorage } from '../../../lib/user-storage';

export async function resetGuideProgress(contentKey: string): Promise<void> {
  await interactiveStepStorage.clearAllForContent(contentKey);
  await interactiveCompletionStorage.clear(contentKey);
  evictContentCache(contentKey);
  window.dispatchEvent(
    new CustomEvent(StorageEvents.InteractiveProgressCleared, {
      detail: { contentKey },
    })
  );
}
