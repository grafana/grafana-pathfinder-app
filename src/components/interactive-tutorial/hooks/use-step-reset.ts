import { useCallback, useEffect } from 'react';

import { resetStep as resetStepInStore } from '../../../global-state/completion-store';

interface StepResetSignal {
  /** Signal value the parent section bumps; absent for a standalone step. */
  resetTrigger: number | undefined;
  /** Clear local state that survives a store-only reset. */
  clearLocalState?: () => void;
  /** `useStepChecker`'s `resetStep`. */
  resetChecker?: (options?: { skipStoreWrite?: boolean }) => void;
}

/**
 * Clear what a step keeps outside the completion store when the section resets:
 * local state standing in for completion, and the requirements FSM, whose
 * terminal state also drives `isEnabled`.
 */
export function useStepResetSignal({ resetTrigger, clearLocalState, resetChecker }: StepResetSignal): void {
  useEffect(() => {
    if (!resetTrigger || resetTrigger <= 0) {
      return;
    }
    clearLocalState?.();
    resetChecker?.({ skipStoreWrite: true });
  }, [resetTrigger]); // eslint-disable-line react-hooks/exhaustive-deps
}

interface StepRedo extends Omit<StepResetSignal, 'resetTrigger'> {
  stepId: string;
  sectionId: string | undefined;
  /** The section's tail reset; absent for a standalone step. */
  onStepReset?: (stepId: string) => void;
}

/**
 * Redo is not per-step: undoing step 2 has to re-lock steps 3 onwards, and only
 * the section knows the roster, so a section-managed step delegates the whole
 * tail to `onStepReset` rather than writing the store itself.
 */
export function useStepRedo({ stepId, sectionId, onStepReset, clearLocalState, resetChecker }: StepRedo): () => void {
  return useCallback(() => {
    clearLocalState?.();
    if (onStepReset) {
      onStepReset(stepId);
      resetChecker?.({ skipStoreWrite: true });
      return;
    }
    resetStepInStore(stepId, sectionId);
    resetChecker?.();
  }, [stepId, sectionId, onStepReset, clearLocalState, resetChecker]);
}
