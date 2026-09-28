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
 * It also coerces boolean `targetstate` to its string form — see
 * `BOOLEAN_VALUED_FIELDS` below.
 */

const FIELD_ALIASES: ReadonlyMap<string, string> = new Map([
  ['targetAction', 'action'],
  ['refTarget', 'reftarget'],
  ['targetValue', 'targetvalue'],
  ['targetState', 'targetstate'],
]);

/**
 * Fields authored as `true`/`false` but carried as `"true"`/`"false"`.
 *
 * `targetstate`'s canonical form is a string: it has to express both a boolean
 * ("drive this to on") and an `"<attribute>:<value>"` pair, and the backend
 * InteractiveGuide CRD cannot model a field that is boolean-or-string. A CUE
 * disjunction across two JSON types renders `"type": ["string","boolean"]`,
 * which is not valid Kubernetes JSONSchemaProps — the CRD would fail to apply.
 * Declaring it string-only there instead means a raw boolean is rejected with a
 * 422, so the boolean has to be gone before the guide reaches the API.
 *
 * Authors keep writing `true`, which reads better than `"true"`; this is where
 * that becomes the wire form. Coercing pre-schema (rather than teaching the
 * schema a union) keeps exactly one shape flowing downstream.
 */
const BOOLEAN_VALUED_FIELDS: ReadonlySet<string> = new Set(['targetstate']);

function normalizeFieldValue(canonicalKey: string, value: unknown): unknown {
  if (typeof value === 'boolean' && BOOLEAN_VALUED_FIELDS.has(canonicalKey)) {
    return String(value);
  }
  return normalizeJsonGuideAliases(value);
}

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
      return canonical === undefined || !Object.prototype.hasOwnProperty.call(source, canonical);
    })
    .map(([key, value]) => {
      const canonical = FIELD_ALIASES.get(key) ?? key;
      return [canonical, normalizeFieldValue(canonical, value)] as const;
    });

  return Object.fromEntries(entries);
}
