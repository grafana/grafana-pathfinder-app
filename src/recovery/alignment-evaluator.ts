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
 * Path-prefix match with a segment boundary: `currentPath` must be either an
 * exact match for `startingLocation` or a strict descendant of it.
 *
 * Earlier versions used `currentPath.includes(startingLocation)` to mirror
 * `onPageCheck` in `src/requirements-manager/checks/location.ts`, but that
 * substring rule yields false positives for unrelated paths whose names
 * happen to contain the starting location: `/connections-new` would match
 * `/connections`, and `/explore/metrics` would match `/metrics`. We do
 * proper segment-boundary matching here; the legacy `onPageCheck` rule is
 * a separate concern.
 *
 * Trailing slashes are normalized so `/connections` and `/connections/`
 * compare equal.
 */
export function pathMatchesStartingLocation(currentPath: string, startingLocation: string): boolean {
  const stripTrailingSlash = (p: string): string => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p);
  const cur = stripTrailingSlash(currentPath);
  const target = stripTrailingSlash(startingLocation);

  // Root special case: only `/` matches `/`. Without this branch, a `target`
  // of `/` would slip into the `startsWith('/' + '/')` check below and never
  // match anything except literal `//foo`.
  if (target === '/' || target === '') {
    return cur === '/' || cur === '';
  }

  return cur === target || cur.startsWith(target + '/');
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
