/**
 * The canonical source hash, `_sourceHash` (docs/design/I18N.md §6.8,
 * "Source hash definition"). The compile step, the validator and
 * `sync-translations` must all call these functions, so that "stale" has one
 * meaning.
 *
 * The hash covers the canonical text an entry translates, never ids: a block
 * or step rename keeps the hash, which is what keeps rename detection
 * possible (§12.6).
 */

import type { JsonBlock } from '../../types/json-guide.types';
import { hashString } from '../hash.util';
import { getProjectionRow, readProjectedField } from './projection-table';

export const SOURCE_HASH_PREFIX = 'sha256:';

const SOURCE_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

export function isWellFormedSourceHash(value: unknown): value is string {
  return typeof value === 'string' && SOURCE_HASH_PATTERN.test(value);
}

/** NFC, with every CRLF and lone CR rewritten to LF. */
export function canonicalizeSourceText(text: string): string {
  return text.normalize('NFC').replace(/\r\n?/g, '\n');
}

function pickFields(source: object, fields: readonly string[]): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const field of fields) {
    const value = readProjectedField(source, field);
    if (value !== undefined) {
      picked[field] = canonicalizeSourceText(value);
    }
  }
  return picked;
}

/**
 * The serialization a block's hash is taken over, or `undefined` for a block
 * type outside the projection table.
 */
export function canonicalBlockSource(block: JsonBlock): string | undefined {
  const row = getProjectionRow(block.type);
  if (!row) {
    return undefined;
  }
  const covered: Record<string, unknown> = pickFields(block, row.fields);
  if (row.stepFields) {
    const steps = 'steps' in block && Array.isArray(block.steps) ? block.steps : [];
    const stepFields = row.stepFields;
    covered.steps = steps.map((step: object) => pickFields(step, stepFields));
  }
  return JSON.stringify(covered);
}

export function canonicalManifestSource(manifest: { description?: unknown; category?: unknown }): string {
  return JSON.stringify(pickFields(manifest, ['description', 'category']));
}

export function canonicalGuideTitleSource(title: string): string {
  return JSON.stringify(pickFields({ title }, ['title']));
}

async function hashCanonical(serialized: string): Promise<string> {
  return `${SOURCE_HASH_PREFIX}${await hashString(serialized)}`;
}

export async function hashBlockSource(block: JsonBlock): Promise<string | undefined> {
  const serialized = canonicalBlockSource(block);
  return serialized === undefined ? undefined : hashCanonical(serialized);
}

export async function hashManifestSource(manifest: { description?: unknown; category?: unknown }): Promise<string> {
  return hashCanonical(canonicalManifestSource(manifest));
}

export async function hashGuideTitleSource(title: string): Promise<string> {
  return hashCanonical(canonicalGuideTitleSource(title));
}
