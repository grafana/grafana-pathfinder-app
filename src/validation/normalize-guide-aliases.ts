/**
 * Pre-schema normalizer: rewrites the camelCase field aliases the runtime
 * parser tolerates (`targetAction`/`refTarget`/`targetValue`) to their
 * canonical lowercase schema names, so hand-written camelCase guides pass
 * `JsonGuideSchema`. Canonical wins when both are present. Pure and
 * idempotent; runs immediately before the schema in `validateGuide`.
 */

const FIELD_ALIASES: ReadonlyMap<string, string> = new Map([
  ['targetAction', 'action'],
  ['refTarget', 'reftarget'],
  ['targetValue', 'targetvalue'],
]);

export function normalizeJsonGuideAliases(raw: unknown): unknown {
  if (Array.isArray(raw)) {
    return raw.map(normalizeJsonGuideAliases);
  }
  if (raw === null || typeof raw !== 'object') {
    return raw;
  }

  const source = raw as Record<string, unknown>;
  const entries = Object.entries(source)
    .filter(([key]) => {
      const canonical = FIELD_ALIASES.get(key);
      return canonical === undefined || !Object.hasOwn(source, canonical);
    })
    .map(([key, value]) => [FIELD_ALIASES.get(key) ?? key, normalizeJsonGuideAliases(value)] as const);

  return Object.fromEntries(entries);
}
