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

    // Reset hasRestored flag when step ID changes to prevent stale state persistence
    hasRestoredRef.current = false;

    let isMounted = true;
    const contentKey = getContentKey();

    interactiveStepStorage.getCompleted(contentKey, STANDALONE_SECTION_ID).then((restored) => {
      // REACT: ignore stale responses after unmount (R4)
      if (!isMounted) {
        return;
      }
      if (restored.has(renderedStepId)) {
        setIsLocallyCompleted(true);
      } else {
        // Reset to false when not found to clear stale state from previous step
        setIsLocallyCompleted(false);
      }
      hasRestoredRef.current = true;
    });

    return () => {
      isMounted = false;
    };
  }, [renderedStepId, isStandalone, setIsLocallyCompleted]);

  // Persist completion state changes (after initial restore completes)
  useEffect(() => {
    if (!isStandalone || !hasRestoredRef.current) {
      return;
    }

    let isMounted = true;
    const contentKey = getContentKey();

    interactiveStepStorage.getCompleted(contentKey, STANDALONE_SECTION_ID).then((existing) => {
      // REACT: ignore stale responses after unmount (R4)
      if (!isMounted) {
        return;
      }

      const updated = new Set(existing);
      if (isLocallyCompleted) {
        updated.add(renderedStepId);
      } else {
        updated.delete(renderedStepId);
      }
      interactiveStepStorage.setCompleted(contentKey, STANDALONE_SECTION_ID, updated);

      // Compute unified completion percentage across ALL sections (including standalone)
      // Defensive: don't calculate percentage until document steps are registered (docTotal >= 1)
      const docTotal = getTotalDocumentSteps();
      const allCompleted = interactiveStepStorage.countAllCompleted(contentKey);
      const percentage = docTotal >= 1 ? Math.round((allCompleted / docTotal) * 100) : undefined;
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

    return () => {
      isMounted = false;
    };
  }, [isLocallyCompleted, isStandalone, renderedStepId]);
}
