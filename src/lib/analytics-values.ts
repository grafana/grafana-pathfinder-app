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
