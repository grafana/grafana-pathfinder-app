/**
 * Casing convention for analytics property values: snake_case, like event and
 * property names. Domain vocabularies that double as URL parameters or
 * persisted data keep their own spelling; convert them with
 * `toAnalyticsValue` where they cross into telemetry.
 */

export type AnalyticsValue<S extends string> = S extends `${infer Head}-${infer Tail}`
  ? `${Head}_${AnalyticsValue<Tail>}`
  : S;

export function toAnalyticsValue<S extends string>(value: S): AnalyticsValue<S> {
  return value.replace(/-/g, '_') as AnalyticsValue<S>;
}

const KEBAB_CASE_VALUE = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

// Identifiers, titles, URLs and requirement expressions carry author- or
// system-chosen text, not a fixed vocabulary, so they are exempt by property name.
const EXEMPT_PROPERTY =
  /(?:^|_)(?:id|ids|title|name|url|path|slug|version|selector|query|reftarget|requirement|target|text)$/;

export function isExemptAnalyticsProperty(name: string): boolean {
  return EXEMPT_PROPERTY.test(name);
}

export function findKebabCaseValues(properties: Record<string, unknown>): string[] {
  return Object.entries(properties)
    .filter(([name, value]) => typeof value === 'string' && !isExemptAnalyticsProperty(name))
    .filter(([, value]) => KEBAB_CASE_VALUE.test(value as string))
    .map(([name, value]) => `${name}=${value as string}`);
}

const recordedViolations: string[] = [];

export function checkValueCasing(context: string, properties: Record<string, unknown> | undefined): void {
  const offenders = properties ? findKebabCaseValues(properties) : [];
  if (offenders.length > 0) {
    recordValueCasingViolation(context, offenders);
  }
}

function recordValueCasingViolation(context: string, offenders: string[]): void {
  if (process.env.NODE_ENV === 'test') {
    recordedViolations.push(`${context}: ${offenders.join(', ')}`);
  } else if (process.env.NODE_ENV !== 'production') {
    // Not logger: logging reaches the Faro adapter, which imports this module.
    console.info(`[analytics] values must be snake_case: ${context}: ${offenders.join(', ')}`);
  }
}

export function drainValueCasingViolations(): string[] {
  return recordedViolations.splice(0);
}
