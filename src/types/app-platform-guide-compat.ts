import type { JsonBlock } from './json-guide.types';

/**
 * App Platform resources outlive an individual Pathfinder deployment. Store
 * dividers as markdown so releases from before the divider block was added can
 * still validate and render a saved guide after a rollback.
 */
export const PERSISTED_CHECKBOX_GROUP = 'pathfinder:checkbox-group:v1';
const PERSISTED_SECTION_VISIBILITY = 'pathfinder:section-visibility:v1:';

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

    if (block.type === 'input' && block.inputType === 'checkbox-group') {
      return { ...block, inputType: 'text', placeholder: PERSISTED_CHECKBOX_GROUP };
    }
    if (block.type === 'section' && block.whenRequirementsUnmet && block.whenRequirementsUnmet !== 'disable') {
      const { whenRequirementsUnmet, ...section } = block;
      return {
        type: 'conditional',
        id: block.id,
        description: `${PERSISTED_SECTION_VISIBILITY}${whenRequirementsUnmet}`,
        conditions: block.requirements ?? [],
        whenTrue: [mapNestedBlocks(section, encodeBlock)],
        whenFalse:
          whenRequirementsUnmet === 'heading-only' ? [{ type: 'markdown', content: `### ${block.title ?? ''}` }] : [],
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

    if (
      block.type === 'input' &&
      block.inputType === 'text' &&
      block.placeholder === PERSISTED_CHECKBOX_GROUP &&
      block.choices
    ) {
      const { placeholder, ...input } = block;
      return { ...input, inputType: 'checkbox-group' };
    }
    if (
      block.type === 'conditional' &&
      block.description?.startsWith(PERSISTED_SECTION_VISIBILITY) &&
      block.whenTrue.length === 1 &&
      block.whenTrue[0]?.type === 'section'
    ) {
      const mode = block.description.slice(PERSISTED_SECTION_VISIBILITY.length);
      if (mode === 'hide' || mode === 'heading-only') {
        return { ...mapNestedBlocks(block.whenTrue[0], decodeBlock), whenRequirementsUnmet: mode } as JsonBlock;
      }
    }
    return mapNestedBlocks(block, decodeBlock);
  };

  return blocks.map(decodeBlock);
}
