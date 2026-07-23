import { STEP_COUNTING_BLOCK_TYPES, type JsonBlock, type JsonGuide } from '../types/json-guide.types';

const STEP_BLOCK_TYPES: ReadonlySet<string> = new Set(STEP_COUNTING_BLOCK_TYPES);

/** Environment-neutral step-count approximation; Node and CLI callers must deep-import this module, not the barrel. */
export function countGuideSteps(guide: Pick<JsonGuide, 'blocks'>): number {
  return countBlocks(guide.blocks, false);
}

function countBlocks(blocks: JsonBlock[], inSection: boolean): number {
  return blocks.reduce((total, block) => {
    if (block.type === 'section') {
      return total + countBlocks(block.blocks, true);
    }
    if (!STEP_BLOCK_TYPES.has(block.type)) {
      return total;
    }
    const assistantWrapped = 'assistantEnabled' in block && block.assistantEnabled === true;
    return total + (inSection && assistantWrapped ? 0 : 1);
  }, 0);
}
