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
 * @see src/cli/e2e/e2e-reporter.ts for JSON report generation
 */

import { readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';

import { test, expect } from '../fixtures';
import { testIds } from '../../src/constants/testIds';
// Import from storage-keys.ts directly to avoid browser dependencies from user-storage.ts
import { StorageKeys } from '../../src/lib/storage-keys';
import { runPlaywrightPreflightChecks, formatPreflightResults } from './utils/preflight';
import {
  discoverStepsFromDOM,
  executeAllSteps,
  calculateGuideTimeout,
  GUIDE_INITIAL_TIMEOUT_MS,
  ensureDocsPanelOpen,
  summarizeResults,
  AllStepsResult,
  AbortReason,
  StepTestResult,
  createGuideTerminationController,
  GuideTerminationError,
  raceGuideTermination,
} from './utils/guide-runner';
import {
  printHeader,
  printStepResult,
  printDetailedSummary,
  printPreflightChecks,
  printDiscoveryResults,
} from './utils/console-reporter';
import { contentDigest, type TestResultsData } from '../../src/cli/e2e/e2e-reporter';
import { countInteractiveBlocks } from './utils/guide-runner/static-analysis';
import { E2E_ENV, isEnvFlagEnabled } from '../../src/cli/e2e/e2e-runner-contract';
import type { E2EErrorCode } from '../../src/cli/e2e/schemas/e2e-report.schema';
import {
  createScopedBearerTokenAuthStrategy,
  installScopedBearerTokenRoute,
  scopedBearerHeaders,
} from './auth/scoped-bearer-token';

/**
 * Write abort reason to file for CLI to read and determine exit code.
 * This enables the CLI to return exit code 4 for AUTH_EXPIRED (L3-3D).
 *
 * @param abortReason - The reason for aborting (AUTH_EXPIRED, MANDATORY_FAILURE)
 * @param message - Human-readable message
 */
function writeAbortFile(data: { message: string; abortReason?: AbortReason; errorCode?: E2EErrorCode }): void {
  const abortFilePath = process.env[E2E_ENV.ABORT_FILE_PATH];
  if (abortFilePath) {
    writeFileSync(abortFilePath, JSON.stringify(data), 'utf-8');
  }
}

/**
 * Write test results to file for CLI to read and generate JSON report (L3-5B).
 *
 * @param results - The step test results
 * @param guide - Guide metadata
 * @param targetUrl - Resolved Grafana base URL the guide was tested against
 * @param timestamp - ISO timestamp of test start
 * @param allStepsResult - Full execution result including abort info
 */
function writeResultsFile(
  results: StepTestResult[],
  guide: { id: string; title: string; path: string },
  targetUrl: string,
  startingLocation: string,
  timestamp: string,
  allStepsResult: AllStepsResult,
  guideContent: string,
  outcome: TestResultsData['outcome']
): void {
  const resultsFilePath = process.env[E2E_ENV.RESULTS_FILE_PATH];
  if (!resultsFilePath) {
    return;
  }

  const data: TestResultsData = {
    guide: { ...guide, targetUrl, startingLocation, contentDigest: contentDigest(guideContent) },
    timestamp,
    startedAt: timestamp,
    endedAt: new Date().toISOString(),
    outcome,
    errorCode: allStepsResult.errorCode ?? allStepsResult.abortReason ?? (outcome === 'failed' ? 'UNKNOWN' : undefined),
    errorMessage: allStepsResult.abortMessage,
    results: results.map((r) => ({
      stepId: r.stepId,
      status: r.status,
      durationMs: r.durationMs,
      currentUrl: r.currentUrl,
      consoleErrors: r.consoleErrors,
      error: r.error,
      errorCode: r.errorCode,
      skipReason: r.skipReason,
      skippable: r.skippable,
      // L3-5C: Include classification for failed or not_reached steps
      classification: r.classification,
      // L3-5D: Include artifact paths for failed steps
      artifacts: r.artifacts,
    })),
    aborted: allStepsResult.aborted,
    abortReason: allStepsResult.abortReason,
    abortMessage: allStepsResult.abortMessage,
  };

  writeFileSync(resultsFilePath, JSON.stringify(data), 'utf-8');
}

function writeDeadlineFile(deadlineEpochMs: number): void {
  const deadlineFilePath = process.env[E2E_ENV.DEADLINE_FILE_PATH];
  if (deadlineFilePath) {
    const temporaryPath = `${deadlineFilePath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify({ deadlineEpochMs }), 'utf-8');
    renameSync(temporaryPath, deadlineFilePath);
  }
}

/**
 * Record the produced trace's location for the CLI to surface (see
 * e2e-runner-contract). Playwright writes the per-test trace to
 * `<outputDir>/trace.zip` when tracing is on.
 */
function writeTracePathFile(outputDir: string): void {
  const tracePathFile = process.env[E2E_ENV.TRACE_OUTPUT_FILE];
  if (!tracePathFile || !isEnvFlagEnabled(process.env[E2E_ENV.TRACE])) {
    return;
  }
  writeFileSync(tracePathFile, join(outputDir, 'trace.zip'), 'utf-8');
}

test.describe('Guide Runner', () => {
  test('loads and displays guide from JSON', async ({ page }, testInfo) => {
    test.setTimeout(GUIDE_INITIAL_TIMEOUT_MS);

    // L3-5B: Capture timestamp at test start for JSON report
    const testStartTimestamp = new Date().toISOString();
    const testStartTimeMs = Date.now();

    // Read guide JSON from environment variable path
    const guidePath = process.env[E2E_ENV.GUIDE_JSON_PATH];
    const targetUrl = process.env[E2E_ENV.GRAFANA_URL] ?? 'http://localhost:3000';
    const startingLocation = process.env[E2E_ENV.STARTING_LOCATION] ?? '/';
    const bearerToken = process.env[E2E_ENV.GRAFANA_TOKEN];
    const isVerbose = isEnvFlagEnabled(process.env[E2E_ENV.VERBOSE]);
    // L3-5D: Artifacts directory for artifact collection
    const artifactsDir = process.env[E2E_ENV.ARTIFACTS_DIR];
    // Capture screenshots on success and failure
    const alwaysScreenshot = isEnvFlagEnabled(process.env[E2E_ENV.ALWAYS_SCREENSHOT]);

    // Record the trace location up front so the CLI can surface it even when the
    // test fails (Playwright produces the trace regardless of pass/fail).
    writeTracePathFile(testInfo.outputDir);

    if (!guidePath) {
      throw new Error(`${E2E_ENV.GUIDE_JSON_PATH} environment variable is required`);
    }

    const guideJson = readFileSync(guidePath, 'utf-8');
    const guide = JSON.parse(guideJson) as { title?: string; id?: string };
    const hasInteractiveSteps = countInteractiveBlocks(guide) > 0;
    const guideTitle = guide.title ?? 'E2E Test Guide';

    // L3-5B: Extract guide ID from path or use provided id
    const guideId = guide.id ?? guidePath.split('/').pop()?.replace('.json', '') ?? 'unknown';
    const guideMetadata = {
      id: guideId,
      title: guideTitle,
      path: guidePath,
    };
    const completedResults: StepTestResult[] = [];
    const terminationController = createGuideTerminationController(page);

    try {
      await raceGuideTermination(
        (async () => {
          if (bearerToken) {
            await installScopedBearerTokenRoute(page, targetUrl, bearerToken);
          }

          // ============================================
          // Pre-flight checks: auth and plugin validation
          // ============================================
          const preflightResult = await runPlaywrightPreflightChecks(page, targetUrl, {
            authStrategy: bearerToken ? createScopedBearerTokenAuthStrategy(bearerToken, targetUrl) : undefined,
            requestHeaders: bearerToken ? scopedBearerHeaders(targetUrl, targetUrl, bearerToken) : undefined,
          });

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

          await page.goto(startingLocation, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.locator('button[aria-label="Help"]').waitFor({ state: 'visible', timeout: 30000 });

          const injectGuide = () =>
            page.evaluate(
              ({ key, json }) => {
                localStorage.setItem(key, json);
              },
              { key: StorageKeys.E2E_TEST_GUIDE, json: guideJson }
            );
          await injectGuide();
          await ensureDocsPanelOpen(page, {
            beforeRetry: async () => {
              await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
              await page.locator('button[aria-label="Help"]').waitFor({ state: 'visible', timeout: 10000 });
              await injectGuide();
            },
          });

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

          if (!hasInteractiveSteps) {
            printHeader(guideTitle);
            console.log('   ⊘ No interactive steps — guide is read-only content (0 steps, pass)');
            const emptyResult: AllStepsResult = { results: [], aborted: false };
            writeResultsFile(
              [],
              guideMetadata,
              targetUrl,
              startingLocation,
              testStartTimestamp,
              emptyResult,
              guideJson,
              'passed'
            );
            return;
          }

          // Verify guide content loaded (first step visible indicates interactive content rendered)
          // Use a more general selector since step IDs vary by guide
          const firstStep = page.locator('[data-testid^="interactive-step-"]').first();
          await expect(firstStep).toBeVisible({ timeout: 15000 });

          // ============================================
          // Step discovery: DOM-based step enumeration
          // ============================================
          const discoveryResult = await discoverStepsFromDOM(page);
          const guideTimeout = calculateGuideTimeout(discoveryResult.steps);
          test.setTimeout(guideTimeout);
          writeDeadlineFile(testStartTimeMs + guideTimeout);

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
            // L3-5D: Artifacts directory for artifact collection
            artifactsDir,
            // Capture screenshots on success and failure
            alwaysScreenshot,
            terminationController,
            // L3-5A: Real-time step progress callback
            onStepComplete: (result) => {
              completedResults.push(result);
              printStepResult(result);
            },
          });

          // Get summary for assertions
          const summary = summarizeResults(executionResult.results);

          // L3-5A: Print summary using console reporter
          printDetailedSummary(executionResult.results, executionResult, isVerbose);

          // L3-5B: Write results file for CLI to generate JSON report
          writeResultsFile(
            executionResult.results,
            guideMetadata,
            targetUrl,
            startingLocation,
            testStartTimestamp,
            executionResult,
            guideJson,
            executionResult.outcome ??
              (executionResult.abortReason === 'AUTH_EXPIRED'
                ? 'aborted'
                : executionResult.abortReason === 'MANDATORY_FAILURE' || !summary.success
                  ? 'failed'
                  : 'passed')
          );

          // L3-3D: Handle session expiry with specific exit code
          if (executionResult.aborted && executionResult.abortReason === 'AUTH_EXPIRED') {
            // Write abort file for CLI to read and determine exit code 4 (AUTH_FAILURE)
            writeAbortFile({
              abortReason: 'AUTH_EXPIRED',
              message: executionResult.abortMessage ?? 'Session expired mid-test',
            });

            // Throw error to fail the test
            throw new Error(`AUTH_EXPIRED: ${executionResult.abortMessage}`);
          }
          if (executionResult.outcome === 'infrastructure_error' && executionResult.errorCode) {
            writeAbortFile({
              errorCode: executionResult.errorCode,
              message: executionResult.abortMessage ?? 'The guide stopped after an infrastructure error.',
            });
          }

          expect(summary.success).toBe(true);
        })(),
        terminationController
      );
    } catch (error) {
      if (error instanceof GuideTerminationError) {
        const { termination } = error;
        const results = [...completedResults];
        if (termination.stepId && !results.some((result) => result.stepId === termination.stepId)) {
          results.push({
            stepId: termination.stepId,
            status: 'failed',
            durationMs: 0,
            currentUrl: terminationController.lastKnownUrl(),
            consoleErrors: [],
            error: termination.message,
            errorCode: termination.code,
            skippable: false,
            classification: termination.classification,
          });
        }
        const terminalResult: AllStepsResult = {
          results,
          aborted: true,
          outcome: termination.outcome,
          errorCode: termination.code,
          abortMessage: termination.message,
        };
        writeResultsFile(
          results,
          guideMetadata,
          targetUrl,
          startingLocation,
          testStartTimestamp,
          terminalResult,
          guideJson,
          termination.outcome
        );
        writeAbortFile({ errorCode: termination.code, message: termination.message });
      }
      throw error;
    } finally {
      terminationController.markExpectedTeardown();
      terminationController.dispose();
    }
  });
});
