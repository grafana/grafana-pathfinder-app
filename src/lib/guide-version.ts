/**
 * Runtime Grafana floor for a guide.
 *
 * A guide's manifest may declare `minGrafanaVersion` — the lowest Grafana it is
 * written for. This module reads that floor and compares it to the running
 * instance so the docs panel can warn a reader whose Grafana is too old.
 *
 * Everything except `below-floor` fails **open**. This is the deliberate inverse
 * of `min-version:`'s `minVersionCheck`, which fails closed because it gates a
 * step: here the steps stay live either way, so a false "your Grafana is too
 * old" on a current instance manufactures doubt while a missing warning only
 * withholds an explanation.
 *
 * Pure and dependency-free, so the CLI's e2e preflight shares one comparator
 * with the browser — the same arrangement as `lib/guide-stats`.
 */

export type Version = [number, number, number];

/**
 * Parse a semver-like version string into [major, minor, patch].
 * Returns null for strings that don't match the expected pattern.
 *
 * Handles Grafana's version format which may include pre-release identifiers
 * like "12.2.0-pre" or "12.2.0+security-01" — those are ignored for comparison.
 */
export function parseVersion(version: string): Version | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) {
    return null;
  }
  return [parseInt(match[1]!, 10), parseInt(match[2]!, 10), parseInt(match[3]!, 10)];
}

/**
 * Compare two parsed version tuples.
 * Returns negative if a < b, 0 if equal, positive if a > b.
 */
export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) {
    const diff = a[i]! - b[i]!;
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

export function formatVersion(version: Version): string {
  return version.join('.');
}

/**
 * `additionalFields` is where a manifest key waits for promotion to a real CUE
 * field: the App Platform CRD prunes anything its `#Manifest` doesn't declare.
 * The typed field wins where both are present — same precedence as
 * `recovery/starting-location.ts`, which solves this for its own key.
 */
export function resolveMinGrafanaVersion(packageManifest?: Record<string, unknown>): string | null {
  const declared = packageManifest?.minGrafanaVersion;
  if (typeof declared === 'string' && declared.length > 0) {
    return declared;
  }

  const additional = packageManifest?.additionalFields;
  if (!additional || typeof additional !== 'object' || Array.isArray(additional)) {
    return null;
  }
  const fromAdditional = (additional as Record<string, unknown>).minGrafanaVersion;
  return typeof fromAdditional === 'string' && fromAdditional.length > 0 ? fromAdditional : null;
}

export type VersionSupportReason = 'no-floor' | 'floor-unparseable' | 'current-unknown' | 'supported' | 'below-floor';

/**
 * A union rather than optional fields so a warning always carries both versions:
 * the notice and its analytics event both need them, and only `below-floor`
 * has proven them readable.
 *
 * Versions are normalized `x.y.z` — the component renders these, never the raw
 * manifest string, which bounds author-controlled text to three integers.
 */
export type VersionSupportEvaluation =
  | {
      shouldWarn: false;
      reason: Exclude<VersionSupportReason, 'below-floor'>;
      requiredVersion?: string;
      currentVersion?: string;
    }
  | { shouldWarn: true; reason: 'below-floor'; requiredVersion: string; currentVersion: string };

export function evaluateVersionSupport(input: {
  minGrafanaVersion: string | null;
  currentVersion: string | undefined;
}): VersionSupportEvaluation {
  if (!input.minGrafanaVersion) {
    return { shouldWarn: false, reason: 'no-floor' };
  }

  const required = parseVersion(input.minGrafanaVersion);
  if (!required) {
    return { shouldWarn: false, reason: 'floor-unparseable' };
  }

  const current = input.currentVersion ? parseVersion(input.currentVersion) : null;
  if (!current) {
    return { shouldWarn: false, reason: 'current-unknown', requiredVersion: formatVersion(required) };
  }

  if (compareVersions(current, required) >= 0) {
    return {
      shouldWarn: false,
      reason: 'supported',
      requiredVersion: formatVersion(required),
      currentVersion: formatVersion(current),
    };
  }

  return {
    shouldWarn: true,
    reason: 'below-floor',
    requiredVersion: formatVersion(required),
    currentVersion: formatVersion(current),
  };
}
