/**
 * E2E Test JSON Reporter
 *
 * Generates structured JSON reports for E2E test results per design spec.
 * Enables CI integration and programmatic test result analysis.
 *
 * @see tests/e2e-runner/design/e2e-test-runner-design.md#json-output
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// ============================================
// Types - JSON Report Structure
// ============================================

/**
 * Guide metadata in the JSON report.
 */
export interface GuideMetadata {
  /** Guide identifier (extracted from filename or guide ID) */
  id: string;
  /** Human-readable guide title */
  title: string;
  /** Path to the guide file (relative or absolute) */
  path: string;
}

/**
 * Test execution configuration captured in the report.
 */
export interface ReportConfig {
  /** URL of the Grafana instance tested against */
  grafanaUrl: string;
  /** Grafana version (if available) */
  grafanaVersion?: string;
  /** ISO timestamp of when the test started */
  timestamp: string;
}

/**
 * Summary statistics for the test run.
 */
export interface ReportSummary {
  /** Total number of steps */
  total: number;
  /** Number of passed steps */
  passed: number;
  /** Number of failed steps */
  failed: number;
  /** Number of skipped steps */
  skipped: number;
  /** Number of steps not reached (due to abort) */
  notReached: number;
  /** Total test duration in milliseconds */
  duration: number;
  /** Number of mandatory step failures (L3-4C) */
  mandatoryFailed: number;
  /** Number of skippable step failures (L3-4C) */
  skippableFailed: number;
}

/**
 * Error classification for failure triage (L3-5C).
 *
 * Per design doc MVP approach:
 * - Only `infrastructure` can be reliably auto-classified
 * - All other failures default to `unknown` and require human triage
 */
export type ErrorClassification =
  | 'content-drift' // Selector/requirement issues (requires human validation)
  | 'product-regression' // Action failures (requires human validation)
  | 'infrastructure' // TIMEOUT, NETWORK_ERROR, AUTH_EXPIRED
  | 'unknown'; // Default - cannot be reliably classified

/**
 * Paths to captured failure artifacts (L3-5D).
 *
 * Artifacts are captured when a step fails to provide debugging context.
 */
export interface ArtifactPaths {
  /** Path to screenshot PNG file */
  screenshot?: string;
  /** Path to DOM snapshot HTML file */
  dom?: string;
  /** Path to console errors JSON file */
  console?: string;
}

/**
 * Step result in the JSON report.
 *
 * Per design doc, each step includes:
 * - stepId, index, status, duration, currentUrl, consoleErrors
 * - Optional: skipReason, error, classification, artifacts
 */
export interface ReportStepResult {
  /** The step identifier */
  stepId: string;
  /** Zero-based index in execution order */
  index: number;
  /** Execution outcome */
  status: 'passed' | 'failed' | 'skipped' | 'not_reached';
  /** Execution duration in milliseconds */
  duration: number;
  /** Page URL when step completed/failed */
  currentUrl: string;
  /** Console errors captured during step execution */
  consoleErrors: string[];
  /** Reason if status is 'skipped' */
  skipReason?: string;
  /** Error message if status is 'failed' */
  error?: string;
  /** Whether the step was skippable (L3-4C) */
  skippable?: boolean;
  /**
   * Error classification for failure triage (L3-5C).
   * Only present for failed or not_reached steps.
   * Per MVP: only `infrastructure` is auto-classified, others default to `unknown`.
   */
  classification?: ErrorClassification;
  /**
   * Paths to failure artifacts (L3-5D).
   * Only present for failed steps when artifacts were captured.
   * Contains screenshot, DOM snapshot, and console errors file paths.
   */
  artifacts?: ArtifactPaths;
}

/**
 * Complete JSON report structure per design doc.
 *
 * @see tests/e2e-runner/design/e2e-test-runner-design.md#json-output
 */
export interface E2ETestReport {
  /** Guide metadata */
  guide: GuideMetadata;
  /** Test configuration */
  config: ReportConfig;
  /** Summary statistics */
  summary: ReportSummary;
  /** Individual step results */
  steps: ReportStepResult[];
  /** Whether test was aborted (L3-3D) */
  aborted?: boolean;
  /** Reason for abort if aborted is true */
  abortReason?: 'AUTH_EXPIRED' | 'MANDATORY_FAILURE';
  /** Human-readable abort message */
  abortMessage?: string;
}

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
  /** Guide metadata */
  guide: {
    id: string;
    title: string;
    path: string;
  };
  /** Grafana URL used for testing */
  grafanaUrl: string;
  /** ISO timestamp when test started */
  timestamp: string;
  /** Individual step results */
  results: TestStepResult[];
  /** Whether execution was aborted */
  aborted: boolean;
  /** Reason for abort if aborted */
  abortReason?: 'AUTH_EXPIRED' | 'MANDATORY_FAILURE';
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

  const report: E2ETestReport = {
    guide: data.guide,
    config: {
      grafanaUrl: data.grafanaUrl,
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

/**
 * Write a JSON report to a file.
 *
 * Creates parent directories if they don't exist.
 *
 * @param report - The report to write
 * @param outputPath - Path to write the report to
 */
export function writeReport(report: E2ETestReport, outputPath: string): void {
  // Ensure parent directory exists
  const dir = dirname(outputPath);
  if (dir !== '.') {
    mkdirSync(dir, { recursive: true });
  }

  // Write JSON with pretty formatting
  const json = JSON.stringify(report, null, 2);
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
 * Per L3-4C design doc: only mandatory failures count against success.
 * Skippable step failures do NOT fail the overall test.
 *
 * @param report - The test report
 * @returns true if the test passed (no mandatory failures)
 */
export function isReportSuccess(report: E2ETestReport): boolean {
  return report.summary.mandatoryFailed === 0;
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
// Multi-Guide Report Types (L3-7B)
// ============================================

/**
 * Summary statistics for a multi-guide test run (L3-7B).
 */
export interface MultiGuideSummary {
  /** Total number of guides tested */
  totalGuides: number;
  /** Number of guides that passed (no mandatory failures) */
  passedGuides: number;
  /** Number of guides that failed (at least one mandatory failure) */
  failedGuides: number;
  /** Number of guides where auth expired during testing */
  authExpiredGuides: number;
  /** Aggregated step counts across all guides */
  steps: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    notReached: number;
    mandatoryFailed: number;
    skippableFailed: number;
  };
  /** Total test duration across all guides in milliseconds */
  totalDuration: number;
}

/**
 * Individual guide result in the multi-guide report (L3-7B).
 */
export interface GuideResult {
  /** Guide identifier */
  id: string;
  /** Guide title */
  title: string;
  /** Path to the guide file */
  path: string;
  /** Whether this guide passed (no mandatory failures) */
  success: boolean;
  /** Reason for failure/abort if any */
  abortReason?: 'AUTH_EXPIRED' | 'MANDATORY_FAILURE';
  /** Summary statistics for this guide */
  summary: ReportSummary;
  /** Duration in milliseconds */
  duration: number;
}

/**
 * Complete multi-guide E2E test report (L3-7B).
 *
 * This report aggregates results from multiple guides tested with --bundled
 * or when multiple guide paths are provided.
 */
export interface MultiGuideReport {
  /** Report type identifier */
  type: 'multi-guide';
  /** Test configuration */
  config: ReportConfig;
  /** Aggregated summary across all guides */
  summary: MultiGuideSummary;
  /** Individual guide results (condensed, without step details) */
  guides: GuideResult[];
  /** Full reports for each guide (includes step details) */
  reports: E2ETestReport[];
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
  const passedGuides = reports.filter((r) => isReportSuccess(r)).length;
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
    success: isReportSuccess(report),
    summary: report.summary,
    duration: report.summary.duration,
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
 * @param grafanaUrl - Grafana URL used for testing
 * @param grafanaVersion - Optional Grafana version
 * @returns Complete multi-guide report
 */
export function generateMultiGuideReport(
  resultsArray: TestResultsData[],
  grafanaUrl: string,
  grafanaVersion?: string
): MultiGuideReport {
  // Generate individual reports
  const reports = resultsArray.map((data) => generateReport(data, grafanaVersion));

  // Generate aggregated summary
  const summary = generateMultiGuideSummary(reports);

  // Create condensed guide results
  const guides = reports.map(toGuideResult);

  const config: ReportConfig = {
    grafanaUrl,
    timestamp: new Date().toISOString(),
  };

  if (grafanaVersion) {
    config.grafanaVersion = grafanaVersion;
  }

  return {
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
  // Reuse writeReport's directory creation logic
  const dir = dirname(outputPath);
  if (dir !== '.') {
    mkdirSync(dir, { recursive: true });
  }

  const json = JSON.stringify(report, null, 2);
  writeFileSync(outputPath, json, 'utf-8');
}

/**
 * Check if a multi-guide report indicates overall success (L3-7B).
 *
 * Per L3-4C design doc: only mandatory failures count against success.
 *
 * @param report - The multi-guide report
 * @returns true if all guides passed (no mandatory failures in any guide)
 */
export function isMultiGuideReportSuccess(report: MultiGuideReport): boolean {
  return report.summary.steps.mandatoryFailed === 0;
}

/**
 * Format a brief summary line from a multi-guide report (L3-7B).
 *
 * @param report - The multi-guide report
 * @returns Summary string like "3/5 guides passed, 47 steps (42 passed, 3 failed, 2 skipped)"
 */
export function formatMultiGuideSummary(report: MultiGuideReport): string {
  const { summary } = report;
  const guideStatus = `${summary.passedGuides}/${summary.totalGuides} guides passed`;

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
