const pluralSuffix = /_(zero|one|two|few|many|other)$/;

export function flattenCatalog(catalog, prefix = '') {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    throw new Error(`Invalid catalog object at ${prefix || '<root>'}`);
  }
  const entries = Object.entries(catalog).flatMap(([key, value]) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      return [[fullKey, value]];
    }
    return Object.entries(flattenCatalog(value, fullKey));
  });
  const seen = new Set();
  for (const [key] of entries) {
    if (seen.has(key)) {
      throw new Error(`Duplicate flattened catalog key: ${key}`);
    }
    seen.add(key);
  }
  return Object.fromEntries(entries);
}

export function placeholders(value) {
  return [
    ...new Set([...value.matchAll(/{{\s*(-?)\s*([^{}]+?)\s*}}/g)].map((match) => `${match[1]}${match[2].trim()}`)),
  ].sort();
}

function pluralRoots(english) {
  return new Set(
    Object.keys(english)
      .filter((key) => key.endsWith('_other'))
      .map((key) => key.slice(0, -6))
  );
}

export function localeKeys(english, locale) {
  const roots = pluralRoots(english);
  const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
  const required = new Set();
  const allowed = new Set(Object.keys(english));
  for (const key of Object.keys(english)) {
    const root = key.replace(pluralSuffix, '');
    if (!roots.has(root) || root === key) {
      required.add(key);
    }
  }
  for (const root of roots) {
    for (const category of categories) {
      required.add(`${root}_${category}`);
      allowed.add(`${root}_${category}`);
    }
    // i18next permits an explicit zero override in every locale.
    allowed.add(`${root}_zero`);
  }
  return { required, allowed };
}

export function englishValue(english, key) {
  return english[key] ?? english[key.replace(pluralSuffix, '_other')];
}

export function inspectCatalogs(catalogs) {
  const english = catalogs['en-US'];
  if (!english) {
    throw new Error('The en-US catalog is missing.');
  }
  const violations = new Map();
  const empty = new Map();
  for (const [locale, catalog] of Object.entries(catalogs)) {
    if (locale === 'en-US') {
      continue;
    }
    const { required, allowed } = localeKeys(english, locale);
    const found = new Set();
    for (const key of required) {
      if (!Object.hasOwn(catalog, key)) {
        found.add(`missing-key:${key}`);
      }
    }
    for (const [key, value] of Object.entries(catalog)) {
      if (!allowed.has(key)) {
        found.add(`obsolete-key:${key}`);
      } else if (value.trim()) {
        const expected = placeholders(englishValue(english, key));
        const actual = placeholders(value);
        if (JSON.stringify(expected) !== JSON.stringify(actual)) {
          found.add(`placeholder-mismatch:${key}:${JSON.stringify([expected, actual])}`);
        }
      }
    }
    violations.set(locale, found);
    empty.set(
      locale,
      Object.keys(catalog)
        .filter((key) => allowed.has(key) && !catalog[key].trim())
        .sort()
    );
  }
  return { violations, empty };
}

export function expandBaseline(baseline) {
  if (baseline.version !== 1 || !Array.isArray(baseline.groups)) {
    throw new Error('Invalid translation baseline version or groups.');
  }
  const result = new Map();
  for (const group of baseline.groups) {
    const validTracking = /^(pending|#\d+|https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+)$/.test(
      group.tracking ?? ''
    );
    if (
      typeof group.reason !== 'string' ||
      !group.reason.trim() ||
      !validTracking ||
      !Array.isArray(group.locales) ||
      !group.locales.length ||
      !Array.isArray(group.violations) ||
      !group.violations.length
    ) {
      throw new Error('Each baseline group needs locales, violations, a reason, and tracking.');
    }
    for (const locale of group.locales) {
      if (typeof locale !== 'string' || locale === 'en-US') {
        throw new Error(`Invalid baseline locale: ${locale}`);
      }
      const entries = result.get(locale) ?? new Set();
      for (const violation of group.violations) {
        if (!/^(missing-key|obsolete-key|placeholder-mismatch):.+/.test(violation) || entries.has(violation)) {
          throw new Error(`Invalid or duplicate baseline entry: ${locale}: ${violation}`);
        }
        entries.add(violation);
      }
      result.set(locale, entries);
    }
  }
  return result;
}

export function compareBaseline(violations, baseline) {
  const allowed = expandBaseline(baseline);
  const added = [];
  const stale = [];
  for (const locale of new Set([...violations.keys(), ...allowed.keys()])) {
    const actual = violations.get(locale) ?? new Set();
    const expected = allowed.get(locale) ?? new Set();
    for (const entry of actual) {
      if (!expected.has(entry)) {
        added.push(`${locale}: ${entry}`);
      }
    }
    for (const entry of expected) {
      if (!actual.has(entry)) {
        stale.push(`${locale}: ${entry}`);
      }
    }
  }
  return { added: added.sort(), stale: stale.sort() };
}

export function pruneBaseline(baseline, violations) {
  expandBaseline(baseline);
  return {
    ...baseline,
    groups: baseline.groups.flatMap((group) => {
      const buckets = new Map();
      for (const locale of group.locales) {
        const remaining = group.violations.filter((entry) => violations.get(locale)?.has(entry));
        if (!remaining.length) {
          continue;
        }
        const signature = JSON.stringify(remaining);
        const bucket = buckets.get(signature) ?? { ...group, locales: [], violations: remaining };
        bucket.locales.push(locale);
        buckets.set(signature, bucket);
      }
      return [...buckets.values()];
    }),
  };
}
