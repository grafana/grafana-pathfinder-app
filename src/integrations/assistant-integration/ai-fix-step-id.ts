import { resolveStepIdForBlock } from '../../global-state/guide-step-id-resolver';
import { isConditionalBlock, isSectionBlock, type JsonBlock, type JsonGuide } from '../../types/json-guide.types';

const STANDALONE_PARENT_ID = '__standalone__';

// Write a canonical id onto every addressable block lacking an author id, matching the
// parser's walk so a block resolves by the same stepId a component dispatched. Mutates in
// place (pass a clone); recurses sections + conditional branches — the containers the apply reaches.
export function materializeStepIds(guide: JsonGuide): JsonGuide {
  const walk = (blocks: JsonBlock[], parentSectionId: string, parentPath: string): void => {
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]!;
      const path = `${parentPath}[${i}]`;
      if (!block.id) {
        const derived = resolveStepIdForBlock(block, { parentSectionId, index: i });
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

// String entry point for callers holding raw guide JSON (the orchestrator feeds the
// id-augmented form to the assistant + content extraction). Returns the input unchanged
// when it is not parseable guide-shaped JSON.
export function materializeStepIdsInJson(guideJson: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(guideJson);
  } catch {
    return guideJson;
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as Partial<JsonGuide>).blocks)) {
    return guideJson;
  }
  return JSON.stringify(materializeStepIds(parsed as JsonGuide));
}
