/**
 * Test-target resolution for the e2e CLI.
 *
 * Maps a guide's `testEnvironment` (from its manifest) to a concrete Grafana
 * target, or to a reason the guide cannot be tested in the current environment.
 * Tier rules are delegated to `checkTier` so there is a single source of truth.
 */

import type { TestEnvironment } from '../../types/package.types';
import { checkTier, type CurrentTier } from './manifest-preflight';

/** Why a guide cannot be tested in the current environment. */
export type TargetSkipReason = 'skipped_no_auth' | 'skipped_tier_mismatch';

/** Resolution of a guide's `testEnvironment` to a concrete test target. */
export interface ResolvedTarget {
  /** True when the guide can run against the resolved target in this environment. */
  runnable: boolean;
  /** Declared tier, or `"local"` when the manifest omits one. */
  tier: string;
  /** Specific instance hostname the guide requested, if any. */
  instance?: string;
  /** Resolved base URL the guide will be tested against. Present only when `runnable`. */
  targetUrl?: string;
  /** Why the guide is not runnable. Present only when not `runnable`. */
  skipReason?: TargetSkipReason;
  /** Human-readable explanation for logging. */
  message?: string;
  /** Cloud credentials. */
  username?: string;
  password?: string;
}

export interface ResolveTargetOptions {
  /** Grafana URL configured for local-tier guides. */
  grafanaUrl: string;
  /** Tier of the current test environment (from `--tier`). */
  currentTier: CurrentTier;
}

/**
 * Resolve a guide's `testEnvironment` to a concrete test target.
 *
 * - `local` / absent / unknown tier → runnable against `options.grafanaUrl`
 * - `cloud` tier on a `local` environment → `skipped_tier_mismatch`
 * - `cloud` tier on a `cloud` environment → `skipped_no_auth` (auth not yet supported)
 */
export function resolveTarget(testEnvironment: TestEnvironment, options: ResolveTargetOptions): ResolvedTarget {
  const tier = testEnvironment.tier ?? 'local';
  const instance = testEnvironment.instance;
  const tierResult = checkTier(testEnvironment, options.currentTier);

  if (tierResult.status === 'skip' && tierResult.code === 'tier-mismatch') {
    return { runnable: false, tier, instance, skipReason: 'skipped_tier_mismatch', message: tierResult.reason };
  }

  // Credentials not yet supported for cloud-tier guides; skip with "skipped_no_auth" reason.
  if (tier === 'cloud') {
    return {
      runnable: false,
      tier,
      instance,
      skipReason: 'skipped_no_auth',
      message: 'Cloud-tier guide requires credentials that are not yet supported',
    };
  }

  return { runnable: true, tier, instance, targetUrl: options.grafanaUrl };
}
