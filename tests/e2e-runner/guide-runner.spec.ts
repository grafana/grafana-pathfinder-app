/**
 * Guide Runner E2E Spec
 *
 * This test is spawned by the CLI e2e command to verify that a guide
 * loads correctly in the docs panel. The guide JSON is passed via
 * environment variable GUIDE_JSON_PATH.
 *
 * Pre-flight checks (auth validation, plugin installation) run before
 * guide loading to fail fast with clear error messages.
 *
 * Step discovery uses DOM-based iteration to find all interactive steps
 * and capture their metadata (completion state, button availability, etc.).
 *
 * @see src/cli/commands/e2e.ts for the CLI that spawns this test
 * @see tests/e2e-runner/utils/preflight.ts for pre-flight check utilities
 * @see tests/e2e-runner/utils/guide-test-runner.ts for step discovery utilities
 * @see tests/e2e-runner/utils/console-reporter.ts for console output formatting
 * @see src/cli/utils/e2e-reporter.ts for JSON report generation
 */

import { readFileSync, writeFileSync } from 'fs';

import { test, expect } from '../fixtures';
import { testIds } from '../../src/components/testIds';
import {
  runPlaywrightPreflightChecks,
  formatPreflightResults,
} from './utils/preflight';
import {
  discoverStepsFromDOM,
  executeAllSteps,
  summarizeResults,
  AllStepsResult,
  AbortReason,
  StepTestResult,
} from './utils/guide-test-runner';
import {
  printHeader,
  printStepResult,
  printDetailedSummary,
  printPreflightChecks,
  printDiscoveryResults,
} from './utils/console-reporter';
import type { TestResultsData } from '../../src/cli/utils/e2e-reporter';

/**
 * Write abort reason to file for CLI to read and determine exit code.
 * This enables the CLI to return exit code 4 for AUTH_EXPIRED (L3-3D).
 *
 * @param abortReason - The reason for aborting (AUTH_EXPIRED, MANDATORY_FAILURE)
 * @param message - Human-readable message
 */
function writeAbortFile(abortReason: AbortReason, message: string): void {
  const abortFilePath = process.env.ABORT_FILE_PATH;
  if (abortFilePath) {
    const abortData = JSON.stringify({ abortReason, message });
    writeFileSync(abortFilePath, abortData, 'utf-8');
  }
}

/**
 * Write test results to file for CLI to read and generate JSON report (L3-5B).
 *
 * @param results - The step test results
 * @param guide - Guide metadata
 * @param grafanaUrl - Grafana URL used for testing
 * @param timestamp - ISO timestamp of test start
 * @param allStepsResult - Full execution result including abort info
 */
function writeResultsFile(
  results: StepTestResult[],
  guide: { id: string; title: string; path: string },
  grafanaUrl: string,
  timestamp: string,
  allStepsResult: AllStepsResult
): void {
  const resultsFilePath = process.env.RESULTS_FILE_PATH;
  if (!resultsFilePath) {
    return;
  }

  const data: TestResultsData = {
    guide,
    grafanaUrl,
    timestamp,
    results: results.map((r) => ({
      stepId: r.stepId,
      status: r.status,
      durationMs: r.durationMs,
      currentUrl: r.currentUrl,
      consoleErrors: r.consoleErrors,
      error: r.error,
      skipReason: r.skipReason,
      skippable: r.skippable,
    })),
    aborted: allStepsResult.aborted,
    abortReason: allStepsResult.abortReason,
    abortMessage: allStepsResult.abortMessage,
  };

  writeFileSync(resultsFilePath, JSON.stringify(data), 'utf-8');
}

/**
 * Storage key for E2E test guide injection.
 * Must match StorageKeys.E2E_TEST_GUIDE in src/lib/user-storage.ts
 */
const E2E_TEST_GUIDE_KEY = 'grafana-pathfinder-app-e2e-test-guide';

test.describe('Guide Runner', () => {
  test('loads and displays guide from JSON', async ({ page }) => {
    // L3-5B: Capture timestamp at test start for JSON report
    const testStartTimestamp = new Date().toISOString();

    // Read guide JSON from environment variable path
    const guidePath = process.env.GUIDE_JSON_PATH;
    const grafanaUrl = process.env.GRAFANA_URL ?? 'http://localhost:3000';
    const isVerbose = process.env.E2E_VERBOSE === 'true';

    if (!guidePath) {
      throw new Error('GUIDE_JSON_PATH environment variable is required');
    }

    const guideJson = readFileSync(guidePath, 'utf-8');
    const guide = JSON.parse(guideJson) as { title?: string; id?: string };
    const guideTitle = guide.title ?? 'E2E Test Guide';

    // L3-5B: Extract guide ID from path or use provided id
    const guideId = guide.id ?? guidePath.split('/').pop()?.replace('.json', '') ?? 'unknown';

    // ============================================
    // Pre-flight checks: auth and plugin validation
    // ============================================
    const preflightResult = await runPlaywrightPreflightChecks(page, grafanaUrl);

    // Log pre-flight results using console reporter
    printPreflightChecks(preflightResult.checks);

    // Log detailed results in verbose mode
    if (isVerbose) {
      const formattedPreflight = formatPreflightResults(preflightResult, isVerbose);
      if (formattedPreflight) {
        console.log(formattedPreflight);
      }
    }

    if (!preflightResult.success) {
      // Determine which check failed for error reporting
      const failedCheck = preflightResult.checks.find((c) => !c.passed);
      const checkName = failedCheck?.name ?? 'unknown';

      if (checkName === 'auth-valid') {
        throw new Error(`Pre-flight auth check failed: ${preflightResult.abortReason}`);
      } else if (checkName === 'plugin-installed') {
        throw new Error(`Pre-flight plugin check failed: ${preflightResult.abortReason}`);
      } else {
        throw new Error(`Pre-flight check failed: ${preflightResult.abortReason}`);
      }
    }

    // ============================================
    // Guide loading and verification
    // ============================================

    // Navigate to Grafana home (pre-flight may have left us on a different page)
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Inject guide into localStorage BEFORE opening the panel
    await page.evaluate(
      ({ key, json }) => {
        localStorage.setItem(key, json);
      },
      { key: E2E_TEST_GUIDE_KEY, json: guideJson }
    );

    // Open the docs panel first via Help button (panel must be mounted for event listener)
    const helpButton = page.locator('button[aria-label="Help"]');
    await helpButton.click();

    // Verify panel is visible
    const panel = page.getByTestId(testIds.docsPanel.container);
    await expect(panel).toBeVisible({ timeout: 10000 });

    // Now dispatch the event to load the specific guide content
    // The event listener is only active when the docs panel is mounted
    await page.evaluate(
      ({ title }) => {
        document.dispatchEvent(
          new CustomEvent('pathfinder-auto-open-docs', {
            detail: { url: 'bundled:e2e-test', title },
          })
        );
      },
      { title: guideTitle }
    );

    // Wait for content to load
    await page.waitForTimeout(1000);

    // Verify guide content loaded (first step visible indicates interactive content rendered)
    // Use a more general selector since step IDs vary by guide
    const firstStep = page.locator('[data-testid^="interactive-step-"]').first();
    await expect(firstStep).toBeVisible({ timeout: 15000 });

    // ============================================
    // Step discovery: DOM-based step enumeration
    // ============================================
    const discoveryResult = await discoverStepsFromDOM(page);

    // Verify step discovery found steps
    expect(discoveryResult.totalSteps).toBeGreaterThan(0);

    // Steps should be in document order (indices should match)
    for (let i = 0; i < discoveryResult.steps.length; i++) {
      expect(discoveryResult.steps[i].index).toBe(i);
    }

    // ============================================
    // Print header and discovery using console reporter (L3-5A)
    // ============================================
    printHeader(guideTitle);
    printDiscoveryResults(
      discoveryResult.totalSteps,
      discoveryResult.preCompletedCount,
      discoveryResult.noDoItButtonCount,
      discoveryResult.durationMs
    );

    // ============================================
    // Step execution: Execute all discovered steps
    // ============================================
    const executionResult: AllStepsResult = await executeAllSteps(page, discoveryResult.steps, {
      verbose: isVerbose,
      stopOnMandatoryFailure: true, // Happy path: stop on first failure
      sessionCheckInterval: 5, // L3-3D: validate session every 5 steps
      // L3-5A: Real-time step progress callback
      onStepComplete: (result) => {
        printStepResult(result);
      },
    });

    // Get summary for assertions
    const summary = summarizeResults(executionResult.results);

    // L3-5A: Print summary using console reporter
    printDetailedSummary(executionResult.results, executionResult, isVerbose);

    // L3-5B: Write results file for CLI to generate JSON report
    const guideMetadata = {
      id: guideId,
      title: guideTitle,
      path: guidePath ?? 'unknown',
    };
    writeResultsFile(
      executionResult.results,
      guideMetadata,
      grafanaUrl,
      testStartTimestamp,
      executionResult
    );

    // L3-3D: Handle session expiry with specific exit code
    if (executionResult.aborted && executionResult.abortReason === 'AUTH_EXPIRED') {
      // Write abort file for CLI to read and determine exit code 4 (AUTH_FAILURE)
      writeAbortFile('AUTH_EXPIRED', executionResult.abortMessage ?? 'Session expired mid-test');

      // Throw error to fail the test
      throw new Error(`AUTH_EXPIRED: ${executionResult.abortMessage}`);
    }

    // L3-4C: Verify no mandatory failures occurred
    // Per design doc: skippable step failures do NOT fail the overall test
    expect(summary.mandatoryFailed).toBe(0);
  });
});
