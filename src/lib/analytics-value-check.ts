/**
 * Development and test check behind the snake_case value convention (see
 * `analytics-values.ts`). `checkValueCasing` returns at once in production, so
 * the minifier drops the scanning code from the entry bundle.
 */

const KEBAB_CASE_VALUE = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

// Identifiers, titles, URLs and requirement expressions carry author- or
// system-chosen text, not a fixed vocabulary, so they are exempt by property name.
// Launch sources pass external values through verbatim (`toAnalyticsLaunchSource`),
// as do Grafana datasource plugin types (`grafana-pyroscope-datasource`).
const EXEMPT_PROPERTY =
  /(?:^|_)(?:id|ids|title|name|url|path|slug|version|selector|query|reftarget|requirement|target|text)$|^(?:launch_)?source$|^datasource_type$/;

export function isExemptAnalyticsProperty(name: string): boolean {
  return EXEMPT_PROPERTY.test(name);
}

let approvedCatalogTopics: ReadonlySet<string> | undefined;

// Official-catalog topics report verbatim (`publicCatalogTopics`), so the
// catalog reporter hands over the set it is reporting against.
export function setApprovedCatalogTopics(topics: ReadonlySet<string> | undefined): void {
  approvedCatalogTopics = topics;
}

function isApprovedExternalValue(name: string, value: string): boolean {
  return name === 'topic' && approvedCatalogTopics?.has(value) === true;
}

export function findKebabCaseValues(properties: Record<string, unknown>): string[] {
  return Object.entries(properties)
    .filter(([name, value]) => typeof value === 'string' && !isExemptAnalyticsProperty(name))
    .filter(
      ([name, value]) => KEBAB_CASE_VALUE.test(value as string) && !isApprovedExternalValue(name, value as string)
    )
    .map(([name, value]) => `${name}=${value as string}`);
}

const recordedViolations: string[] = [];

// Development and test aid only: the production build folds this to a no-op so
// the entry bundle carries none of the checking code.
export function checkValueCasing(context: string, properties: Record<string, unknown> | undefined): void {
  if (process.env.NODE_ENV === 'production') {
    return;
  }
  const offenders = properties ? findKebabCaseValues(properties) : [];
  if (offenders.length > 0) {
    recordValueCasingViolation(context, offenders);
  }
}

function recordValueCasingViolation(context: string, offenders: string[]): void {
  if (process.env.NODE_ENV === 'test') {
    recordedViolations.push(`${context}: ${offenders.join(', ')}`);
  } else {
    // Not logger: logging reaches the Faro adapter, which imports this module.
    console.info(`[analytics] values must be snake_case: ${context}: ${offenders.join(', ')}`);
  }
}

export function drainValueCasingViolations(): string[] {
  return recordedViolations.splice(0);
}
