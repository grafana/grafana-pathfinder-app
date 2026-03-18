/**
 * Manifest pre-flight checks for the e2e CLI.
 *
 * Reads testEnvironment from manifest.json and validates the current test
 * environment against it before running Playwright. Pre-flight failures
 * produce structured skip/fail results — not silent passes.
 *
 * Scope: manifest-aware checks only (tier, minVersion, plugins).
 * Full Layer 4 routing is Phase 6.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { ManifestJsonSchema } from '../../types/package.schema';
import type { ManifestJson, TestEnvironment } from '../../types/package.types';

// ============ RESULT TYPES ============

/** A pre-flight check that passed. */
export interface PreflightPass {
  status: 'pass';
  check: string;
}

/** A pre-flight check that was skipped because the manifest does not declare a requirement. */
export interface PreflightSkip {
  status: 'skip';
  check: string;
  reason: string;
}

/** A pre-flight check that failed — the guide cannot be tested in this environment. */
export interface PreflightFail {
  status: 'fail';
  check: string;
  message: string;
}

export type PreflightResult = PreflightPass | PreflightSkip | PreflightFail;

/** Aggregated outcome from all pre-flight checks. */
export interface PreflightOutcome {
  /** True when all required checks passed (skips are fine). */
  canRun: boolean;
  /**
   * True when the guide was skipped because its testEnvironment.tier does not
   * match the current environment — the caller should log a skip and move on.
   */
  skipped: boolean;
  results: PreflightResult[];
}

// ============ TIER CHECK ============

/**
 * Recognised tier values and what they mean.
 * - `local`  — runs against any Grafana instance (OSS, Docker, local build)
 * - `cloud`  — requires Grafana Cloud; skip when running against local Docker
 *
 * Unknown tiers are treated as unknown — the check passes with a warning logged
 * by the caller; it does NOT fail so that new tiers don't break existing tooling.
 */
export type KnownTier = 'local' | 'cloud';

/** The tier of the current test environment. Defaults to "local". */
export type CurrentTier = KnownTier;

/**
 * Check whether the manifest's declared tier is compatible with the current environment.
 *
 * Rules:
 * - No tier declared → skip (no requirement)
 * - tier === "local" → always passes (local runs anywhere)
 * - tier === "cloud" and currentTier === "local" → skip (not a failure — just not runnable here)
 * - tier === "cloud" and currentTier === "cloud" → pass
 * - Unknown tier → pass with a note (forward-compatible)
 */
export function checkTier(testEnvironment: TestEnvironment, currentTier: CurrentTier): PreflightResult {
  const { tier } = testEnvironment;

  if (!tier) {
    return { status: 'skip', check: 'tier', reason: 'No tier declared in manifest' };
  }

  if (tier === 'local') {
    return { status: 'pass', check: 'tier' };
  }

  if (tier === 'cloud') {
    if (currentTier === 'cloud') {
      return { status: 'pass', check: 'tier' };
    }
    // cloud guide against local environment — skip, not fail
    return {
      status: 'skip',
      check: 'tier',
      reason: `Guide requires tier "cloud" but current environment is "${currentTier}" — skipping`,
    };
  }

  // Unknown tier: pass but let caller log a note
  return { status: 'pass', check: 'tier' };
}

// ============ VERSION CHECK ============

/**
 * Grafana version response from /api/health.
 * We only need the version field.
 */
interface GrafanaHealthResponse {
  version?: string;
  database?: string;
}

/**
 * Parse a semver-like version string into [major, minor, patch] numbers.
 * Returns null for strings that don't match the expected pattern.
 *
 * Handles Grafana's version format which may include pre-release identifiers
 * like "12.2.0-pre" or "12.2.0+security-01" — those are ignored for comparison.
 */
export function parseVersion(version: string): [number, number, number] | null {
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
export function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    const diff = a[i]! - b[i]!;
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/**
 * Check whether the running Grafana instance meets the manifest's minVersion requirement.
 * Fetches /api/health to get the actual version.
 *
 * @param testEnvironment - The testEnvironment block from manifest.json
 * @param grafanaUrl - The Grafana base URL (e.g. "http://localhost:3000")
 */
export async function checkMinVersion(testEnvironment: TestEnvironment, grafanaUrl: string): Promise<PreflightResult> {
  const { minVersion } = testEnvironment;

  if (!minVersion) {
    return { status: 'skip', check: 'minVersion', reason: 'No minVersion declared in manifest' };
  }

  const requiredParsed = parseVersion(minVersion);
  if (!requiredParsed) {
    return {
      status: 'fail',
      check: 'minVersion',
      message: `Invalid minVersion in manifest: "${minVersion}" is not a valid semver string`,
    };
  }

  let actualVersion: string;
  try {
    const healthUrl = new URL('/api/health', grafanaUrl).toString();
    const response = await fetch(healthUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return {
        status: 'fail',
        check: 'minVersion',
        message: `Could not fetch Grafana version: HTTP ${response.status} ${response.statusText}`,
      };
    }

    const data = (await response.json()) as GrafanaHealthResponse;
    if (!data.version) {
      return {
        status: 'fail',
        check: 'minVersion',
        message: 'Grafana /api/health did not return a version field',
      };
    }
    actualVersion = data.version;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === 'TimeoutError'
          ? 'Connection timeout fetching Grafana version'
          : error.message
        : 'Unknown error fetching Grafana version';
    return { status: 'fail', check: 'minVersion', message };
  }

  const actualParsed = parseVersion(actualVersion);
  if (!actualParsed) {
    return {
      status: 'fail',
      check: 'minVersion',
      message: `Grafana returned an unrecognised version string: "${actualVersion}"`,
    };
  }

  if (compareVersions(actualParsed, requiredParsed) < 0) {
    return {
      status: 'fail',
      check: 'minVersion',
      message: `Grafana ${actualVersion} is below the required minimum ${minVersion} — upgrade Grafana before running this guide`,
    };
  }

  return { status: 'pass', check: 'minVersion' };
}

// ============ PLUGIN CHECK ============

/**
 * Grafana plugin list item from /api/plugins.
 * We only need id and enabled.
 */
interface GrafanaPlugin {
  id: string;
  enabled?: boolean;
}

/**
 * Fetch the list of installed Grafana plugins.
 * Returns a Set of plugin IDs for fast lookup.
 */
async function fetchInstalledPlugins(grafanaUrl: string): Promise<Set<string>> {
  const pluginsUrl = new URL('/api/plugins', grafanaUrl).toString();
  const response = await fetch(pluginsUrl, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as GrafanaPlugin[];
  return new Set(data.map((p) => p.id));
}

/**
 * Check whether all plugins declared in testEnvironment.plugins are installed.
 *
 * @param testEnvironment - The testEnvironment block from manifest.json
 * @param grafanaUrl - The Grafana base URL
 */
export async function checkPlugins(testEnvironment: TestEnvironment, grafanaUrl: string): Promise<PreflightResult[]> {
  const { plugins } = testEnvironment;

  if (!plugins || plugins.length === 0) {
    return [{ status: 'skip', check: 'plugins', reason: 'No plugins declared in manifest' }];
  }

  let installed: Set<string>;
  try {
    installed = await fetchInstalledPlugins(grafanaUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error fetching plugin list';
    // Return a single fail for the fetch error rather than one per plugin
    return [
      {
        status: 'fail',
        check: 'plugins',
        message: `Could not fetch installed plugins: ${message}`,
      },
    ];
  }

  return plugins.map((pluginId): PreflightResult => {
    if (installed.has(pluginId)) {
      return { status: 'pass', check: `plugin:${pluginId}` };
    }
    return {
      status: 'fail',
      check: `plugin:${pluginId}`,
      message: `Required plugin "${pluginId}" is not installed in Grafana`,
    };
  });
}

// ============ MANIFEST LOADER ============

/**
 * Load and parse manifest.json from a package directory.
 * Returns null when the file does not exist (manifest is optional).
 * Throws on parse errors so callers can surface them clearly.
 */
export function loadManifestFromDir(packageDir: string): ManifestJson | null {
  const manifestPath = join(packageDir, 'manifest.json');

  if (!existsSync(manifestPath)) {
    return null;
  }

  const raw = readFileSync(manifestPath, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  // Use loose parsing — tolerate extension fields the CLI doesn't know about
  const result = ManifestJsonSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid manifest.json in ${packageDir}: ${result.error.issues.map((i) => i.message).join('; ')}`);
  }
  return result.data as ManifestJson;
}

// ============ ORCHESTRATION ============

/**
 * Options for runManifestPreflight.
 */
export interface ManifestPreflightOptions {
  grafanaUrl: string;
  currentTier: CurrentTier;
}

/**
 * Run all manifest pre-flight checks and return an aggregated outcome.
 *
 * Order of checks:
 * 1. tier — fast, no I/O; if guide should be skipped, returns early
 * 2. minVersion — one HTTP call to /api/health
 * 3. plugins — one HTTP call to /api/plugins
 *
 * When the tier check produces a skip, the function returns immediately with
 * `skipped: true` and `canRun: false` — no further network calls are made.
 */
export async function runManifestPreflight(
  manifest: ManifestJson,
  options: ManifestPreflightOptions
): Promise<PreflightOutcome> {
  const testEnvironment = manifest.testEnvironment ?? {};
  const results: PreflightResult[] = [];

  // 1. Tier check (fast, no network)
  const tierResult = checkTier(testEnvironment, options.currentTier);
  results.push(tierResult);

  if (tierResult.status === 'skip' && tierResult.reason.includes('skipping')) {
    // Tier mismatch — guide is not runnable in this environment
    return { canRun: false, skipped: true, results };
  }

  // 2. Version check
  const versionResult = await checkMinVersion(testEnvironment, options.grafanaUrl);
  results.push(versionResult);

  // 3. Plugin checks
  const pluginResults = await checkPlugins(testEnvironment, options.grafanaUrl);
  results.push(...pluginResults);

  const hasFail = results.some((r) => r.status === 'fail');
  return { canRun: !hasFail, skipped: false, results };
}
