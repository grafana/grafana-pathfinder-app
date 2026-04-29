/**
 * React context that broadcasts whether an implied-0th-step alignment prompt
 * is currently pending on the active tab.
 *
 * `useStepChecker` reads this and gates `isEligibleForChecking` so step 1's
 * requirement checks don't race the user's redirect decision while the
 * alignment banner is visible. The default value is `false` so step-checkers
 * mounted outside a provider (tests, isolated components) behave normally.
 *
 * Set by the docs panel and floating panel render paths around their
 * `<ContentRenderer>` instances; cleared on confirm/dismiss.
 *
 * @see src/recovery/alignment-evaluator.ts
 * @see src/types/content-panel.types.ts (PendingAlignment)
 */

import { createContext, useContext } from 'react';

export const AlignmentPendingContext = createContext<boolean>(false);

/**
 * True when the active tab has a pending alignment prompt (implied 0th step).
 * Returns `false` outside a provider.
 */
export function useIsAlignmentPaused(): boolean {
  return useContext(AlignmentPendingContext);
}
