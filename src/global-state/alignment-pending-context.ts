/**
 * React context that broadcasts the active tab's implied-0th-step alignment
 * state to descendants of `<ContentRenderer>`.
 *
 * Two consumers:
 *  - `useStepChecker` reads `isPending` and gates `isEligibleForChecking` so
 *    step 1's requirement checks don't race the user's redirect decision.
 *  - `interactive-section` reads `startingLocation` to show a clear "this
 *    guide starts on /xxx" hint inside each section when the prompt is up
 *    (handy when the user scrolls past the top banner).
 *
 * The default value is the cleared state so consumers mounted outside a
 * provider (tests, isolated components) behave as if no prompt were pending.
 *
 * @see src/recovery/alignment-evaluator.ts
 * @see src/types/content-panel.types.ts (PendingAlignment)
 */

import { createContext, useContext } from 'react';

export interface AlignmentPendingState {
  isPending: boolean;
  startingLocation: string | null;
}

const DEFAULT_STATE: AlignmentPendingState = { isPending: false, startingLocation: null };

export const AlignmentPendingContext = createContext<AlignmentPendingState>(DEFAULT_STATE);

/**
 * True when the active tab has a pending alignment prompt (implied 0th step).
 * Returns `false` outside a provider.
 */
export function useIsAlignmentPaused(): boolean {
  return useContext(AlignmentPendingContext).isPending;
}

/**
 * The active tab's pending startingLocation, or `null` if no prompt is up.
 * Use to render in-context hints (e.g., "this guide starts on /connections")
 * in components that aren't the top-level prompt itself.
 */
export function useAlignmentStartingLocation(): string | null {
  return useContext(AlignmentPendingContext).startingLocation;
}
