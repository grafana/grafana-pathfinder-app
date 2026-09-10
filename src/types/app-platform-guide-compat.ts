import type { JsonBlock } from './json-guide.types';

/**
 * App Platform resources outlive an individual Pathfinder deployment. Store
 * dividers as markdown so releases from before the divider block was added can
 * still validate and render a saved guide after a rollback.
 */
export const PERSISTED_DIVIDER_MARKDOWN = '<!-- pathfinder:block=divider;v=1 -->\n---';

const NESTED_BLOCK_FIELDS = ['blocks', 'whenTrue', 'whenFalse'] as const;

function mapNestedBlocks(block: JsonBlock, mapBlock: (block: JsonBlock) => JsonBlock): JsonBlock {
  const mapped = { ...block } as unknown as Record<string, unknown>;

  for (const field of NESTED_BLOCK_FIELDS) {
    if (Array.isArray(mapped[field])) {
      mapped[field] = (mapped[field] as JsonBlock[]).map(mapBlock);
    }
  }

  return mapped as unknown as JsonBlock;
}

export function encodeAppPlatformGuideBlocks(blocks: JsonBlock[]): JsonBlock[] {
  const encodeBlock = (block: JsonBlock): JsonBlock => {
    if (block.type === 'divider') {
      return {
        type: 'markdown',
        ...(block.id ? { id: block.id } : {}),
        content: PERSISTED_DIVIDER_MARKDOWN,
      };
    }

    return mapNestedBlocks(block, encodeBlock);
  };

  return blocks.map(encodeBlock);
}

export function decodeAppPlatformGuideBlocks(blocks: JsonBlock[]): JsonBlock[] {
  const decodeBlock = (block: JsonBlock): JsonBlock => {
    if (block.type === 'markdown' && block.content === PERSISTED_DIVIDER_MARKDOWN) {
      return {
        type: 'divider',
        ...(block.id ? { id: block.id } : {}),
      };
    }

    return mapNestedBlocks(block, decodeBlock);
  };

  return blocks.map(decodeBlock);
}
