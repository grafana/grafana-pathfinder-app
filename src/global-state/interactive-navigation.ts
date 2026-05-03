/**
 * Module-level flag for navigations driven by the interactive engine.
 *
 * Some interactive actions (e.g. "Go there", `fixLocationRequirement`) call
 * `locationService.push` synchronously. Anything that reacts to location
 * changes — notably `useAlignmentReevaluation` — needs to distinguish these
 * guide-driven navigations from genuine user navigation, otherwise the
 * alignment prompt fires while the user is mid-step.
 *
 * Use as a try/finally pair around the push:
 *
 *   beginInteractiveNavigation();
 *   try {
 *     locationService.push(target);
 *   } finally {
 *     endInteractiveNavigation();
 *   }
 *
 * The counter handles nested or overlapping interactive navigations.
 * `history.listen` callbacks fire synchronously during `push`, so the flag
 * is observable to the listener before `endInteractiveNavigation` runs.
 */
let activeCount = 0;

export function beginInteractiveNavigation(): void {
  activeCount += 1;
}

export function endInteractiveNavigation(): void {
  if (activeCount > 0) {
    activeCount -= 1;
  }
}

export function isInteractiveNavigationInProgress(): boolean {
  return activeCount > 0;
}

/** Test-only: reset the counter between tests. */
export function __resetInteractiveNavigationForTesting(): void {
  activeCount = 0;
}
