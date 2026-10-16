export type Version = [number, number, number];

export function parseVersion(version: string): Version | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) {
    return null;
  }
  return [parseInt(match[1]!, 10), parseInt(match[2]!, 10), parseInt(match[3]!, 10)];
}

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

export type ManifestCandidates = Record<string, unknown> | Array<Record<string, unknown> | undefined>;

export function resolveMinGrafanaVersion(packageManifests?: ManifestCandidates): string | null {
  const candidates = Array.isArray(packageManifests) ? packageManifests : [packageManifests];

  for (const packageManifest of candidates) {
    const declared = readFloor(packageManifest?.minGrafanaVersion);
    if (declared) {
      return declared;
    }

    const additional = packageManifest?.additionalFields;
    if (!additional || typeof additional !== 'object' || Array.isArray(additional)) {
      continue;
    }
    const fromAdditional = readFloor((additional as Record<string, unknown>).minGrafanaVersion);
    if (fromAdditional) {
      return fromAdditional;
    }
  }

  return null;
}

function readFloor(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export type VersionSupportReason = 'no-floor' | 'floor-unparseable' | 'current-unknown' | 'supported' | 'below-floor';

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
