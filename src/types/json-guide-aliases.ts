const FIELD_ALIASES: ReadonlyMap<string, string> = new Map([
  ['targetAction', 'action'],
  ['refTarget', 'reftarget'],
  ['targetValue', 'targetvalue'],
  ['targetState', 'targetstate'],
]);

const BOOLEAN_VALUED_FIELDS: ReadonlySet<string> = new Set(['targetstate']);

export function normalizeJsonGuideAliasFields(source: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(source)
      .filter(([key]) => {
        const canonical = FIELD_ALIASES.get(key);
        return canonical === undefined || !Object.prototype.hasOwnProperty.call(source, canonical);
      })
      .map(([key, value]) => {
        const canonical = FIELD_ALIASES.get(key) ?? key;
        const normalized = typeof value === 'boolean' && BOOLEAN_VALUED_FIELDS.has(canonical) ? String(value) : value;
        return [canonical, normalized];
      })
  );
}

export function readJsonGuideAliasedField(source: Record<string, unknown>, canonicalKey: string): unknown {
  if (Object.prototype.hasOwnProperty.call(source, canonicalKey)) {
    return source[canonicalKey];
  }
  for (const [alias, canonical] of FIELD_ALIASES) {
    if (canonical === canonicalKey && Object.prototype.hasOwnProperty.call(source, alias)) {
      return source[alias];
    }
  }
  return undefined;
}
