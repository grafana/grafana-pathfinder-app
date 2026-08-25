/**
 * Canonical guide block-count and completion computation.
 *
 * Tier 1, dependency-free and side-effect-free, so every consumer that needs
 * the denominator — the CLI, an upload script, the plugin frontend, a Go port
 * of the same rule — inherits one implementation instead of writing its own.
 */

export {
  computeGuideBlockIndex,
  OPAQUE_PARENT_BLOCK_TYPES,
  TRANSPARENT_CONTAINER_BLOCK_TYPES,
  type CountableBlock,
  type CountedBlock,
  type GuideBlockIndex,
} from './block-index';

export {
  furthestEvidencedPosition,
  guideProgress,
  guideProgressAtPosition,
  type CompletionEvidence,
  type CompletionEvidenceKind,
  type GuideProgress,
} from './progress';

export {
  GUIDE_STATS_VERSION,
  rollUpGuideStats,
  summarizeGuideBlockIndex,
  summarizeGuideBlocks,
  type GuideStatsSummary,
} from './summary';
