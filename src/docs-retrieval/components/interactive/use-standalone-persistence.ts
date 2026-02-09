import { useEffect, useRef } from 'react';

import { interactiveStepStorage, interactiveCompletionStorage } from '../../../lib/user-storage';
import { getContentKey } from './get-content-key';
import { getTotalDocumentSteps } from './interactive-section';

/**
 * Synthetic section ID used for standalone steps (not inside an InteractiveSection).
 * Keeps storage keys consistent and separate from real sections.
 */
export const STANDALONE_SECTION_ID = '__standalone__';

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
  const hasRestoredRef = useRef(false);

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
      hasRestoredRef.current = true;
    });
  }, [renderedStepId, isStandalone, setIsLocallyCompleted]);

  // Persist completion state changes (after initial restore completes)
  useEffect(() => {
    if (!isStandalone || !hasRestoredRef.current) {
      return;
    }

    const contentKey = getContentKey();
    interactiveStepStorage.getCompleted(contentKey, STANDALONE_SECTION_ID).then((existing) => {
      const updated = new Set(existing);
      if (isLocallyCompleted) {
        updated.add(renderedStepId);
      } else {
        updated.delete(renderedStepId);
      }
      interactiveStepStorage.setCompleted(contentKey, STANDALONE_SECTION_ID, updated);

      // Compute unified completion percentage across ALL sections (including standalone)
      const docTotal = getTotalDocumentSteps();
      const allCompleted = interactiveStepStorage.countAllCompleted(contentKey);
      const percentage = docTotal > 0 ? Math.round((allCompleted / docTotal) * 100) : undefined;
      if (percentage !== undefined) {
        interactiveCompletionStorage.set(contentKey, percentage);
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
  }, [isLocallyCompleted, isStandalone, renderedStepId]);
}
