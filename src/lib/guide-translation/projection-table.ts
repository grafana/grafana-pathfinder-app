/**
 * The v1 projection table (docs/design/I18N.md §7.1): for each translatable
 * block type, the fields a sidecar entry may translate and, for step-bearing
 * types, the fields each step may translate. Every field not listed is
 * structural. A pilot revision is an edit to this data.
 *
 * A field name with a dot is a path into the block: the conditional's
 * `whenTrueSectionConfig.title` is `block.whenTrueSectionConfig.title`, and a
 * sidecar entry carries it under that same dotted key.
 */

import type { JsonBlock } from '../../types/json-guide.types';

export interface ProjectionRow {
  readonly fields: readonly string[];
  readonly stepFields?: readonly string[];
}

const STEP_FIELDS = ['description', 'tooltip', 'formHint'] as const;

export const PROJECTION_TABLE = {
  markdown: { fields: ['content'] },
  interactive: { fields: ['content', 'tooltip', 'hint', 'formHint'] },
  section: { fields: ['title'] },
  conditional: { fields: ['description', 'whenTrueSectionConfig.title', 'whenFalseSectionConfig.title'] },
  multistep: { fields: ['content'], stepFields: STEP_FIELDS },
  guided: { fields: ['content'], stepFields: STEP_FIELDS },
  image: { fields: ['alt'] },
  video: { fields: ['title'] },
} as const satisfies Partial<Record<JsonBlock['type'], ProjectionRow>>;

export type TranslatableBlockType = keyof typeof PROJECTION_TABLE;

export function isTranslatableBlockType(type: string): type is TranslatableBlockType {
  return Object.prototype.hasOwnProperty.call(PROJECTION_TABLE, type);
}

export function getProjectionRow(type: string): ProjectionRow | undefined {
  return isTranslatableBlockType(type) ? PROJECTION_TABLE[type] : undefined;
}

/**
 * Read a table field from a block or step by its (possibly dotted) name.
 * Returns the value only when it is a string; anything else reads as absent.
 */
export function readProjectedField(source: object, field: string): string | undefined {
  let value: unknown = source;
  for (const segment of field.split('.')) {
    if (value === null || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, segment)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return typeof value === 'string' ? value : undefined;
}
