/**
 * Command-side results model for the e2e command.
 *
 * The pure glue between the resolver layer and the JSON report / process exit:
 * run-mode resolution, the mapping from resolver outcomes (SkippedPackage,
 * ResolvedRemoteGuide) to the command's GuideRunResult, report enrichment, and
 * the exit-code rules. Kept free of console, process, and Playwright side
 * effects so the command-side contract can be unit-tested without booting the
 * runner.
 */

import { existsSync, statSync } from 'fs';

import {
  REMOTE_SKIP_REASONS,
  type RemoteSkipReason,
  type ResolvedRemoteGuide,
  type SkippedPackage,
} from './e2e-package';
import type { PreRunSkip, TestResultsData } from './e2e-reporter';
import { ExitCode } from './exit-codes';
import type { AbortReason } from './playwright-runner';

/** How guide inputs are resolved for a run. */
export type RunMode = 'local' | 'remote-package' | 'remote-repository';

/** Package metadata attached to a remotely-resolved guide's report. */
export interface PackageMeta {
  packageId: string;
  tier?: string;
  instance?: string;
  targetUrl?: string;
  sourceUrl?: string;
}

/**
 * A guide's terminal status: either a run outcome (the runner executed or aborted
 * it) or a remote skip reason (the resolver skipped it before execution). The
 * skip half is derived from the resolver's `RemoteSkipReason` so the two
 * vocabularies cannot drift.
 */
export type GuideStatus = 'passed' | 'failed' | 'auth_expired' | 'skipped_prereq' | RemoteSkipReason;

export interface GuideRunResult {
  guide: string;
  id: string;
  status: GuideStatus;
  exitCode: number;
  traceFile?: string;
  abortReason?: AbortReason;
  abortMessage?: string;
  resultsData?: TestResultsData;
  autoIncluded: boolean;
  failedPrerequisite?: string;
  /** Declared tier for pre-run skips (for reporting). */
  tier?: string;
}

/** Statuses that count as a test failure (non-zero exit). */
export const FAILURE_STATUSES: ReadonlySet<GuideStatus> = new Set<GuideStatus>(['failed', 'validation_failed']);

/** Pre-run skips (the resolver's skip reasons) recorded in the JSON report; excludes skipped_prereq, which carries step data. */
export const PRE_RUN_SKIP_STATUSES: ReadonlySet<GuideStatus> = new Set<GuideStatus>(REMOTE_SKIP_REASONS);

/** Summary line labels in display order. */
export const GUIDE_STATUS_LABELS: ReadonlyArray<readonly [GuideStatus, string]> = [
  ['passed', '✅ Passed'],
  ['failed', '❌ Failed'],
  ['validation_failed', '❌ Validation failed'],
  ['auth_expired', '🔐 Auth expired'],
  ['skipped_prereq', '⊘ Skipped (prerequisite failed)'],
  ['prerequisite_failed', '⊘ Skipped (prerequisite failed)'],
  ['skipped_tier_mismatch', '⊘ Skipped (tier mismatch)'],
  ['skipped_no_auth', '⊘ Skipped (no cloud auth)'],
  ['unsupported_type', '⊘ Skipped (unsupported type)'],
  ['fetch_failed', '⊘ Skipped (fetch failed)'],
  ['resolution_failed', '⊘ Skipped (resolution failed)'],
];

/** Per-guide listing icons. */
export const GUIDE_STATUS_ICONS: Record<GuideStatus, string> = {
  passed: '✅',
  failed: '❌',
  validation_failed: '❌',
  auth_expired: '🔐',
  skipped_prereq: '⊘',
  prerequisite_failed: '⊘',
  skipped_tier_mismatch: '⊘',
  skipped_no_auth: '⊘',
  unsupported_type: '⊘',
  fetch_failed: '⊘',
  resolution_failed: '⊘',
};

/** True when the value points at an existing local directory (vs. a bare package ID). */
function isExistingDir(value: string): boolean {
  try {
    return existsSync(value) && statSync(value).isDirectory();
  } catch {
    return false;
  }
}

/** The subset of CLI options that determines how guide inputs are resolved. */
export interface RunModeOptions {
  /** Resolve and test every package in the CDN repository index. */
  remote: boolean;
  /** A local package directory or a bare package ID. */
  package?: string;
}

/** Determine how guide inputs should be resolved for this run. */
export function resolveRunMode(options: RunModeOptions): RunMode {
  if (options.remote) {
    return 'remote-repository';
  }
  if (options.package && !isExistingDir(options.package)) {
    return 'remote-package';
  }
  return 'local';
}

/** Convert a pre-run skipped package into a guide run result. */
export function skipToResult(skip: SkippedPackage): GuideRunResult {
  return {
    guide: skip.sourceUrl ?? skip.id,
    id: skip.id,
    status: skip.reason,
    exitCode: skip.reason === 'validation_failed' ? ExitCode.TEST_FAILURE : ExitCode.SUCCESS,
    autoIncluded: false,
    abortMessage: skip.message,
    tier: skip.tier,
  };
}

/** Index resolved remote guides by ID for report enrichment. */
export function buildPackageMetaMap(runnable: ResolvedRemoteGuide[]): Map<string, PackageMeta> {
  return new Map(
    runnable.map((g) => [
      g.id,
      { packageId: g.id, tier: g.tier, instance: g.instance, targetUrl: g.targetUrl, sourceUrl: g.sourceUrl },
    ])
  );
}

/**
 * Merge package metadata into a guide's report data (no-op for local guides,
 * which have no package metadata).
 */
export function applyPackageMeta(data: TestResultsData | undefined, meta: PackageMeta | undefined): void {
  if (!data || !meta) {
    return;
  }
  data.guide = {
    ...data.guide,
    packageId: meta.packageId,
    tier: meta.tier,
    instance: meta.instance,
    sourceUrl: meta.sourceUrl,
  };
}

/**
 * Extract pre-run skip outcomes (remote modes) for inclusion in the JSON report.
 */
export function preRunSkipsFromResults(results: GuideRunResult[]): PreRunSkip[] {
  return results
    .filter((r) => PRE_RUN_SKIP_STATUSES.has(r.status))
    .map((r) => ({
      id: r.id,
      reason: r.status,
      message: r.abortMessage ?? '',
      failed: FAILURE_STATUSES.has(r.status),
      tier: r.tier,
      sourceUrl: r.guide,
    }));
}

/**
 * Exit code implied by the final results: auth failure takes precedence over a
 * generic/validation test failure; a fully passing run yields SUCCESS.
 */
export function exitCodeFromResults(results: GuideRunResult[]): number {
  if (results.some((r) => r.status === 'auth_expired')) {
    return ExitCode.AUTH_FAILURE;
  }
  if (results.some((r) => FAILURE_STATUSES.has(r.status))) {
    return ExitCode.TEST_FAILURE;
  }
  return ExitCode.SUCCESS;
}
