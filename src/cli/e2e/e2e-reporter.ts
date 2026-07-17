/**
 * E2E Test JSON Reporter
 *
 * Generates structured JSON reports for E2E test results per design spec.
 * Enables CI integration and programmatic test result analysis.
 *
 * @see docs/developer/E2E_TESTING.md#json-report
 */

import { createHash } from 'crypto';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { z } from 'zod';

import { ExitCode } from './exit-codes';

export {
  E2E_REPORT_SCHEMA_VERSION,
  E2EExecutionOutcomeSchema,
  E2EErrorCodeSchema,
  E2ETestReportSchema,
  MultiGuideReportSchema,
} from './schemas/e2e-report.schema';

export type {
  E2EExecutionOutcome,
  E2EErrorCode,
  ErrorClassification,
  RunnerProvenance,
  ReportTarget,
  ReportSummary,
  ArtifactPaths,
  ReportStepResult,
  GuideMetadata,
  ReportConfig,
  PreRunSkip,
  E2ETestReport,
  GuideResult,
  MultiGuideSummary,
  MultiGuideReport,
} from './schemas/e2e-report.schema';

import {
  E2E_REPORT_SCHEMA_VERSION,
  E2ETestReportSchema,
  MultiGuideReportSchema,
  type E2EExecutionOutcome,
  type E2EErrorCode,
  type ErrorClassification,
  type RunnerProvenance,
  type ReportSummary,
  type ArtifactPaths,
  type ReportStepResult,
  type GuideMetadata,
  type ReportConfig,
  type E2ETestReport,
  type GuideResult,
  type MultiGuideSummary,
  type MultiGuideReport,
} from './schemas/e2e-report.schema';

// ============================================
// Types - Input from Test Execution
// ============================================

/**
 * Step result from the test runner (input type).
 * This matches the StepTestResult interface from guide-test-runner.ts.
 */
export interface TestStepResult {
  stepId: string;
  status: 'passed' | 'failed' | 'skipped' | 'not_reached';
  durationMs: number;
  currentUrl: string;
  consoleErrors: string[];
  error?: string;
  skipReason?: string;
  skippable: boolean;
  /** Error classification for failure triage (L3-5C) */
  classification?: ErrorClassification;
  /** Paths to failure artifacts (L3-5D) */
  artifacts?: ArtifactPaths;
}

/**
 * Input data for generating a report.
 * This is what the test writes to the results file.
 */
export interface TestResultsData {
  /** Guide metadata  */
  guide: GuideMetadata;
  /** ISO timestamp when test started */
  timestamp: string;
  startedAt?: string;
  endedAt?: string;
  outcome?: E2EExecutionOutcome;
  errorCode?: E2EErrorCode;
  errorMessage?: string;
  runner?: Partial<RunnerProvenance>;
  /** Individual step results */
  results: TestStepResult[];
  /** Whether execution was aborted */
  aborted: boolean;
  /** Reason for abort if aborted */
  abortReason?: 'AUTH_EXPIRED' | 'MANDATORY_FAILURE' | 'SKIPPED_PREREQ' | 'PROVISIONING_FAILED';
  /** Abort message */
  abortMessage?: string;
}

// ============================================
// Report Generation Functions
// ============================================

/**
 * Generate the summary statistics from step results.
 *
 * @param results - Array of step results
 * @returns Summary statistics
 */
export function generateSummary(results: TestStepResult[]): ReportSummary {
  const failedResults = results.filter((r) => r.status === 'failed');

  return {
    total: results.length,
    passed: results.filter((r) => r.status === 'passed').length,
    failed: failedResults.length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    notReached: results.filter((r) => r.status === 'not_reached').length,
    duration: results.reduce((sum, r) => sum + r.durationMs, 0),
    mandatoryFailed: failedResults.filter((r) => !r.skippable).length,
    skippableFailed: failedResults.filter((r) => r.skippable).length,
  };
}

/**
 * Convert test step results to report step results.
 *
 * Transforms from internal format (durationMs) to report format (duration).
 *
 * @param results - Array of test step results
 * @returns Array of report step results
 */
export function convertStepResults(results: TestStepResult[]): ReportStepResult[] {
  return results.map((result, index) => {
    const reportStep: ReportStepResult = {
      stepId: result.stepId,
      index,
      status: result.status,
      duration: result.durationMs,
      currentUrl: result.currentUrl,
      consoleErrors: result.consoleErrors,
    };

    // Add optional fields only if present
    if (result.skipReason) {
      reportStep.skipReason = result.skipReason;
    }

    if (result.error) {
      reportStep.error = result.error;
    }

    // Include skippable flag for failed steps (useful for understanding why test passed/failed)
    if (result.status === 'failed') {
      reportStep.skippable = result.skippable;
    }

    // L3-5C: Include classification for failed or not_reached steps
    if ((result.status === 'failed' || result.status === 'not_reached') && result.classification) {
      reportStep.classification = result.classification;
    }

    // L3-5D: Include artifact paths for failed steps
    if (result.status === 'failed' && result.artifacts) {
      reportStep.artifacts = result.artifacts;
    }

    return reportStep;
  });
}

/**
 * Generate a complete E2E test report from test results data.
 *
 * @param data - Test results data from test execution
 * @param grafanaVersion - Optional Grafana version string
 * @returns Complete E2E test report
 */
export function generateReport(data: TestResultsData, grafanaVersion?: string): E2ETestReport {
  const summary = generateSummary(data.results);
  const steps = convertStepResults(data.results);
  const startedAt = data.startedAt ?? data.timestamp;
  const endedAt = data.endedAt ?? data.timestamp;
  const outcome =
    data.outcome ??
    (data.abortReason === 'SKIPPED_PREREQ'
      ? 'skipped'
      : data.abortReason
        ? 'aborted'
        : summary.mandatoryFailed > 0
          ? 'failed'
          : 'passed');
  const errorCode =
    data.errorCode ??
    (data.abortReason as E2EErrorCode | undefined) ??
    (outcome === 'failed' ? 'MANDATORY_FAILURE' : undefined);
  const targetUrl = data.guide.targetUrl ?? 'unknown://target';

  const report: E2ETestReport = {
    schemaVersion: E2E_REPORT_SCHEMA_VERSION,
    outcome,
    ...(errorCode ? { errorCode } : {}),
    ...((data.errorMessage ?? data.abortMessage) ? { errorMessage: data.errorMessage ?? data.abortMessage } : {}),
    runner: {
      name: 'pathfinder-e2e-runner',
      version: process.env.PATHFINDER_E2E_RUNNER_VERSION ?? 'source',
      nodeVersion: process.version,
      playwrightVersion: process.env.PLAYWRIGHT_VERSION ?? 'unknown',
      ...(process.env.PATHFINDER_E2E_RUNNER_IMAGE ? { image: process.env.PATHFINDER_E2E_RUNNER_IMAGE } : {}),
      ...data.runner,
    },
    startedAt,
    endedAt,
    target: {
      url: targetUrl,
      ...(data.guide.tier ? { tier: data.guide.tier } : {}),
      ...(data.guide.instance ? { instance: data.guide.instance } : {}),
    },
    guide: data.guide,
    config: {
      timestamp: data.timestamp,
    },
    summary,
    steps,
  };

  // Add optional config fields
  if (grafanaVersion) {
    report.config.grafanaVersion = grafanaVersion;
  }

  // Add abort info if present
  if (data.aborted) {
    report.aborted = true;
    if (data.abortReason) {
      report.abortReason = data.abortReason;
    }
    if (data.abortMessage) {
      report.abortMessage = data.abortMessage;
    }
  }

  return report;
}

export function contentDigest(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

export function createMinimalResultsData(input: {
  guide: GuideMetadata;
  outcome: E2EExecutionOutcome;
  errorCode: E2EErrorCode;
  errorMessage: string;
  startedAt?: string;
  endedAt?: string;
}): TestResultsData {
  const startedAt = input.startedAt ?? new Date().toISOString();
  const endedAt = input.endedAt ?? new Date().toISOString();
  return {
    guide: input.guide,
    timestamp: startedAt,
    startedAt,
    endedAt,
    outcome: input.outcome,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    results: [],
    aborted: input.outcome !== 'passed',
    ...(input.errorCode === 'SKIPPED_PREREQ' ? { abortReason: 'SKIPPED_PREREQ' as const } : {}),
    abortMessage: input.errorMessage,
  };
}

/**
 * Self-validate a report against its own schema before writing.
 *
 * The error boundary's core promise is that the CLI always produces a report,
 * so a validation failure must never prevent the write. On success we return the
 * normalized value (unknown keys stripped, so emitted output always conforms);
 * on failure we warn and write the original object. Set
 * PATHFINDER_E2E_STRICT_SCHEMA=1 to also flip the exit code.
 */
function conform<T>(schema: z.ZodType<T>, report: T, kind: string): T {
  const result = schema.safeParse(report);
  if (result.success) {
    return result.data;
  }
  console.error(`⚠️  ${kind} failed self-validation against its schema:`);
  console.error(z.prettifyError(result.error));
  if (process.env.PATHFINDER_E2E_STRICT_SCHEMA === '1') {
    process.exitCode = ExitCode.CONFIGURATION_ERROR;
  }
  return report;
}

/**
 * Write a JSON report to a file.
 *
 * Creates parent directories if they don't exist.
 *
 * @param report - The report to write
 * @param outputPath - Path to write the report to
 */
export function writeReport(report: E2ETestReport, outputPath: string): void {
  const conformed = conform(E2ETestReportSchema, report, 'E2E report');

  // Ensure parent directory exists
  const dir = dirname(outputPath);
  if (dir !== '.') {
    mkdirSync(dir, { recursive: true });
  }

  // Write JSON with pretty formatting
  const json = JSON.stringify(conformed, null, 2);
  writeFileSync(outputPath, json, 'utf-8');
}

/**
 * Generate and write a complete E2E test report.
 *
 * Convenience function that combines generateReport and writeReport.
 *
 * @param data - Test results data
 * @param outputPath - Path to write the report to
 * @param grafanaVersion - Optional Grafana version
 * @returns The generated report
 */
export function generateAndWriteReport(
  data: TestResultsData,
  outputPath: string,
  grafanaVersion?: string
): E2ETestReport {
  const report = generateReport(data, grafanaVersion);
  writeReport(report, outputPath);
  return report;
}

/**
 * Check if a report indicates overall success.
 *
 * Report-level failures without step data also count against success.
 * Skippable step failures do NOT fail the overall test.
 *
 * @param report - The test report
 * @returns true if the test passed without mandatory or provisioning failures
 */
export function isReportSuccess(report: E2ETestReport): boolean {
  return report.summary.mandatoryFailed === 0 && report.abortReason !== 'PROVISIONING_FAILED';
}

/**
 * Format a brief summary line from a report.
 *
 * @param report - The test report
 * @returns Summary string like "5 passed, 1 failed, 2 skipped"
 */
export function formatReportSummary(report: E2ETestReport): string {
  const parts: string[] = [];
  parts.push(`${report.summary.passed} passed`);

  if (report.summary.failed > 0) {
    parts.push(`${report.summary.failed} failed`);
  }

  if (report.summary.skipped > 0) {
    parts.push(`${report.summary.skipped} skipped`);
  }

  if (report.summary.notReached > 0) {
    parts.push(`${report.summary.notReached} not reached`);
  }

  return parts.join(', ');
}

// ============================================
// Multi-Guide Report Generation (L3-7B)
// ============================================

/**
 * Generate aggregated summary from multiple guide reports (L3-7B).
 *
 * @param reports - Array of individual guide reports
 * @returns Aggregated summary statistics
 */
export function generateMultiGuideSummary(reports: E2ETestReport[]): MultiGuideSummary {
  const skippedGuides = reports.filter((r) => r.abortReason === 'SKIPPED_PREREQ').length;
  const passedGuides = reports.filter((r) => isReportSuccess(r) && r.abortReason !== 'SKIPPED_PREREQ').length;
  const failedGuides = reports.filter((r) => !isReportSuccess(r) && r.abortReason !== 'AUTH_EXPIRED').length;
  const authExpiredGuides = reports.filter((r) => r.abortReason === 'AUTH_EXPIRED').length;

  // Aggregate step counts
  const steps = reports.reduce(
    (acc, report) => ({
      total: acc.total + report.summary.total,
      passed: acc.passed + report.summary.passed,
      failed: acc.failed + report.summary.failed,
      skipped: acc.skipped + report.summary.skipped,
      notReached: acc.notReached + report.summary.notReached,
      mandatoryFailed: acc.mandatoryFailed + report.summary.mandatoryFailed,
      skippableFailed: acc.skippableFailed + report.summary.skippableFailed,
    }),
    {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      notReached: 0,
      mandatoryFailed: 0,
      skippableFailed: 0,
    }
  );

  const totalDuration = reports.reduce((sum, r) => sum + r.summary.duration, 0);

  return {
    totalGuides: reports.length,
    passedGuides,
    failedGuides,
    authExpiredGuides,
    skippedGuides,
    steps,
    totalDuration,
  };
}

/**
 * Convert a single guide report to a condensed guide result (L3-7B).
 *
 * @param report - Full guide report
 * @returns Condensed guide result without step details
 */
export function toGuideResult(report: E2ETestReport): GuideResult {
  const result: GuideResult = {
    id: report.guide.id,
    title: report.guide.title,
    path: report.guide.path,
    success: isReportSuccess(report) && report.abortReason !== 'SKIPPED_PREREQ',
    summary: report.summary,
    duration: report.summary.duration,
    sideEffects: report.guide.sideEffects,
  };

  if (report.abortReason) {
    result.abortReason = report.abortReason;
  }

  return result;
}

/**
 * Generate a multi-guide report from individual test results (L3-7B).
 *
 * @param resultsArray - Array of test results data from each guide
 * @param grafanaVersion - Optional Grafana version
 * @returns Complete multi-guide report
 */
export function generateMultiGuideReport(resultsArray: TestResultsData[], grafanaVersion?: string): MultiGuideReport {
  // Generate individual reports
  const reports = resultsArray.map((data) => generateReport(data, grafanaVersion));

  // Generate aggregated summary
  const summary = generateMultiGuideSummary(reports);

  // Create condensed guide results
  const guides = reports.map(toGuideResult);

  const config: ReportConfig = {
    timestamp: new Date().toISOString(),
  };
  const startedAt = resultsArray.map((result) => result.startedAt ?? result.timestamp).sort()[0] ?? config.timestamp;
  const endedAt =
    resultsArray
      .map((result) => result.endedAt ?? result.timestamp)
      .sort()
      .slice(-1)[0] ?? config.timestamp;
  const reportOutcomes = new Set<E2EExecutionOutcome>(
    reports.map(({ outcome }) => (outcome === 'aborted' ? 'failed' : outcome))
  );
  const outcomePriority: E2EExecutionOutcome[] = [
    'infrastructure_error',
    'configuration_error',
    'failed',
    'skipped',
    'passed',
  ];
  const outcome = outcomePriority.find((candidate) => reportOutcomes.has(candidate)) ?? 'passed';

  if (grafanaVersion) {
    config.grafanaVersion = grafanaVersion;
  }

  return {
    schemaVersion: E2E_REPORT_SCHEMA_VERSION,
    outcome,
    runner: reports[0]?.runner ?? {
      name: 'pathfinder-e2e-runner',
      version: process.env.PATHFINDER_E2E_RUNNER_VERSION ?? 'source',
      nodeVersion: process.version,
      playwrightVersion: process.env.PLAYWRIGHT_VERSION ?? 'unknown',
    },
    startedAt,
    endedAt,
    type: 'multi-guide',
    config,
    summary,
    guides,
    reports,
  };
}

/**
 * Write a multi-guide report to a file (L3-7B).
 *
 * @param report - The multi-guide report to write
 * @param outputPath - Path to write the report to
 */
export function writeMultiGuideReport(report: MultiGuideReport, outputPath: string): void {
  const conformed = conform(MultiGuideReportSchema, report, 'Multi-guide report');

  // Reuse writeReport's directory creation logic
  const dir = dirname(outputPath);
  if (dir !== '.') {
    mkdirSync(dir, { recursive: true });
  }

  const json = JSON.stringify(conformed, null, 2);
  writeFileSync(outputPath, json, 'utf-8');
}

/**
 * Check if a multi-guide report indicates overall success (L3-7B).
 *
 * Uses the aggregated guide outcomes so setup failures without step data count.
 *
 * @param report - The multi-guide report
 * @returns true if all guides passed without auth or provisioning failures
 */
export function isMultiGuideReportSuccess(report: MultiGuideReport): boolean {
  return report.summary.failedGuides === 0 && report.summary.authExpiredGuides === 0;
}

/**
 * Format a brief summary line from a multi-guide report (L3-7B).
 *
 * @param report - The multi-guide report
 * @returns Summary string like "3/5 guides passed, 47 steps (42 passed, 3 failed, 2 skipped)"
 */
export function formatMultiGuideSummary(report: MultiGuideReport): string {
  const { summary } = report;
  let guideStatus = `${summary.passedGuides}/${summary.totalGuides} guides passed`;
  if (summary.skippedGuides > 0) {
    guideStatus += `, ${summary.skippedGuides} skipped`;
  }

  const stepParts: string[] = [`${summary.steps.passed} passed`];
  if (summary.steps.failed > 0) {
    stepParts.push(`${summary.steps.failed} failed`);
  }
  if (summary.steps.skipped > 0) {
    stepParts.push(`${summary.steps.skipped} skipped`);
  }
  if (summary.steps.notReached > 0) {
    stepParts.push(`${summary.steps.notReached} not reached`);
  }

  const stepStatus = `${summary.steps.total} steps (${stepParts.join(', ')})`;

  return `${guideStatus}, ${stepStatus}`;
}
