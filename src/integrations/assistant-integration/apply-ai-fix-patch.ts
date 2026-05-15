/**
 * Apply an AI-auto-heal patch to a guide JSON string.
 *
 * Pure helper — parses the input, walks the block tree to find the targeted
 * interactive block by `id`, applies the patch, re-stringifies. Final output
 * is round-tripped through `JsonGuideSchema` so a mutation that breaks the
 * guide is rejected before we hand it to the renderer.
 *
 * Targeting:
 * - `selector-patch.targetStepId` resolves against `JsonInteractiveBlock.id`.
 * - `prepend-step.beforeStepId` resolves against interactive / multistep /
 *   guided block ids. Anonymous sub-steps inside multistep / guided containers
 *   (which carry no id) are NOT addressable by v1.
 * - Recurses into `JsonSectionBlock.blocks` and `JsonConditionalBlock.blocks`.
 */

import type { AiFixPatch } from './ai-fix-patch.schema';
import { JsonGuideSchema } from '../../types/json-guide.schema';
import { synthesizeStepIds } from '../../docs-retrieval';
import type {
  JsonBlock,
  JsonConditionalBlock,
  JsonGuide,
  JsonGuidedBlock,
  JsonInteractiveBlock,
  JsonMultistepBlock,
  JsonSectionBlock,
  JsonStep,
} from '../../types/json-guide.types';

export type ApplyResult = { ok: true; newGuideJson: string } | { ok: false; error: string };

function isSection(block: JsonBlock): block is JsonSectionBlock {
  return block.type === 'section';
}

function isConditional(block: JsonBlock): block is JsonConditionalBlock {
  return block.type === 'conditional';
}

function isStepContainer(block: JsonBlock): block is JsonMultistepBlock | JsonGuidedBlock {
  return block.type === 'multistep' || block.type === 'guided';
}

function isInteractiveWithId(block: JsonBlock, id: string): block is JsonInteractiveBlock {
  return block.type === 'interactive' && (block as JsonInteractiveBlock).id === id;
}

function isStepContainerWithId(block: JsonBlock, id: string): block is JsonMultistepBlock | JsonGuidedBlock {
  return isStepContainer(block) && block.id === id;
}

function isPrependTargetWithId(
  block: JsonBlock,
  id: string
): block is JsonInteractiveBlock | JsonMultistepBlock | JsonGuidedBlock {
  return isInteractiveWithId(block, id) || isStepContainerWithId(block, id);
}

/**
 * Walk `blocks` and call `mutator` on the parent array + index when the
 * predicate matches. Returns true once a match has been mutated so the
 * caller can short-circuit.
 */
function mutateMatchingBlock(
  blocks: JsonBlock[],
  matchId: string,
  mutator: (parent: JsonBlock[], index: number) => void,
  matches: (block: JsonBlock, id: string) => boolean = isInteractiveWithId
): boolean {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (matches(block, matchId)) {
      mutator(blocks, i);
      return true;
    }
    if (isSection(block)) {
      if (mutateMatchingBlock(block.blocks, matchId, mutator, matches)) {
        return true;
      }
    } else if (isConditional(block)) {
      if (mutateMatchingBlock(block.whenTrue, matchId, mutator, matches)) {
        return true;
      }
      if (mutateMatchingBlock(block.whenFalse, matchId, mutator, matches)) {
        return true;
      }
    }
  }
  return false;
}

type SubstepMutateOutcome =
  | { outcome: 'patched' }
  | { outcome: 'out-of-range'; stepCount: number }
  | { outcome: 'not-found' };

/**
 * Walk `blocks` to find a `multistep` / `guided` container by id and patch
 * `steps[subStepIndex].reftarget`. Three outcomes: patched, found-but-index-
 * out-of-range, not-found. Callers translate the latter two to `ApplyResult`
 * errors; this split keeps the recursion clean (a not-found inner branch
 * shouldn't mask a sibling that does match).
 */
function mutateSubstepReftarget(
  blocks: JsonBlock[],
  containerId: string,
  subStepIndex: number,
  newReftarget: string
): SubstepMutateOutcome {
  for (const block of blocks) {
    if (isStepContainerWithId(block, containerId)) {
      if (subStepIndex < 0 || subStepIndex >= block.steps.length) {
        return { outcome: 'out-of-range', stepCount: block.steps.length };
      }
      const step = block.steps[subStepIndex] as JsonStep;
      step.reftarget = newReftarget;
      return { outcome: 'patched' };
    }
    if (isSection(block)) {
      const nested = mutateSubstepReftarget(block.blocks, containerId, subStepIndex, newReftarget);
      if (nested.outcome !== 'not-found') {
        return nested;
      }
    } else if (isConditional(block)) {
      const nestedTrue = mutateSubstepReftarget(block.whenTrue, containerId, subStepIndex, newReftarget);
      if (nestedTrue.outcome !== 'not-found') {
        return nestedTrue;
      }
      const nestedFalse = mutateSubstepReftarget(block.whenFalse, containerId, subStepIndex, newReftarget);
      if (nestedFalse.outcome !== 'not-found') {
        return nestedFalse;
      }
    }
  }
  return { outcome: 'not-found' };
}

export function applyPatchToGuide(guideJson: string, patch: AiFixPatch): ApplyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(guideJson);
  } catch (e) {
    return { ok: false, error: `Failed to parse guide JSON: ${e instanceof Error ? e.message : 'unknown'}` };
  }

  // Validate the input first so we know we're operating on a well-formed
  // guide. A malformed guide here means something upstream is already broken
  // and the patch wouldn't help anyway.
  const beforeCheck = JsonGuideSchema.safeParse(parsed);
  if (!beforeCheck.success) {
    return { ok: false, error: 'Current guide failed schema validation; cannot safely patch' };
  }

  // Work on a deep clone so a partial mutation doesn't leak into the caller's
  // copy if validation fails downstream. Synthesize ids first so the patch's
  // synthesized ids resolve even when callers pass the raw on-disk JSON.
  const guide = synthesizeStepIds(JSON.parse(JSON.stringify(beforeCheck.data)) as JsonGuide);

  let didMutate = false;

  if (patch.type === 'selector-patch') {
    didMutate = mutateMatchingBlock(guide.blocks, patch.targetStepId, (parent, index) => {
      const block = parent[index] as JsonInteractiveBlock;
      block.reftarget = patch.newReftarget;
    });
    if (!didMutate) {
      return { ok: false, error: `No interactive block found with id "${patch.targetStepId}"` };
    }
  } else if (patch.type === 'prepend-step') {
    didMutate = mutateMatchingBlock(
      guide.blocks,
      patch.beforeStepId,
      (parent, index) => {
        parent.splice(index, 0, patch.newStep as JsonBlock);
      },
      isPrependTargetWithId
    );
    if (!didMutate) {
      return { ok: false, error: `No interactive block found with id "${patch.beforeStepId}"` };
    }
  } else {
    // substep-selector-patch — find the multistep/guided container by id and
    // patch the nth sub-step's reftarget.
    const result = mutateSubstepReftarget(guide.blocks, patch.containerId, patch.subStepIndex, patch.newReftarget);
    if (result.outcome === 'not-found') {
      return { ok: false, error: `No multistep/guided container found with id "${patch.containerId}"` };
    }
    if (result.outcome === 'out-of-range') {
      return {
        ok: false,
        error: `Container "${patch.containerId}" has ${result.stepCount} steps; index ${patch.subStepIndex} is out of range`,
      };
    }
    didMutate = true;
  }

  // Re-validate the whole guide after the mutation. If the patched guide
  // can't pass schema, we throw the change away — caller surfaces the error.
  const afterCheck = JsonGuideSchema.safeParse(guide);
  if (!afterCheck.success) {
    return {
      ok: false,
      error: `Patched guide failed schema check: ${afterCheck.error.issues[0]?.message ?? 'unknown'}`,
    };
  }

  return { ok: true, newGuideJson: JSON.stringify(afterCheck.data) };
}
