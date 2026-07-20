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
import type { E2EErrorCode, E2EExecutionOutcome, PreRunSkip } from './schemas/e2e-report.schema';
import { contentDigest, type TestResultsData } from './e2e-reporter';
import { ExitCode } from './exit-codes';
import type { AbortReason } from './playwright-runner';
import type { SideEffectClassification } from './side-effects';

/** How guide inputs are resolved for a run. */
export type RunMode = 'local' | 'remote-package' | 'remote-repository';

/** Package metadata attached to a remotely-resolved guide's report. */
export interface PackageMeta {
  packageId: string;
  tier?: string;
  instance?: string;
  targetUrl?: string;
  sourceUrl?: string;
  sideEffects?: SideEffectClassification;
  plugins?: string[];
}

/**
 * A guide's terminal status: either a run outcome (the runner executed or aborted
 * it) or a remote skip reason (the resolver skipped it before execution). The
 * skip half is derived from the resolver's `RemoteSkipReason` so the two
 * vocabularies cannot drift.
 */
export type GuideStatus =
  'passed' | 'failed' | 'provisioning_failed' | 'auth_expired' | 'skipped_prereq' | RemoteSkipReason;

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
  sideEffects?: SideEffectClassification;
}

/** Statuses that count as a test failure (non-zero exit). */
export const FAILURE_STATUSES: ReadonlySet<GuideStatus> = new Set<GuideStatus>([
  'failed',
  'provisioning_failed',
  'validation_failed',
]);

/** Pre-run skips (the resolver's skip reasons) recorded in the JSON report; excludes skipped_prereq, which carries step data. */
export const PRE_RUN_SKIP_STATUSES: ReadonlySet<GuideStatus> = new Set<GuideStatus>(REMOTE_SKIP_REASONS);

/** Summary line labels in display order. */
export const GUIDE_STATUS_LABELS: ReadonlyArray<readonly [GuideStatus, string]> = [
  ['passed', '✅ Passed'],
  ['failed', '❌ Failed'],
  ['provisioning_failed', '❌ Provisioning failed'],
  ['validation_failed', '❌ Validation failed'],
  ['auth_expired', '🔐 Auth expired'],
  ['skipped_prereq', '⊘ Skipped (prerequisite failed)'],
  ['prerequisite_failed', '⊘ Skipped (prerequisite failed)'],
  ['skipped_tier_mismatch', '⊘ Skipped (tier mismatch)'],
  ['skipped_no_auth', '⊘ Skipped (no cloud auth)'],
  ['skipped_invalid_instance', '⊘ Skipped (invalid instance)'],
  ['skipped_unsafe_shared_stack', '⊘ Skipped (unsafe shared stack)'],
  ['unsupported_type', '⊘ Skipped (unsupported type)'],
  ['fetch_failed', '⊘ Skipped (fetch failed)'],
  ['resolution_failed', '⊘ Skipped (resolution failed)'],
];

/** Per-guide listing icons. */
export const GUIDE_STATUS_ICONS: Record<GuideStatus, string> = {
  passed: '✅',
  failed: '❌',
  provisioning_failed: '❌',
  validation_failed: '❌',
  auth_expired: '🔐',
  skipped_prereq: '⊘',
  prerequisite_failed: '⊘',
  skipped_tier_mismatch: '⊘',
  skipped_no_auth: '⊘',
  skipped_invalid_instance: '⊘',
  skipped_unsafe_shared_stack: '⊘',
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
    sideEffects: skip.sideEffects,
  };
}

/** Index resolved remote guides by ID for report enrichment. */
export function buildPackageMetaMap(runnable: ResolvedRemoteGuide[]): Map<string, PackageMeta> {
  return new Map(
    runnable.map((g) => [
      g.id,
      {
        packageId: g.id,
        tier: g.tier,
        instance: g.instance,
        targetUrl: g.targetUrl,
        sourceUrl: g.sourceUrl,
        sideEffects: g.sideEffects,
        ...(g.plugins?.length ? { plugins: g.plugins } : {}),
      },
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
    sideEffects: meta.sideEffects,
  };
}

interface PlannedGuideForResult {
  id: string;
  guide: { path: string; content?: string };
  autoIncluded: boolean;
}
export function provisioningErrorCode(error: unknown): E2EErrorCode {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code.toLowerCase()
      : undefined;
  return code === 'no_capacity' ? 'NO_CAPACITY' : 'PROVISIONING_FAILED';
}

export function provisioningFailureResults(
  chain: PlannedGuideForResult[],
  packageMetaById: Map<string, PackageMeta>,
  fallbackTargetUrl: string,
  message: string,
  errorCode: E2EErrorCode = 'PROVISIONING_FAILED',
  outcome: E2EExecutionOutcome = 'infrastructure_error'
): GuideRunResult[] {
  return chain.map((planned) => {
    const meta = packageMetaById.get(planned.id);
    const resultsData: TestResultsData = {
      guide: {
        id: planned.id,
        title: planned.id,
        path: planned.guide.path,
        targetUrl: meta?.targetUrl ?? fallbackTargetUrl,
        ...(planned.guide.content ? { contentDigest: contentDigest(planned.guide.content) } : {}),
      },
      timestamp: new Date().toISOString(),
      outcome,
      errorCode,
      errorMessage: message,
      results: [],
      aborted: true,
      abortReason: 'PROVISIONING_FAILED',
      abortMessage: message,
    };
    applyPackageMeta(resultsData, meta);
    return {
      guide: planned.guide.path,
      id: planned.id,
      status: 'provisioning_failed',
      exitCode: ExitCode.TEST_FAILURE,
      autoIncluded: planned.autoIncluded,
      abortMessage: message,
      tier: meta?.tier,
      sideEffects: meta?.sideEffects,
      resultsData,
    };
  });
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
      sideEffects: r.sideEffects,
    }));
}

export function exitCodeFromResults(results: GuideRunResult[], reportSchemaValid = true): number {
  if (!reportSchemaValid) {
    return ExitCode.CONFIGURATION_ERROR;
  }
  if (results.some((r) => r.status === 'auth_expired')) {
    return ExitCode.AUTH_FAILURE;
  }
  if (results.some((r) => FAILURE_STATUSES.has(r.status))) {
    return ExitCode.TEST_FAILURE;
  }
  return ExitCode.SUCCESS;
}

/**
 * Count guides by terminal status. Every status in the vocabulary is
 * represented (initialized to zero) so callers can index any status safely.
 */
export function countGuideStatuses(results: GuideRunResult[]): Record<GuideStatus, number> {
  const counts = Object.fromEntries(GUIDE_STATUS_LABELS.map(([status]) => [status, 0])) as Record<GuideStatus, number>;
  for (const result of results) {
    counts[result.status] += 1;
  }
  return counts;
}

/** Short parenthetical reason for a guide's per-line listing, if any. */
export function guideResultReason(result: GuideRunResult): string {
  if (result.status === 'skipped_prereq' && result.failedPrerequisite) {
    return ` (prerequisite "${result.failedPrerequisite}" failed)`;
  }
  if (result.status === 'auth_expired') {
    return ' (auth expired)';
  }
  if (result.abortMessage && result.status !== 'passed' && result.status !== 'failed') {
    return ` (${result.abortMessage})`;
  }
  return '';
}

/** Aggregate step counts across guides, for the run summary. */
export interface StepSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  notReached: number;
}

/** Tally step statuses across every guide's results in a single pass. */
export function summarizeSteps(resultsData: TestResultsData[]): StepSummary {
  const summary: StepSummary = { total: 0, passed: 0, failed: 0, skipped: 0, notReached: 0 };
  for (const data of resultsData) {
    for (const step of data.results) {
      summary.total += 1;
      switch (step.status) {
        case 'passed':
          summary.passed += 1;
          break;
        case 'failed':
          summary.failed += 1;
          break;
        case 'skipped':
          summary.skipped += 1;
          break;
        case 'not_reached':
          summary.notReached += 1;
          break;
      }
    }
  }
  return summary;
}
