/**
 * Block Type Conversion Utility
 *
 * Generic, schema-driven block conversion that:
 * - Allows any non-container block to convert to any other non-container block
 * - Auto-computes data loss warnings using KNOWN_FIELDS from the schema
 * - Copies common fields automatically
 * - Maps content-like fields between types
 */

import { JsonBlockSchema, KNOWN_FIELDS } from '../../../types/json-guide.schema';
import type { BlockType } from '../types';
import type { JsonBlock } from '../../../types/json-guide.types';

// ============ Configuration Maps ============

/**
 * Container types excluded from conversion (they have nested blocks).
 */
const CONTAINER_TYPES: ReadonlySet<BlockType> = new Set(['section', 'conditional']);

/**
 * All non-container block types that support conversion.
 */
const CONVERTIBLE_TYPES: readonly BlockType[] = [
  'markdown',
  'html',
  'image',
  'video',
  'interactive',
  'multistep',
  'guided',
  'quiz',
  'input',
  'terminal',
];

/**
 * Fields shared across many block types - always copy if present.
 */
const COMMON_FIELDS = ['requirements', 'objectives', 'skippable'] as const;

/**
 * Primary content field for each block type.
 * Used to map content between different block types.
 */
const CONTENT_FIELDS: Partial<Record<BlockType, string>> = {
  markdown: 'content',
  html: 'content',
  interactive: 'content',
  multistep: 'content',
  guided: 'content',
  quiz: 'question',
  input: 'prompt',
  terminal: 'content',
};

/**
 * Placeholder URL used when converting to image/video types.
 * Uses the .invalid TLD (RFC 2606) which will never resolve.
 * Forms should detect this and show a validation warning.
 */
export const PLACEHOLDER_URL = 'https://placeholder.invalid/replace-me';

/**
 * Required defaults when converting TO these types.
 * Provides sensible defaults for required fields that don't have a source mapping.
 */
const REQUIRED_DEFAULTS: Partial<Record<BlockType, Record<string, unknown>>> = {
  quiz: { choices: [{ id: 'a', text: 'Option A', correct: true }] },
  input: { inputType: 'text', variableName: 'userInput' },
  image: { src: PLACEHOLDER_URL, alt: '' },
  video: { src: PLACEHOLDER_URL },
  interactive: { action: 'noop' },
  multistep: { content: 'Complete these steps', steps: [{ action: 'noop' }] },
  guided: { content: 'Follow these steps', steps: [{ action: 'noop' }] },
  terminal: { command: 'echo "hello"' },
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
 * Returns all non-container types except the source type itself.
 */
export function getAvailableConversions(sourceType: BlockType): BlockType[] {
  // Container types cannot be converted
  if (CONTAINER_TYPES.has(sourceType)) {
    return [];
  }

  // Return all non-container types except the source type
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
 * @throws Error if conversion involves container blocks or fails schema validation
 */
export function convertBlockType(source: JsonBlock, targetType: BlockType): JsonBlock {
  // Same type - no-op
  if (source.type === targetType) {
    return source;
  }

  const sourceType = source.type as BlockType;

  // Validate not converting container blocks
  if (CONTAINER_TYPES.has(sourceType) || CONTAINER_TYPES.has(targetType)) {
    throw new Error(`Cannot convert container blocks (section, conditional)`);
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
    console.error('Block conversion produced invalid block:', result.error);
    throw new Error(`Conversion to ${targetType} failed validation: ${result.error.message}`);
  }

  return result.data as JsonBlock;
}
