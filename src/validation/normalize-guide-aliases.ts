/**
 * Pre-schema normalizer: rewrites the camelCase field aliases the runtime
 * parser tolerates (`targetAction`/`refTarget`/`targetValue`) to their
 * canonical lowercase schema names, so hand-written camelCase guides pass
 * `JsonGuideSchema`. Canonical wins when both are present. Pure and
 * idempotent; runs immediately before the schema in `validateGuide`.
 */

const FIELD_ALIASES: ReadonlyArray<readonly [alias: string, canonical: string]> = [
  ['targetAction', 'action'],
  ['refTarget', 'reftarget'],
  ['targetValue', 'targetvalue'],
];

export function normalizeJsonGuideAliases(raw: unknown): unknown {
  if (Array.isArray(raw)) {
    return raw.map(normalizeJsonGuideAliases);
  }
  if (raw === null || typeof raw !== 'object') {
    return raw;
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    out[key] = normalizeJsonGuideAliases(value);
  }
  for (const [alias, canonical] of FIELD_ALIASES) {
    if (alias in out) {
      if (!(canonical in out)) {
        out[canonical] = out[alias];
      }
      delete out[alias];
    }
  }
  return out;
}
