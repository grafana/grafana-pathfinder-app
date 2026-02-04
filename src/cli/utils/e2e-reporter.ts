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
