/**
 * Auto-recovery primitives.
 *
 * Phase 1: initial-state alignment ("implied 0th step"). Compares the user's
 * current location against the guide's declared starting location and decides
 * whether to prompt them to navigate before step 1 begins.
 *
 * @see docs/design/AUTORECOVERY_DESIGN.md
 */

export {
  evaluateAlignment,
  pathMatchesStartingLocation,
  type AlignmentEvaluation,
  type AlignmentReason,
  type EvaluateAlignmentInput,
} from './alignment-evaluator';

export {
  ALIGNED_BY_CONSTRUCTION_SOURCES,
  NEEDS_ALIGNMENT_CHECK_SOURCES,
  isAlignedByConstruction,
  coerceLaunchSource,
  type LaunchSource,
} from './launch-sources';

export { resolveStartingLocation } from './starting-location';
