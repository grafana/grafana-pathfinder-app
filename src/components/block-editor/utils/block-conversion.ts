/**
 * Block Type Conversion Utility
 *
 * Generic, schema-driven block conversion that:
 * - Allows any convertible block to convert to any other convertible block
 * - Auto-computes data loss warnings using KNOWN_FIELDS from the schema
 * - Copies common fields automatically
 * - Maps content-like fields between types
 */

import { JsonBlockSchema, KNOWN_FIELDS } from '../../../types/json-guide.schema';
import type { BlockType } from '../types';
import type { JsonBlock } from '../../../types/json-guide.types';
import { logger } from '../../../lib/logging';

// ============ Conversion eligibility ============

/**
 * Why a block type cannot be a conversion *source*; `null` means it can be one.
 *
 * Source and target eligibility stay separate registries even though they
 * happen to exclude the same six types today: they answer different questions,
 * and block-editor eligibility already diverges elsewhere — `html` is excluded
 * from the palette yet is a valid conversion target, and `snippet-ref` is
 * palette-visible yet is not a target. One symmetric set would make a future
 * divergence unrepresentable, turning a UI refactor into silent data loss.
 */
const SOURCE_EXCLUSION_REASONS = {
  markdown: null,
  html: null,
  image: null,
  video: null,
  interactive: null,
  multistep: null,
  guided: null,
  quiz: null,
  input: null,
  terminal: null,
  'terminal-connect': null,
  challenge: null,
  'code-block': null,
  section: 'its nested blocks would be silently dropped',
  conditional: 'its branch blocks would be silently dropped',
  'grot-guide': 'its screens would be silently dropped',
  collapsible: 'its nested blocks would be silently dropped',
  assistant: 'its nested blocks would be silently dropped',
  'snippet-ref': 'its snippetId would be silently dropped',
} satisfies Record<BlockType, string | null>;

/**
 * Why a block type cannot be a conversion *target*; `null` means it can be one.
 *
 * The insertion order of the eligible (`null`) keys is the user-visible order
 * of the switch-type menu, so reordering them here reorders that menu.
 */
const TARGET_EXCLUSION_REASONS = {
  markdown: null,
  html: null,
  image: null,
  video: null,
  interactive: null,
  multistep: null,
  guided: null,
  quiz: null,
  input: null,
  terminal: null,
  'terminal-connect': null,
  challenge: null,
  'code-block': null,
  section: 'conversion cannot invent the nested blocks a container needs',
  conditional: 'conversion cannot invent the branch blocks a container needs',
  'grot-guide': 'conversion cannot invent the screens it needs',
  collapsible: 'its children are restricted to presentational blocks',
  assistant: 'it has no form of its own, so the editor would render nothing after the switch',
  'snippet-ref': 'snippetId has no sensible placeholder',
} satisfies Record<BlockType, string | null>;

const excludedTypes = (reasons: Record<BlockType, string | null>): readonly BlockType[] =>
  (Object.keys(reasons) as BlockType[]).filter((type) => reasons[type] !== null);

const eligibleTypes = (reasons: Record<BlockType, string | null>): readonly BlockType[] =>
  (Object.keys(reasons) as BlockType[]).filter((type) => reasons[type] === null);

export const SOURCE_EXCLUDED_BLOCK_TYPES = excludedTypes(SOURCE_EXCLUSION_REASONS);

export const TARGET_EXCLUDED_BLOCK_TYPES = excludedTypes(TARGET_EXCLUSION_REASONS);

/** All block types that support conversion, in `TARGET_EXCLUSION_REASONS` key order. */
const CONVERTIBLE_TYPES = eligibleTypes(TARGET_EXCLUSION_REASONS);

// ============ Configuration Maps ============

/**
 * Fields shared across many block types - always copy if present.
 */
const COMMON_FIELDS = ['requirements', 'objectives', 'skippable'] as const;

/**
 * Primary content field for each block type, or `null` for the types that have
 * no single body of text to carry across a conversion.
 */
const CONTENT_FIELDS: Record<BlockType, string | null> = {
  markdown: 'content',
  html: 'content',
  interactive: 'content',
  multistep: 'content',
  guided: 'content',
  quiz: 'question',
  input: 'prompt',
  terminal: 'content',
  'terminal-connect': 'content',
  challenge: 'brief',
  'code-block': 'content',
  image: null,
  video: null,
  section: null,
  conditional: null,
  collapsible: null,
  assistant: null,
  'grot-guide': null,
  'snippet-ref': null,
};

/**
 * Placeholder URL used when converting to image/video types.
 * Uses the .invalid TLD (RFC 2606) which will never resolve.
 * Forms should detect this and show a validation warning.
 */
export const PLACEHOLDER_URL = 'https://placeholder.invalid/replace-me';

/**
 * Required defaults when converting TO these types, or `null` for the types that
 * need no invented field. Total over `BlockType` so a new type cannot silently
 * become a target with unsatisfied required fields.
 */
const REQUIRED_DEFAULTS: Record<BlockType, Record<string, unknown> | null> = {
  quiz: { choices: [{ id: 'a', text: 'Option A', correct: true }] },
  input: { inputType: 'text', variableName: 'userInput' },
  image: { src: PLACEHOLDER_URL, alt: '' },
  video: { src: PLACEHOLDER_URL },
  interactive: { action: 'noop' },
  multistep: { content: 'Complete these steps', steps: [{ action: 'noop' }] },
  guided: { content: 'Follow these steps', steps: [{ action: 'noop' }] },
  terminal: { command: 'echo "hello"' },
  'terminal-connect': { content: 'Connect to terminal' },
  challenge: {
    title: 'Untitled challenge',
    successCriteria: 'coda-exit-zero:true',
  },
  'code-block': { reftarget: "div[data-testid='data-testid Code editor container']", code: '// Your code here' },
  markdown: null,
  html: null,
  section: null,
  conditional: null,
  collapsible: null,
  assistant: null,
  'grot-guide': null,
  'snippet-ref': null,
};

// ============ Public API ============

/**
 * Information about potential data loss during conversion.
 */
export interface ConversionWarning {
  /** Warning message to display to user */
  message: string;
  /** List of fields that will be lost */
  lostFields: string[];
}

/**
 * Get available target types for a given source type.
 * Returns every convertible target type except the source type itself.
 */
export function getAvailableConversions(sourceType: BlockType): BlockType[] {
  if (SOURCE_EXCLUSION_REASONS[sourceType] !== null) {
    return [];
  }

  return CONVERTIBLE_TYPES.filter((t) => t !== sourceType);
}

/**
 * Check if a conversion will result in data loss and return warning details.
 * Returns null if no data will be lost.
 *
 * Uses KNOWN_FIELDS from the schema to auto-compute which fields won't carry over.
 */
export function getConversionWarning(source: JsonBlock, targetType: BlockType): ConversionWarning | null {
  const sourceType = source.type as BlockType;
  const targetKnownFields = KNOWN_FIELDS[targetType];

  if (!targetKnownFields) {
    return null;
  }

  // Get all defined fields from source (excluding type and undefined values)
  const sourceRecord = source as unknown as Record<string, unknown>;
  const sourceFields = Object.keys(source).filter((k) => k !== 'type' && sourceRecord[k] !== undefined);

  // Find fields that won't carry over to target type
  const lostFields = sourceFields.filter((field) => {
    // Common fields always carry over
    if (COMMON_FIELDS.includes(field as (typeof COMMON_FIELDS)[number])) {
      return false;
    }
    // Content fields map to each other
    const sourceContentField = CONTENT_FIELDS[sourceType];
    const targetContentField = CONTENT_FIELDS[targetType];
    if (field === sourceContentField && targetContentField) {
      return false;
    }
    // Check if target knows this field
    return !targetKnownFields.has(field);
  });

  if (lostFields.length === 0) {
    return null;
  }

  return {
    message: `Converting to ${targetType} will lose some data.`,
    lostFields,
  };
}

/**
 * Convert a block from one type to another.
 * Preserves compatible fields and provides sensible defaults for required fields.
 *
 * @throws Error if either type is excluded from conversion, or if the result fails schema validation
 */
export function convertBlockType(source: JsonBlock, targetType: BlockType): JsonBlock {
  // Same type - no-op
  if (source.type === targetType) {
    return source;
  }

  const sourceType = source.type as BlockType;

  const sourceExclusion = SOURCE_EXCLUSION_REASONS[sourceType];
  if (sourceExclusion !== null) {
    throw new Error(`Cannot convert from a ${sourceType} block: ${sourceExclusion}`);
  }

  const targetExclusion = TARGET_EXCLUSION_REASONS[targetType];
  if (targetExclusion !== null) {
    throw new Error(`Cannot convert to a ${targetType} block: ${targetExclusion}`);
  }

  const converted: Record<string, unknown> = { type: targetType };
  const sourceRecord = source as unknown as Record<string, unknown>;

  // 1. Map content-like field between types
  const sourceContentField = CONTENT_FIELDS[sourceType];
  const targetContentField = CONTENT_FIELDS[targetType];
  if (sourceContentField && targetContentField) {
    const sourceValue = sourceRecord[sourceContentField];
    if (sourceValue) {
      converted[targetContentField] = sourceValue;
    }
  }

  // 2. Copy common fields (requirements, objectives, skippable)
  for (const field of COMMON_FIELDS) {
    const value = sourceRecord[field];
    if (value !== undefined) {
      converted[field] = value;
    }
  }

  // 3. Copy any field that exists in both source and target's known fields
  const targetKnownFields = KNOWN_FIELDS[targetType];
  if (targetKnownFields) {
    for (const [key, value] of Object.entries(sourceRecord)) {
      if (key !== 'type' && value !== undefined && targetKnownFields.has(key) && !(key in converted)) {
        converted[key] = value;
      }
    }
  }

  // 4. Apply required defaults for missing fields
  const defaults = REQUIRED_DEFAULTS[targetType];
  if (defaults) {
    for (const [key, value] of Object.entries(defaults)) {
      if (!(key in converted)) {
        converted[key] = value;
      }
    }
  }

  // 5. Validate against schema
  const result = JsonBlockSchema.safeParse(converted);
  if (!result.success) {
    logger.error('Block conversion produced invalid block', { error: result.error });
    throw new Error(`Conversion to ${targetType} failed validation: ${result.error.message}`);
  }

  return result.data as JsonBlock;
}
