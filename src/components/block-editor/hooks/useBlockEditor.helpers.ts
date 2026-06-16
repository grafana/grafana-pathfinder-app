import type { EditorBlock, JsonBlock } from '../types';
import type {
  JsonSectionBlock,
  JsonConditionalBlock,
  JsonInteractiveBlock,
  JsonMultistepBlock,
  JsonGuidedBlock,
} from '../../../types/json-guide.types';

export const isSectionBlock = (block: JsonBlock): block is JsonSectionBlock => block.type === 'section';
export const isConditionalBlock = (block: JsonBlock): block is JsonConditionalBlock => block.type === 'conditional';
export const isInteractiveBlock = (block: JsonBlock): block is JsonInteractiveBlock => block.type === 'interactive';
export const isMultistepBlock = (block: JsonBlock): block is JsonMultistepBlock => block.type === 'multistep';
export const isGuidedBlock = (block: JsonBlock): block is JsonGuidedBlock => block.type === 'guided';

export const generateBlockId = (): string => `block-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const NESTED_MARKER = '-nested-';

export interface ParsedBlockId {
  isNested: boolean;
  sectionId?: string;
  nestedIndex?: number;
  block?: JsonBlock;
  rootIndex?: number;
  sectionRootIndex?: number;
}

/**
 * Parse a block ID to determine whether it addresses a root block or a nested block.
 * Nested block IDs have the form `${sectionId}-nested-${nestedIndex}`.
 */
export const parseBlockId = (id: string, blocks: EditorBlock[]): ParsedBlockId => {
  const markerIndex = id.lastIndexOf(NESTED_MARKER);

  if (markerIndex !== -1) {
    const sectionId = id.slice(0, markerIndex);
    const nestedIndexStr = id.slice(markerIndex + NESTED_MARKER.length);
    const nestedIndex = parseInt(nestedIndexStr, 10);

    if (!isNaN(nestedIndex) && nestedIndexStr === String(nestedIndex)) {
      const sectionRootIndex = blocks.findIndex((b) => b.id === sectionId);
      const section = sectionRootIndex >= 0 ? blocks[sectionRootIndex] : undefined;
      if (section && isSectionBlock(section.block)) {
        const nestedBlock = section.block.blocks[nestedIndex];
        if (nestedBlock) {
          return { isNested: true, sectionId, nestedIndex, block: nestedBlock, sectionRootIndex };
        }
      }
      return { isNested: true, sectionRootIndex: sectionRootIndex >= 0 ? sectionRootIndex : undefined };
    }
  }

  const rootIndex = blocks.findIndex((b) => b.id === id);
  if (rootIndex >= 0) {
    return { isNested: false, block: blocks[rootIndex]!.block, rootIndex };
  }
  return { isNested: false };
};
