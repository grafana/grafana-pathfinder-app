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
 * Persist a standalone step's completion state, update the completion percentage,
 * and dispatch the progress event.
 *
 * Extracted from the hook so both the restore and persist code paths can share it
 * without duplicating the storage + event logic.
 */
function persistStandaloneCompletion(
  contentKey: string,
  renderedStepId: string,
  isCompleted: boolean,
  existingCompleted: Set<string>
): void {
  const updated = new Set(existingCompleted);
  if (isCompleted) {
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
 * Race-condition handling: the restore effect is async (`getCompleted` returns a
 * promise). If the user completes a step before the restore resolves, the persist
 * effect would be skipped (because `hasRestoredRef` is still false) and the
 * restore callback would overwrite the user's `true` state with `false` from
 * storage. To prevent this, a `latestCompletedRef` tracks the live value of
 * `isLocallyCompleted`. The restore callback merges the stored value with the
 * current live value, preserving any user action that occurred during the async
 * window, and persists inline when needed.
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

  // REACT: ref tracks latest value so async callbacks avoid stale closures (R2)
  const latestCompletedRef = useRef(isLocallyCompleted);
  latestCompletedRef.current = isLocallyCompleted;

  // Reset restore guard when the step ID changes so the persist effect
  // doesn't run with stale state before the new restore completes.
  useEffect(() => {
    hasRestoredRef.current = false;
  }, [renderedStepId]);

  // Restore completion state from storage on mount (and when step ID changes)
  useEffect(() => {
    if (!isStandalone) {
      return;
    }

    let isMounted = true;
    const contentKey = getContentKey();

    interactiveStepStorage.getCompleted(contentKey, STANDALONE_SECTION_ID).then((restored) => {
      // REACT: ignore stale responses after unmount (R4)
      if (!isMounted) {
        return;
      }

      const fromStorage = restored.has(renderedStepId);
      const userCompletedDuringRestore = latestCompletedRef.current;

      // Merge: completed if EITHER storage says so OR the user already completed
      // the step while the async restore was in-flight. This prevents overwriting
      // a user's action with `false` from storage (race condition fix).
      const shouldBeCompleted = fromStorage || userCompletedDuringRestore;

      setIsLocallyCompleted(shouldBeCompleted);
      hasRestoredRef.current = true;

      // If the user completed during the race window but storage didn't have it,
      // the persist effect was skipped (hasRestoredRef was false). Persist inline
      // so the completion is not lost.
      if (userCompletedDuringRestore && !fromStorage) {
        persistStandaloneCompletion(contentKey, renderedStepId, true, restored);
      }
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
      persistStandaloneCompletion(contentKey, renderedStepId, isLocallyCompleted, existing);
    });

    return () => {
      isMounted = false;
    };
  }, [isLocallyCompleted, isStandalone, renderedStepId]);
}
