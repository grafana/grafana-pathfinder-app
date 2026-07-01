/**
 * Test-target resolution for the e2e CLI.
 *
 * Maps a guide's `testEnvironment` (from its manifest) to a concrete Grafana
 * target, or to a reason the guide cannot be tested in the current environment.
 * Tier rules are delegated to `checkTier` so there is a single source of truth.
 */

import type { TestEnvironment } from '../../types/package.types';
import { checkTier, type CurrentTier } from './manifest-preflight';

/**
 * Why a guide cannot be tested in the current environment.
 *
 * `skipped_invalid_instance` is distinct from `skipped_tier_mismatch`: the
 * former means the manifest's `instance` is malformed (author error), the
 * latter means the guide targets a tier/instance this CLI is not configured
 * for (a legitimate routing decision). Collapsing them would hide a typo.
 */
export type TargetSkipReason = 'skipped_no_auth' | 'skipped_tier_mismatch' | 'skipped_invalid_instance';
export interface CloudTargetCapabilities {
  sharedStackUrls: string[];
  isolatedStack?: boolean;
}

/** Resolution of a guide's `testEnvironment` to a concrete test target. */
export interface ResolvedTarget {
  /** True when the guide can run against the resolved target in this environment. */
  runnable: boolean;
  /** Declared tier, or `"local"` when the manifest omits one. */
  tier: string;
  /** Specific instance hostname the guide requested, if any. */
  instance?: string;
  /** Resolved Grafana base URL the guide will be tested against. Present only when `runnable`. */
  targetUrl?: string;
  /** Why the guide is not runnable. Present only when not `runnable`. */
  skipReason?: TargetSkipReason;
  /** Human-readable explanation for logging. */
  message?: string;
}

export interface ResolveTargetOptions {
  /** Grafana URL configured for local-tier guides. */
  grafanaUrl: string;
  /** Tier of the current test environment (from `--tier`). */
  currentTier: CurrentTier;
  /** Default cloud instance URL for `cloud`-tier guides without an `instance`. */
  cloudUrl?: string;
  /** Cloud execution capabilities without exposing credential values to resolution. */
  cloudTargetCapabilities?: CloudTargetCapabilities;
}

/**
 * Build a Grafana base URL from a host-only `instance` (e.g. `play.grafana.org`
 * → `https://play.grafana.org/`). Returns undefined when `instance` carries a
 * scheme, port, or path, so the caller can report a malformed instance rather
 * than test the wrong target.
 */
export function cloudInstanceUrl(instance: string): string | undefined {
  const hostnamePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
  if (!hostnamePattern.test(instance)) {
    return undefined;
  }
  try {
    return new URL(`https://${instance}/`).toString();
  } catch {
    return undefined;
  }
}

function hasSharedStackAuthFor(targetUrl: string, options: ResolveTargetOptions): boolean {
  return (options.cloudTargetCapabilities?.sharedStackUrls ?? []).some((sharedStackUrl) =>
    sameOrigin(targetUrl, sharedStackUrl)
  );
}

export function sameOrigin(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) {
    return false;
  }
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

/**
 * Resolve a guide's `testEnvironment` to a concrete test target.
 *
 * - `local` / absent / unknown tier → runnable against `options.grafanaUrl`
 * - `cloud` tier on a `local` environment → `skipped_tier_mismatch`
 * - `cloud` tier without shared-stack auth or isolated-stack support → `skipped_no_auth`
 * - `cloud` tier with a malformed `instance` → `skipped_invalid_instance`
 * - `cloud` tier with `instance` → runnable only with shared-stack auth for that exact instance
 * - `cloud` tier without `instance` → runnable with shared-stack auth or isolated-stack support
 */
export function resolveTarget(testEnvironment: TestEnvironment, options: ResolveTargetOptions): ResolvedTarget {
  const tier = testEnvironment.tier ?? 'local';
  const instance = testEnvironment.instance;
  const tierResult = checkTier(testEnvironment, options.currentTier);

  if (tierResult.status === 'skip' && tierResult.code === 'tier-mismatch') {
    return { runnable: false, tier, instance, skipReason: 'skipped_tier_mismatch', message: tierResult.reason };
  }

  if (tier === 'cloud') {
    const targetCapabilities = options.cloudTargetCapabilities ?? { sharedStackUrls: [] };
    const defaultTargetUrl = options.cloudUrl;

    if (instance !== undefined) {
      const instanceUrl = cloudInstanceUrl(instance);
      if (!instanceUrl) {
        return {
          runnable: false,
          tier,
          instance,
          skipReason: 'skipped_invalid_instance',
          message: `Cloud instance "${instance}" is not a bare hostname (no protocol, port, or path allowed)`,
        };
      }
      if (!hasSharedStackAuthFor(instanceUrl, options)) {
        return {
          runnable: false,
          tier,
          instance,
          skipReason: 'skipped_no_auth',
          message: `Cloud instance "${instance}" requires --cloud-instance-admin-token for ${instanceUrl}`,
        };
      }
      return { runnable: true, tier, instance, targetUrl: instanceUrl };
    }
    if (!defaultTargetUrl) {
      return {
        runnable: false,
        tier,
        instance,
        skipReason: 'skipped_tier_mismatch',
        message: 'No cloud URL configured for this guide (set --cloud-url)',
      };
    }
    if (targetCapabilities.sharedStackUrls.length === 0 && !targetCapabilities.isolatedStack) {
      return {
        runnable: false,
        tier,
        instance,
        skipReason: 'skipped_no_auth',
        message: 'Cloud-tier guide requires --cloud-instance-admin-token for its target',
      };
    }
    if (!hasSharedStackAuthFor(defaultTargetUrl, options)) {
      if (targetCapabilities.isolatedStack) {
        return { runnable: true, tier, instance, targetUrl: defaultTargetUrl };
      }
      return {
        runnable: false,
        tier,
        instance,
        skipReason: 'skipped_no_auth',
        message: `Cloud-tier guide requires --cloud-instance-admin-token for ${defaultTargetUrl}`,
      };
    }
    return { runnable: true, tier, instance, targetUrl: defaultTargetUrl };
  }

  return { runnable: true, tier, instance, targetUrl: options.grafanaUrl };
}
