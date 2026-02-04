/**
 * Console Reporter for E2E Test Runner
 *
 * Provides formatted console output for E2E test execution per design spec.
 * Outputs step-by-step progress with clear visual indicators and timing.
 *
 * @see tests/e2e-runner/design/e2e-test-runner-design.md#console-output
 */

import { StepTestResult, AllStepsResult, summarizeResults } from './guide-test-runner';

// ============================================
// Constants
// ============================================

/** Width of the output box/line in characters */
const BOX_WIDTH = 68;

/** Status icons per design spec */
const STATUS_ICONS = {
  passed: '✓',
  failed: '✗',
  skipped: '⊘',
  not_reached: '○',
} as const;

// ============================================
// Box Drawing Functions
// ============================================

/**
 * Print the header box with guide title.
 *
 * Format:
 * ```
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  E2E Test: Welcome to Grafana                                    ║
 * ╚══════════════════════════════════════════════════════════════════╝
 * ```
 *
 * @param guideTitle - The title of the guide being tested
 */
export function printHeader(guideTitle: string): void {
  const title = `E2E Test: ${guideTitle}`;
  // Truncate title if too long (leave space for padding and borders)
  const maxTitleLength = BOX_WIDTH - 6; // 2 border chars + 4 padding
  const displayTitle = title.length > maxTitleLength ? title.substring(0, maxTitleLength - 3) + '...' : title;

  const padding = BOX_WIDTH - 4 - displayTitle.length; // 4 = 2 border + 2 space padding
  const paddedTitle = `  ${displayTitle}${' '.repeat(Math.max(0, padding))}`;

  console.log(`╔${'═'.repeat(BOX_WIDTH - 2)}╗`);
  console.log(`║${paddedTitle}║`);
  console.log(`╚${'═'.repeat(BOX_WIDTH - 2)}╝`);
  console.log(); // Empty line after header
}

/**
 * Print a horizontal separator line.
 *
 * Format:
 * ```
 * ────────────────────────────────────────────────────────────────────
 * ```
 */
export function printSeparator(): void {
  console.log('─'.repeat(BOX_WIDTH));
}

// ============================================
// Step Output Functions
// ============================================

/**
 * Format duration as human-readable string.
 *
 * @param durationMs - Duration in milliseconds
 * @returns Formatted string like "[1.2s]" or "[123ms]"
 */
function formatDuration(durationMs: number): string {
  if (durationMs >= 1000) {
    return `[${(durationMs / 1000).toFixed(1)}s]`;
  }
  return `[${Math.round(durationMs)}ms]`;
}

/**
 * Print a single step result with right-aligned duration.
 *
 * Format:
 * ```
 *   ✓ step-1                                                  [1.2s]
 *   ⊘ step-4 - SKIPPED                                        [0.1s]
 *     Reason: is-admin requirement not met (skippable step)
 * ```
 *
 * @param result - The step test result
 */
export function printStepResult(result: StepTestResult): void {
  const icon = STATUS_ICONS[result.status];
  const duration = formatDuration(result.durationMs);

  // Build the step line
  let stepText = result.stepId;

  // Add status suffix for non-passed steps
  if (result.status === 'skipped') {
    stepText += ' - SKIPPED';
  } else if (result.status === 'failed') {
    stepText += ' - FAILED';
  } else if (result.status === 'not_reached') {
    stepText += ' - NOT REACHED';
  }

  // Calculate padding for right-aligned duration
  // Format: "  {icon} {stepText}                          {duration}"
  const prefix = `  ${icon} `;
  const contentWidth = BOX_WIDTH - prefix.length - duration.length;
  const paddedStepText =
    stepText.length > contentWidth
      ? stepText.substring(0, contentWidth - 3) + '...'
      : stepText + ' '.repeat(Math.max(0, contentWidth - stepText.length));

  console.log(`${prefix}${paddedStepText}${duration}`);

  // Print skip reason on separate line if skipped
  if (result.status === 'skipped' && result.skipReason) {
    const reasonText = formatSkipReason(result.skipReason, result.skippable);
    console.log(`    Reason: ${reasonText}`);
  }

  // Print error message on separate line if failed
  if (result.status === 'failed' && result.error) {
    // Truncate very long error messages
    const maxErrorLength = BOX_WIDTH - 12; // Leave space for "    Error: "
    const errorText =
      result.error.length > maxErrorLength ? result.error.substring(0, maxErrorLength - 3) + '...' : result.error;
    console.log(`    Error: ${errorText}`);
  }
}

/**
 * Format skip reason as human-readable text.
 *
 * @param skipReason - The skip reason code
 * @param skippable - Whether the step was skippable
 * @returns Human-readable skip reason
 */
function formatSkipReason(skipReason: string, skippable: boolean): string {
  const skippableNote = skippable ? ' (skippable step)' : '';

  switch (skipReason) {
    case 'pre_completed':
      return `already completed before execution${skippableNote}`;
    case 'no_do_it_button':
      return `step has no "Do it" button${skippableNote}`;
    case 'requirements_unmet':
      return `requirements not met${skippableNote}`;
    default:
      return `${skipReason}${skippableNote}`;
  }
}

// ============================================
// Summary Output Functions
// ============================================

/**
 * Print the execution summary.
 *
 * Format:
 * ```
 * ────────────────────────────────────────────────────────────────────
 * Summary: 4 passed, 0 failed, 1 skipped                    [3.7s]
 * ────────────────────────────────────────────────────────────────────
 * ```
 *
 * @param results - Array of step test results
 */
export function printSummary(results: StepTestResult[]): void {
  const summary = summarizeResults(results);
  const duration = formatDuration(summary.totalDurationMs);

  // Build summary text parts
  const parts: string[] = [];
  parts.push(`${summary.passed} passed`);

  if (summary.failed > 0) {
    parts.push(`${summary.failed} failed`);
  } else {
    parts.push('0 failed');
  }

  if (summary.skipped > 0) {
    parts.push(`${summary.skipped} skipped`);
  }

  if (summary.notReached > 0) {
    parts.push(`${summary.notReached} not reached`);
  }

  const summaryText = `Summary: ${parts.join(', ')}`;

  // Calculate padding for right-aligned duration
  const contentWidth = BOX_WIDTH - duration.length;
  const paddedSummary =
    summaryText.length > contentWidth
      ? summaryText.substring(0, contentWidth - 3) + '...'
      : summaryText + ' '.repeat(Math.max(0, contentWidth - summaryText.length));

  console.log();
  printSeparator();
  console.log(`${paddedSummary}${duration}`);
  printSeparator();
}

/**
 * Print the full execution summary with additional details for verbose mode.
 *
 * Shows breakdown of mandatory vs skippable failures when relevant.
 *
 * @param results - Array of step test results
 * @param allStepsResult - Full result including abort info
 * @param verbose - Whether to show verbose output
 */
export function printDetailedSummary(
  results: StepTestResult[],
  allStepsResult: AllStepsResult,
  verbose: boolean = false
): void {
  const summary = summarizeResults(results);

  // Print basic summary
  printSummary(results);

  // In verbose mode, show additional details
  if (verbose) {
    console.log();

    // Show failure breakdown if there are failures
    if (summary.failed > 0) {
      console.log(`Failure breakdown:`);
      if (summary.mandatoryFailed > 0) {
        console.log(`  └─ Mandatory failures: ${summary.mandatoryFailed} (affects overall result)`);
      }
      if (summary.skippableFailed > 0) {
        console.log(`  └─ Skippable failures: ${summary.skippableFailed} (does not affect overall result)`);
      }
    }

    // Show abort info if test was aborted
    if (allStepsResult.aborted) {
      console.log();
      console.log(`Test aborted: ${allStepsResult.abortReason}`);
      if (allStepsResult.abortMessage) {
        console.log(`  ${allStepsResult.abortMessage}`);
      }
    }

    // Show overall result
    console.log();
    console.log(`Overall: ${summary.success ? '✅ SUCCESS' : '❌ FAILURE'}`);
  }
}

// ============================================
// Real-time Progress Functions
// ============================================

/**
 * Callback type for real-time step progress reporting.
 * This is called after each step completes.
 */
export type StepProgressCallback = (result: StepTestResult, stepIndex: number, totalSteps: number) => void;

/**
 * Create a step progress callback that prints results in real-time.
 *
 * @returns StepProgressCallback that prints each step as it completes
 */
export function createProgressCallback(): StepProgressCallback {
  return (result: StepTestResult): void => {
    printStepResult(result);
  };
}

// ============================================
// Complete Report Functions
// ============================================

/**
 * Print a complete test report for a guide.
 *
 * This is the main entry point for console reporting after test execution.
 * Prints all step results and summary in the spec format.
 *
 * @param guideTitle - The title of the guide
 * @param allStepsResult - The complete execution result
 * @param verbose - Whether to show verbose output
 */
export function printReport(guideTitle: string, allStepsResult: AllStepsResult, verbose: boolean = false): void {
  printHeader(guideTitle);

  // Print all step results
  for (const result of allStepsResult.results) {
    printStepResult(result);
  }

  // Print summary
  printDetailedSummary(allStepsResult.results, allStepsResult, verbose);
}

/**
 * Print report from an array of step results (without abort info).
 *
 * Convenience function when AllStepsResult is not available.
 *
 * @param guideTitle - The title of the guide
 * @param results - Array of step test results
 * @param verbose - Whether to show verbose output
 */
export function printReportFromResults(guideTitle: string, results: StepTestResult[], verbose: boolean = false): void {
  const allStepsResult: AllStepsResult = {
    results,
    aborted: false,
  };
  printReport(guideTitle, allStepsResult, verbose);
}

// ============================================
// Pre-flight Output Functions
// ============================================

/**
 * Print pre-flight check results in a consistent format.
 *
 * @param checks - Array of check results with name, passed, and optional duration
 */
export function printPreflightChecks(
  checks: Array<{ name: string; passed: boolean; durationMs?: number }>
): void {
  console.log('🔍 Pre-flight checks:');
  for (const check of checks) {
    const icon = check.passed ? '✓' : '✗';
    const duration = check.durationMs !== undefined ? ` ${formatDuration(check.durationMs)}` : '';
    console.log(`   ${icon} ${check.name}${duration}`);
  }
}

// ============================================
// Discovery Output Functions
// ============================================

/**
 * Print step discovery results.
 *
 * @param totalSteps - Total number of steps discovered
 * @param preCompletedCount - Number of pre-completed steps
 * @param noDoItButtonCount - Number of steps without "Do it" button
 * @param durationMs - Discovery duration in milliseconds
 */
export function printDiscoveryResults(
  totalSteps: number,
  preCompletedCount: number,
  noDoItButtonCount: number,
  durationMs: number
): void {
  const duration = formatDuration(durationMs);
  console.log();
  console.log(`📋 Discovered ${totalSteps} steps ${duration}`);
  if (preCompletedCount > 0 || noDoItButtonCount > 0) {
    console.log(`   (${preCompletedCount} pre-completed, ${noDoItButtonCount} without "Do it" button)`);
  }
  console.log();
}
