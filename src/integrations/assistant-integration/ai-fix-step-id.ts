import { deriveStepId } from '../../global-state/step-id';
import {
  isConditionalBlock,
  isSectionBlock,
  type JsonBlock,
  type JsonGuide,
  type JsonGuidedBlock,
  type JsonInteractiveBlock,
  type JsonMultistepBlock,
} from '../../types/json-guide.types';

const STANDALONE_PARENT_ID = '__standalone__';

// Canonical step id for an addressable block — identical to the value json-parser.ts
// assigns to props.stepId (author id else deriveStepId). The apply test's parity case
// pins this to the parser; keep the per-type extraction in sync.
function resolveStepIdForBlock(block: JsonBlock, parentSectionId: string, index: number): string | undefined {
  if (block.id) {
    return block.id;
  }
  switch (block.type) {
    case 'interactive': {
      const b = block as JsonInteractiveBlock;
      return deriveStepId({
        sectionId: parentSectionId,
        index,
        action: b.action ?? b.targetAction,
        refTarget: b.reftarget ?? b.refTarget,
      });
    }
    case 'multistep': {
      const first = (block as JsonMultistepBlock).steps[0];
      return deriveStepId({
        sectionId: parentSectionId,
        index,
        action: first?.action ?? first?.targetAction,
        refTarget: first?.reftarget ?? first?.refTarget,
        variant: 'multistep',
      });
    }
    case 'guided': {
      const first = (block as JsonGuidedBlock).steps[0];
      return deriveStepId({
        sectionId: parentSectionId,
        index,
        action: first?.action ?? first?.targetAction,
        refTarget: first?.reftarget ?? first?.refTarget,
        variant: 'guided',
      });
    }
    default:
      return undefined;
  }
}

// Write a canonical id onto every addressable block lacking an author id, matching the
// parser's walk so a block resolves by the same stepId a component dispatched. Mutates in
// place (pass a clone); recurses sections + conditional branches — the containers the apply reaches.
export function materializeStepIds(guide: JsonGuide): JsonGuide {
  const walk = (blocks: JsonBlock[], parentSectionId: string, parentPath: string): void => {
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]!;
      const path = `${parentPath}[${i}]`;
      if (!block.id) {
        const derived = resolveStepIdForBlock(block, parentSectionId, i);
        if (derived) {
          block.id = derived;
        }
      }
      if (isSectionBlock(block)) {
        walk(block.blocks, block.id ? `section-${block.id}` : `section:${path}`, `${path}.blocks`);
      } else if (isConditionalBlock(block)) {
        walk(block.whenTrue, `conditional-true:${path}`, `${path}.whenTrue`);
        walk(block.whenFalse, `conditional-false:${path}`, `${path}.whenFalse`);
      }
    }
  };
  walk(guide.blocks, STANDALONE_PARENT_ID, 'blocks');
  return guide;
}
