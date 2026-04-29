/**
 * Pure evaluator for the implied 0th step.
 *
 * Given the current path, the guide's declared starting location, and the
 * launch source, decide whether to prompt the user to navigate before step 1
 * begins.
 *
 * @see docs/design/AUTORECOVERY_DESIGN.md § "The implied 0th step"
 */

import { isAlignedByConstruction } from './launch-sources';

export type AlignmentReason =
  | 'aligned' // currentPath matches startingLocation
  | 'no-starting-location' // guide doesn't declare one
  | 'source-skipped' // launchSource is aligned-by-construction
  | 'mismatch'; // -> shouldPrompt: true

export interface AlignmentEvaluation {
  shouldPrompt: boolean;
  reason: AlignmentReason;
}

export interface EvaluateAlignmentInput {
  currentPath: string;
  startingLocation: string | null;
  launchSource: string | undefined;
}

/**
 * True when `currentPath` satisfies a guide that declares `startingLocation`.
 *
 * Mirrors `onPageCheck` semantics in
 * `src/requirements-manager/checks/location.ts`: a path is aligned if it is
 * an exact match OR contains the starting location as a substring. Keeping
 * the rule consistent ensures step 1's `on-page` requirement (if declared)
 * also passes once we navigate.
 */
export function pathMatchesStartingLocation(currentPath: string, startingLocation: string): boolean {
  return currentPath === startingLocation || currentPath.includes(startingLocation);
}

export function evaluateAlignment(input: EvaluateAlignmentInput): AlignmentEvaluation {
  const { currentPath, startingLocation, launchSource } = input;

  if (!startingLocation) {
    return { shouldPrompt: false, reason: 'no-starting-location' };
  }

  if (pathMatchesStartingLocation(currentPath, startingLocation)) {
    return { shouldPrompt: false, reason: 'aligned' };
  }

  if (isAlignedByConstruction(launchSource)) {
    return { shouldPrompt: false, reason: 'source-skipped' };
  }

  return { shouldPrompt: true, reason: 'mismatch' };
}
