import type { AiFixPatch } from './ai-fix-patch.schema';
import { materializeStepIds } from './ai-fix-step-id';
import { JsonGuideSchema } from '../../types/json-guide.schema';
import {
  isConditionalBlock,
  isSectionBlock,
  type JsonBlock,
  type JsonGuide,
  type JsonGuidedBlock,
  type JsonInteractiveBlock,
  type JsonMultistepBlock,
  type JsonStep,
} from '../../types/json-guide.types';

export type ApplyResult = { ok: true; newGuideJson: string } | { ok: false; error: string };

function isInteractiveWithId(block: JsonBlock, id: string): block is JsonInteractiveBlock {
  return block.type === 'interactive' && (block as JsonInteractiveBlock).id === id;
}

function isStepContainerWithId(block: JsonBlock, id: string): block is JsonMultistepBlock | JsonGuidedBlock {
  return (block.type === 'multistep' || block.type === 'guided') && block.id === id;
}

function mutateMatchingBlock(
  blocks: JsonBlock[],
  matchId: string,
  mutator: (parent: JsonBlock[], index: number) => void
): boolean {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (isInteractiveWithId(block, matchId)) {
      mutator(blocks, i);
      return true;
    }
    if (isSectionBlock(block)) {
      if (mutateMatchingBlock(block.blocks, matchId, mutator)) {
        return true;
      }
    } else if (isConditionalBlock(block)) {
      if (mutateMatchingBlock(block.whenTrue, matchId, mutator)) {
        return true;
      }
      if (mutateMatchingBlock(block.whenFalse, matchId, mutator)) {
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

// Split outcomes keep the recursion clean: a not-found inner branch must not mask a sibling that matches.
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
    if (isSectionBlock(block)) {
      const nested = mutateSubstepReftarget(block.blocks, containerId, subStepIndex, newReftarget);
      if (nested.outcome !== 'not-found') {
        return nested;
      }
    } else if (isConditionalBlock(block)) {
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

  const beforeCheck = JsonGuideSchema.safeParse(parsed);
  if (!beforeCheck.success) {
    return { ok: false, error: 'Current guide failed schema validation; cannot safely patch' };
  }

  // Deep clone so a failed mutation never leaks into the caller's guide; materialize
  // canonical ids so anonymous blocks resolve by the same stepId a component dispatched.
  const guide = materializeStepIds(JSON.parse(JSON.stringify(beforeCheck.data)) as JsonGuide);

  if (patch.type === 'selector-patch') {
    const didMutate = mutateMatchingBlock(guide.blocks, patch.targetStepId, (parent, index) => {
      (parent[index] as JsonInteractiveBlock).reftarget = patch.newReftarget;
    });
    if (!didMutate) {
      return { ok: false, error: `No interactive block found with id "${patch.targetStepId}"` };
    }
  } else if (patch.type === 'prepend-step') {
    const didMutate = mutateMatchingBlock(guide.blocks, patch.beforeStepId, (parent, index) => {
      parent.splice(index, 0, patch.newStep as JsonBlock);
    });
    if (!didMutate) {
      return { ok: false, error: `No interactive block found with id "${patch.beforeStepId}"` };
    }
  } else {
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
  }

  // A mutation that breaks the guide is discarded here — an invalid guide must never reach the renderer.
  const afterCheck = JsonGuideSchema.safeParse(guide);
  if (!afterCheck.success) {
    return {
      ok: false,
      error: `Patched guide failed schema check: ${afterCheck.error.issues[0]?.message ?? 'unknown'}`,
    };
  }

  return { ok: true, newGuideJson: JSON.stringify(afterCheck.data) };
}
