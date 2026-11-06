import type { JsonBlock } from './json-guide.types';
import { JsonBlockSchema, MAX_NESTING_DEPTH } from './json-guide.schema';
import { normalizeJsonGuideAliasFields } from './json-guide-aliases';

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

export type AppPlatformGuideBlocksDecodeResult =
  { ok: true; blocks: JsonBlock[] } | { ok: false; issues: ReadonlyArray<{ message: string }> };

function isBlockRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function decodeAppPlatformGuideBlocks(blocks: unknown): AppPlatformGuideBlocksDecodeResult {
  let exceededMaxDepth = false;

  const decodeBlock = (value: unknown, depth: number): unknown => {
    // Persisting a visibility section adds one conditional level to the canonical tree.
    if (depth > MAX_NESTING_DEPTH + 1) {
      exceededMaxDepth = true;
      return value;
    }
    if (!isBlockRecord(value)) {
      return value;
    }
    const block = normalizeJsonGuideAliasFields(value);

    if (block.type === 'markdown' && block.content === PERSISTED_DIVIDER_MARKDOWN) {
      return {
        type: 'divider',
        ...(typeof block.id === 'string' && block.id.length > 0 ? { id: block.id } : {}),
      };
    }

    if (
      block.type === 'input' &&
      block.inputType === 'text' &&
      block.placeholder === PERSISTED_CHECKBOX_GROUP &&
      Array.isArray(block.choices)
    ) {
      const { placeholder, ...input } = block;
      return { ...input, inputType: 'checkbox-group' };
    }

    const mapped = { ...block };
    if (Array.isArray(mapped.steps)) {
      mapped.steps = mapped.steps.map((step) => (isBlockRecord(step) ? normalizeJsonGuideAliasFields(step) : step));
    }
    for (const field of NESTED_BLOCK_FIELDS) {
      if (Array.isArray(mapped[field])) {
        mapped[field] = mapped[field].map((child) => decodeBlock(child, depth + 1));
      }
    }

    if (
      mapped.type === 'conditional' &&
      typeof mapped.description === 'string' &&
      mapped.description.startsWith(PERSISTED_SECTION_VISIBILITY) &&
      Array.isArray(mapped.whenTrue) &&
      mapped.whenTrue.length === 1 &&
      isBlockRecord(mapped.whenTrue[0]) &&
      mapped.whenTrue[0].type === 'section' &&
      Array.isArray(mapped.conditions) &&
      mapped.conditions.every((condition) => typeof condition === 'string') &&
      Array.isArray(mapped.whenFalse)
    ) {
      const mode = mapped.description.slice(PERSISTED_SECTION_VISIBILITY.length);
      const fallback = mapped.whenFalse[0];
      if (
        (mode === 'hide' && mapped.whenFalse.length === 0) ||
        (mode === 'heading-only' &&
          mapped.whenFalse.length === 1 &&
          isBlockRecord(fallback) &&
          fallback.type === 'markdown' &&
          typeof fallback.content === 'string')
      ) {
        return { ...mapped.whenTrue[0], whenRequirementsUnmet: mode };
      }
    }
    return mapped;
  };

  const decoded = Array.isArray(blocks) ? blocks.map((block) => decodeBlock(block, 0)) : blocks;
  if (exceededMaxDepth) {
    return {
      ok: false,
      issues: [{ message: `Guide blocks exceed the maximum nesting depth of ${MAX_NESTING_DEPTH}` }],
    };
  }
  const parsed = JsonBlockSchema.array().safeParse(decoded);
  return parsed.success ? { ok: true, blocks: decoded as JsonBlock[] } : { ok: false, issues: parsed.error.issues };
}
