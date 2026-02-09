import { useEffect, useState } from 'react';

import { interactiveStepStorage, interactiveCompletionStorage } from '../../../lib/user-storage';
import { getContentKey } from './get-content-key';
import { getTotalDocumentSteps } from './interactive-section';

/**
 * Synthetic section ID used for standalone steps (not inside an InteractiveSection).
 * Keeps storage keys consistent and separate from real sections.
 */
export const STANDALONE_SECTION_ID = '__standalone__';

/**
 * Promise queue to serialize standalone persistence operations.
 * Prevents race conditions when multiple steps complete simultaneously.
 */
let persistenceQueue = Promise.resolve();

/**
 * Queues a persistence operation to run after all previous operations complete.
 * This prevents read-modify-write races on shared storage.
 */
function queuePersistence(operation: () => Promise<void>): void {
  persistenceQueue = persistenceQueue.then(operation, operation);
}

/**
 * Provides persistence for standalone interactive steps (not inside a section).
 *
 * When a step is inside an InteractiveSection, the section manages persistence
 * via its own completed-steps set. For standalone steps (guides without sections),
 * this hook saves and restores completion state using interactiveStepStorage with
 * a synthetic section ID.
 *
 * The hook is a no-op when `onStepComplete` is defined (step is section-managed).
 *
 * @param renderedStepId - Stable step ID (from props or auto-generated)
 * @param isLocallyCompleted - Current local completion state
 * @param setIsLocallyCompleted - State setter for local completion
 * @param onStepComplete - If defined, step is section-managed and hook is inactive
 * @param totalSteps - Total standalone steps in the document (unused, kept for API compat)
 */
export function useStandalonePersistence(
  renderedStepId: string,
  isLocallyCompleted: boolean,
  setIsLocallyCompleted: (value: boolean) => void,
  onStepComplete: ((stepId: string) => void) | undefined,
  _totalSteps: number | undefined
): void {
  const isStandalone = !onStepComplete;
  // REACT: use state instead of ref to trigger re-renders (Bug Fix: c83d6abe-5bfa-408c-ad6d-b0281235f65d)
  const [hasRestored, setHasRestored] = useState(false);

  // Restore completion state from storage on mount
  useEffect(() => {
    if (!isStandalone) {
      return;
    }

    const contentKey = getContentKey();
    interactiveStepStorage.getCompleted(contentKey, STANDALONE_SECTION_ID).then((restored) => {
      if (restored.has(renderedStepId)) {
        setIsLocallyCompleted(true);
      }
      setHasRestored(true);
    });
  }, [renderedStepId, isStandalone, setIsLocallyCompleted]);

  // Persist completion state changes (after initial restore completes)
  useEffect(() => {
    if (!isStandalone || !hasRestored) {
      return;
    }

    // REACT: serialize persistence operations to prevent race conditions (Bug Fix: ref1_b6d1eb3a-e58b-416b-b8de-133c6aa1b276)
    queuePersistence(async () => {
      const contentKey = getContentKey();
      const existing = await interactiveStepStorage.getCompleted(contentKey, STANDALONE_SECTION_ID);
      const updated = new Set(existing);
      if (isLocallyCompleted) {
        updated.add(renderedStepId);
      } else {
        updated.delete(renderedStepId);
      }
      await interactiveStepStorage.setCompleted(contentKey, STANDALONE_SECTION_ID, updated);

      // Compute unified completion percentage across ALL sections (including standalone)
      const docTotal = getTotalDocumentSteps();
      const allCompleted = interactiveStepStorage.countAllCompleted(contentKey);
      const percentage = docTotal > 0 ? Math.round((allCompleted / docTotal) * 100) : undefined;
      if (percentage !== undefined) {
        await interactiveCompletionStorage.set(contentKey, percentage);
      }

      // Dispatch progress event (mirrors InteractiveSection behavior)
      if (updated.size > 0 && typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('interactive-progress-saved', {
            detail: { contentKey, hasProgress: true, completionPercentage: percentage },
          })
        );
      }
    });
  }, [isLocallyCompleted, isStandalone, renderedStepId, hasRestored]);
}
