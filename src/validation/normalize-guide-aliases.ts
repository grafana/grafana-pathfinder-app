/**
 * Pre-schema normalizer: rewrites the camelCase field aliases the runtime
 * parser tolerates (`targetAction`/`refTarget`/`targetValue`/`targetState`) to
 * their canonical lowercase schema names, so hand-written camelCase guides pass
 * `JsonGuideSchema`. Canonical wins when both are present. Pure and
 * idempotent; runs immediately before the schema in `validateGuide`.
 *
 * An alias missing from this map does not fail loudly: the schema strips it and
 * the guide validates without it, so the field is silently gone downstream.
 * Every alias the parser reads must therefore have an entry here.
 *
 * It also coerces boolean `targetstate` to its string form.
 */

import { normalizeJsonGuideAliasFields, readJsonGuideAliasedField } from '../types/json-guide-aliases';

/**
 * Reads `canonicalKey` off a record that may not have been normalized yet,
 * falling back to whichever alias maps to it. Canonical wins when both are
 * present, matching `normalizeJsonGuideAliases`.
 *
 * For the read paths that see raw guide JSON — a backend guide loaded straight
 * into editor state never passes through `validateGuide` — so a camelCase-only
 * guide is not silently read as having no action at all.
 */
export function readAliasedField(source: Record<string, unknown>, canonicalKey: string): unknown {
  return readJsonGuideAliasedField(source, canonicalKey);
}

export function normalizeJsonGuideAliases(raw: unknown): unknown {
  if (Array.isArray(raw)) {
    return raw.map(normalizeJsonGuideAliases);
  }
  if (raw === null || typeof raw !== 'object') {
    return raw;
  }

  const entries = Object.entries(normalizeJsonGuideAliasFields(raw as Record<string, unknown>)).map(([key, value]) => [
    key,
    normalizeJsonGuideAliases(value),
  ]);

  return Object.fromEntries(entries);
}
