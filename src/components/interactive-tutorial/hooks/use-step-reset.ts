/**
 * Answer the section's reset signal.
 *
 * "Reset section", and Redo on any earlier step, clear the completion store
 * for the affected steps and then bump `resetTrigger`. Whatever a step keeps
 * OUTSIDE the store is its own to clear on that signal:
 *
 *   - local state that stands in for completion (a challenge's `'solved'`,
 *     a quiz's selection) — otherwise the step still renders as done;
 *   - the requirements FSM, whose terminal completed/skipped state also
 *     drives `isEnabled` — otherwise a reset step renders neither its
 *     controls (the store says not-completed) nor a way forward (the FSM
 *     says completed), which is how a skipped step became unresettable.
 *
 * `skipStoreWrite` is load-bearing: the section already wrote the store for
 * the whole tail, and letting each child's FSM reset write again would fan
 * out into the preceding steps the user meant to keep.
 */

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
 * Build the handler behind a step's Redo button.
 *
 * Redo is not a per-step operation: undoing step 2 has to re-lock steps 3
 * onwards, and only the section knows the roster. So a section-managed step
 * delegates to `onStepReset` — which clears the whole tail in one store write
 * and bumps `resetTrigger`, bringing every following step back through
 * `useStepResetSignal`. A standalone step has no tail and clears its own
 * entry. This is the shape `interactive-step`'s Redo has always had.
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
