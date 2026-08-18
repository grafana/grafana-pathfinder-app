/**
 * Guide Test Runner Execution
 *
 * Functions for executing interactive steps and reporting results.
 * Implements step execution with proper timing, artifact collection,
 * and session validation per the E2E Test Runner design.
 *
 * @see docs/developer/E2E_TESTING.md#how-it-works
 */

import type { Page } from '@playwright/test';

import { testIds } from '../../../../src/constants/testIds';
import {
  GUIDE_INITIAL_TIMEOUT_MS,
  STEP_OVERHEAD_TIMEOUT_MS,
  SCROLL_SETTLE_DELAY_MS,
  SCROLL_INTO_VIEW_TIMEOUT_MS,
  LATE_COMPLETION_CHECK_TIMEOUT_MS,
  DEFAULT_SESSION_CHECK_INTERVAL,
  MAX_FIX_ATTEMPTS,
} from './constants';
import { classifyError } from './classification';
import {
  captureFailureArtifacts,
  captureSuccessArtifacts,
  capturePreStepArtifacts,
  captureFinalScreenshot,
} from './artifacts';
import { validateSession, handleRequirementsWithFix } from './requirements';
import { getStepDriver, selectStepAction as selectDriverAction, stepTimeout } from './drivers';
import type {
  TestableStep,
  SkipReason,
  AbortReason,
  ArtifactPaths,
  StepTestResult,
  AllStepsResult,
  OnStepCompleteCallback,
} from './types';

// ============================================
// Utility Functions
// ============================================

/**
 * Scroll a step into view within the docs panel.
 *
 * Before interacting with a step, ensure it's visible in the viewport.
 * Uses scrollIntoViewIfNeeded for smooth scrolling.
 *
 * @param page - Playwright Page object
 * @param stepId - The step identifier
 * @param scrollDelay - Optional delay after scrolling (ms) for animations to settle
 */
export async function scrollStepIntoView(
  page: Page,
  stepId: string,
  scrollDelay = SCROLL_SETTLE_DELAY_MS,
  scrollTimeout = SCROLL_INTO_VIEW_TIMEOUT_MS
): Promise<void> {
  const stepElement = page.getByTestId(testIds.interactive.step(stepId));

  // Scroll within the docs panel container. Bounded: a step that is completing
  // or detaching around this point should not block on an unbounded wait.
  await stepElement.scrollIntoViewIfNeeded({ timeout: scrollTimeout });

  // Wait for scroll animation to complete
  if (scrollDelay > 0) {
    await page.waitForTimeout(scrollDelay);
  }
}

/**
 * Calculate the appropriate timeout for a step based on its type (L3-3C).
 *
 * Per design doc: 30s base timeout for simple steps, +5s per internal action
 * for multisteps. This accommodates multisteps with many internal actions.
 *
 * @param step - The testable step
 * @returns Timeout in milliseconds
 */
export function calculateStepTimeout(step: TestableStep): number {
  return stepTimeout(step);
}

export function calculateGuideTimeout(steps: TestableStep[]): number {
  return (
    GUIDE_INITIAL_TIMEOUT_MS +
    steps.reduce((total, step) => total + calculateStepTimeout(step) + STEP_OVERHEAD_TIMEOUT_MS, 0)
  );
}

export type StepAction = 'do-it' | 'show-me';

export function selectStepAction(
  step: Pick<TestableStep, 'hasDoItButton' | 'hasShowMeButton'>
): StepAction | undefined {
  return selectDriverAction(step);
}

export function determineUnmetRequirementOutcome(skippable: boolean): 'skip' | 'fail' {
  return skippable ? 'skip' : 'fail';
}

/**
 * Outcome of the late completion/detachment precheck:
 * - `completed`: the step's element is attached and already `completed`.
 * - `detached`: the step's element is confirmed gone (a successful query
 *   returned zero matches), which this file treats as a completion signal
 *   the same way `waitForCompletionWithObjectivePolling` and the guided
 *   substep loop do.
 * - `not-complete`: proceed with normal execution.
 */
type LateCompletionOutcome = 'completed' | 'detached' | 'not-complete';

/**
 * Recheck completion/detachment immediately before the scroll call in
 * executeStep. Bounded so a step that's mid-detach can't hang the run on an
 * otherwise-unbounded attribute read (Playwright auto-waits on a missing
 * element up to its own timeout by default).
 *
 * A `count()` error, or an attached element whose read failed for an
 * unrelated reason, is a genuine fault and propagates instead of being
 * reported as "already done".
 *
 * @param page - Playwright Page object
 * @param stepId - The step identifier
 * @param timeout - Bound for the attribute read (ms)
 */
async function checkLateCompletionOrDetachment(
  page: Page,
  stepId: string,
  timeout = LATE_COMPLETION_CHECK_TIMEOUT_MS
): Promise<LateCompletionOutcome> {
  const stepLocator = page.getByTestId(testIds.interactive.step(stepId));
  if ((await stepLocator.count()) === 0) {
    return 'detached';
  }

  let state: string | null;
  try {
    state = await stepLocator.getAttribute('data-test-step-state', { timeout });
  } catch (err) {
    // The bounded read didn't complete (e.g. the element detached mid-read).
    // Re-count: a successful zero confirms late detachment; an attached
    // element (or a failing re-count) is a genuine fault and must propagate.
    if ((await stepLocator.count()) === 0) {
      return 'detached';
    }
    throw err;
  }
  return state === 'completed' ? 'completed' : 'not-complete';
}

export type { GuidedCommentBoxWaitOutcome } from './drivers/guided';
export {
  parseNthMatchSelector,
  runGuidedSubstepLoop,
  waitForFormfillSettle,
  waitForGuidedCommentBoxReady,
  waitForGuidedExecutionStart,
} from './drivers/guided';

// ============================================
// Step Execution Functions (L3-3C Enhanced)
// ============================================

/**
 * Create a skipped result for a step.
 *
 * @param step - The step that was skipped
 * @param page - Playwright Page object
 * @param startTime - Start time for duration calculation
 * @param consoleErrors - Any console errors captured
 * @param skipReason - Why the step was skipped
 * @returns StepTestResult with skipped status
 */
function createSkippedResult(
  step: TestableStep,
  page: Page,
  startTime: number,
  consoleErrors: string[],
  skipReason: SkipReason
): StepTestResult {
  return {
    stepId: step.stepId,
    status: 'skipped',
    durationMs: Date.now() - startTime,
    currentUrl: page.url(),
    consoleErrors,
    skipReason,
    skippable: step.skippable,
  };
}

/**
 * Build the success-path artifact bundle for a step, merging in a
 * previously-captured PRE screenshot if there is one. Returns undefined when
 * artifact capture isn't enabled, matching every success-return call site.
 */
async function buildSuccessArtifacts(
  page: Page,
  stepId: string,
  artifactsDir: string | undefined,
  alwaysScreenshot: boolean,
  preScreenshotPath: string | undefined
): Promise<ArtifactPaths | undefined> {
  if (!artifactsDir || !alwaysScreenshot) {
    return undefined;
  }
  const artifacts = await captureSuccessArtifacts(page, stepId, artifactsDir);
  if (artifacts && preScreenshotPath) {
    artifacts.screenshotPre = preScreenshotPath;
    return artifacts;
  }
  return artifacts ?? (preScreenshotPath ? { screenshotPre: preScreenshotPath } : undefined);
}

/**
 * Build the failure-path artifact bundle for a step, merging in a
 * previously-captured PRE screenshot if there is one. Returns undefined when
 * no artifacts directory was configured, matching every failure-return call site.
 */
async function buildFailureArtifacts(
  page: Page,
  stepId: string,
  consoleErrors: string[],
  artifactsDir: string | undefined,
  preScreenshotPath: string | undefined
): Promise<ArtifactPaths | undefined> {
  if (!artifactsDir) {
    return undefined;
  }
  const artifacts = await captureFailureArtifacts(page, stepId, consoleErrors, artifactsDir);
  if (artifacts && preScreenshotPath) {
    artifacts.screenshotPre = preScreenshotPath;
    return artifacts;
  }
  return artifacts ?? (preScreenshotPath ? { screenshotPre: preScreenshotPath } : undefined);
}

/**
 * Execute a single step in the guide (L3-3C enhanced).
 *
 * This function implements step execution with proper timing:
 * 1. Handle pre-completed steps (skip with logging)
 * 2. Handle steps without "Do it" buttons (skip with logging)
 * 3. Scroll step into view with settle delay
 * 4. Check for objective-based auto-completion before clicking
 * 5. Wait for "Do it" button to be enabled (sequential dependencies)
 * 6. Click "Do it" button with post-click settle delay
 * 7. Wait for completion with objective polling
 * 8. Return result with diagnostics
 * 9. Capture artifacts on failure if artifactsDir is specified (L3-5D)
 *
 * Timing enhancements (L3-3C):
 * - Sequential dependencies: 10s timeout for button enable
 * - Multisteps: Dynamic timeout (30s base + 5s per internal action)
 * - Objective completion: Polling during wait to detect auto-completion
 * - Settle delays: Post-scroll and post-click delays for reactive system
 *
 * Artifact collection (L3-5D):
 * - Screenshots and DOM snapshots captured only on failure
 * - Console errors written to JSON file
 * - Artifacts saved to artifactsDir if specified
 *
 * @param page - Playwright Page object
 * @param step - The testable step to execute
 * @param options - Execution options
 * @returns StepTestResult with execution outcome and diagnostics
 */
async function executeStepCore(
  page: Page,
  step: TestableStep,
  options: {
    timeout?: number;
    verbose?: boolean;
    /** Directory to write artifacts to (L3-5D). If not set, no artifacts captured. */
    artifactsDir?: string;
    /** Capture screenshots on success, not just failure. Default: false */
    alwaysScreenshot?: boolean;
  } = {}
): Promise<StepTestResult> {
  // L3-3C: Calculate appropriate timeout based on step type
  const calculatedTimeout = calculateStepTimeout(step);
  const { timeout = calculatedTimeout, verbose = false, artifactsDir, alwaysScreenshot = false } = options;
  const startTime = Date.now();
  const driver = getStepDriver(step.stepKind);
  const consoleErrors: string[] = [];

  // Set up console error capture for this step execution
  // REACT: cleanup subscription (R1) - removed in finally block
  const consoleHandler = (msg: { type: () => string; text: () => string }) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  };
  page.on('console', consoleHandler);

  // PRE screenshot path (captured before step execution when alwaysScreenshot is enabled)
  let preScreenshotPath: string | undefined;

  try {
    // Handle pre-completed steps (U2: objectives/noop auto-completion)
    if (step.isPreCompleted) {
      if (verbose) {
        console.log(`   ⊘ Step ${step.stepId} already completed (discovered as pre-completed)`);
      }
      return createSkippedResult(step, page, startTime, consoleErrors, 'pre_completed');
    }

    // Some no-op/objective-based steps complete (or their element detaches)
    // between discovery and execution; recheck immediately before scrolling so
    // a step that's already done doesn't block on the scroll below. Bounded
    // and error-propagating: a query/navigation fault fails the step instead
    // of being mistaken for "already done". Reported as 'passed', matching
    // the pre-click objective check below so the same DOM state (attached +
    // completed) is never classified differently depending on which check
    // happened to observe it first; detachment is treated the same way
    // detachment is treated as completion elsewhere in this file.
    const lateOutcome = await checkLateCompletionOrDetachment(page, step.stepId);
    if (lateOutcome !== 'not-complete') {
      const lateArtifacts = await buildSuccessArtifacts(
        page,
        step.stepId,
        artifactsDir,
        alwaysScreenshot,
        preScreenshotPath
      );
      if (verbose) {
        console.log(
          `   ✓ Step ${step.stepId} ${lateOutcome === 'detached' ? 'detached' : 'completed via objectives'} before scroll`
        );
        if (lateArtifacts) {
          console.log(`   📸 Success screenshot captured`);
        }
      }
      return {
        stepId: step.stepId,
        status: 'passed',
        durationMs: Date.now() - startTime,
        currentUrl: page.url(),
        consoleErrors,
        skippable: step.skippable,
        artifacts: lateArtifacts,
      };
    }

    // Scroll step into view before interaction. Bounded so a step that's
    // completing/detaching right around this point doesn't hang the run.
    await scrollStepIntoView(page, step.stepId, SCROLL_SETTLE_DELAY_MS);

    // Capture PRE screenshot if alwaysScreenshot is enabled
    if (artifactsDir && alwaysScreenshot) {
      preScreenshotPath = await capturePreStepArtifacts(page, step.stepId, artifactsDir);
      if (verbose && preScreenshotPath) {
        console.log(`   📸 PRE screenshot captured`);
      }
    }

    // L3-4A/4B: Detect requirements and attempt to fix if needed BEFORE waiting for button
    // Requirements must be met before the "Do it" button can appear/be enabled
    if (verbose) {
      console.log(`   🔍 Checking requirements for step ${step.stepId}...`);
    }
    const { requirements, fixResult } = await handleRequirementsWithFix(page, step, {
      verbose,
      attemptFix: true, // Attempt fix for all steps, skip later if it fails
      maxFixAttempts: MAX_FIX_ATTEMPTS,
    });

    // If requirements are not met after fix attempts
    if (!requirements.requirementsMet && requirements.status === 'unmet') {
      if (determineUnmetRequirementOutcome(step.skippable) === 'skip') {
        // Click the Skip control and wait for the plugin to leave requirements-unmet
        // so the next sequential step isn't gated on "Complete previous step". Only
        // record the skip once that's confirmed; a sync failure is a clear runner
        // failure rather than a false skip that reproduces the original bug.
        try {
          await driver.skip(page, step.stepId);
        } catch (syncError) {
          const syncErrorMsg = syncError instanceof Error ? syncError.message : String(syncError);
          if (verbose) {
            console.log(`   ✗ Step ${step.stepId} failed: skip sync did not complete (${syncErrorMsg})`);
          }
          return {
            stepId: step.stepId,
            status: 'failed',
            durationMs: Date.now() - startTime,
            currentUrl: page.url(),
            consoleErrors,
            error: `Step is skippable but Skip sync failed: ${syncErrorMsg}`,
            skippable: step.skippable,
            classification: classifyError(syncErrorMsg),
            artifacts: await buildFailureArtifacts(page, step.stepId, consoleErrors, artifactsDir, preScreenshotPath),
          };
        }
        if (verbose) {
          console.log(`   ⊘ Step ${step.stepId} skipped due to unmet requirements (skippable)`);
        }
        return createSkippedResult(step, page, startTime, consoleErrors, 'requirements_unmet');
      }
      const errorMsg = fixResult
        ? `Requirements not met after ${fixResult.totalAttempts} fix attempt(s): ${fixResult.failureReason || 'unknown reason'}`
        : `Requirements not met: ${requirements.explanationText || 'no automatic fix is available'}`;
      if (verbose) {
        console.log(`   ✗ Step ${step.stepId} failed: ${errorMsg}`);
      }
      return {
        stepId: step.stepId,
        status: 'failed',
        durationMs: Date.now() - startTime,
        currentUrl: page.url(),
        consoleErrors,
        error: errorMsg,
        skippable: false,
        classification: classifyError(errorMsg),
        artifacts: await buildFailureArtifacts(page, step.stepId, consoleErrors, artifactsDir, preScreenshotPath),
      };
    }

    // L3-3C: Check for objective-based auto-completion BEFORE clicking
    // Objectives may be satisfied by prior actions (e.g., navigation completed the step)
    const preClickCompleted = await driver.completionState(page, step.stepId);
    if (preClickCompleted) {
      if (verbose) {
        console.log(`   ✓ Step ${step.stepId} auto-completed via objectives before clicking`);
      }

      const artifacts = await buildSuccessArtifacts(
        page,
        step.stepId,
        artifactsDir,
        alwaysScreenshot,
        preScreenshotPath
      );
      if (verbose && artifacts) {
        console.log(`   📸 Success screenshot captured`);
      }

      return {
        stepId: step.stepId,
        status: 'passed',
        durationMs: Date.now() - startTime,
        currentUrl: page.url(),
        consoleErrors,
        skippable: step.skippable,
        artifacts,
      };
    }

    const execution = await driver.execute({ page, step, timeout, verbose, artifactsDir });
    if (execution.outcome === 'no-control') {
      if (step.skippable) {
        return createSkippedResult(step, page, startTime, consoleErrors, 'no_do_it_button');
      }
      throw new Error(`No executable Do it or Show me control appeared for mandatory step ${step.stepId}`);
    }

    if (verbose && execution.completedViaObjectives) {
      console.log(`   ℹ Step ${step.stepId} completed quickly (possibly via objectives)`);
    }

    const successArtifacts = await buildSuccessArtifacts(
      page,
      step.stepId,
      artifactsDir,
      alwaysScreenshot,
      preScreenshotPath
    );
    if (verbose && successArtifacts) {
      console.log(`   📸 Success screenshot captured`);
    }

    // Return success result with diagnostics
    return {
      stepId: step.stepId,
      status: 'passed',
      durationMs: Date.now() - startTime,
      currentUrl: page.url(),
      consoleErrors,
      skippable: step.skippable,
      artifacts: successArtifacts,
    };
  } catch (error) {
    // Return failure result with error details
    const errorMsg = error instanceof Error ? error.message : String(error);

    // L3-5D: Capture artifacts on failure
    const artifacts = await buildFailureArtifacts(page, step.stepId, consoleErrors, artifactsDir, preScreenshotPath);
    if (verbose && artifacts) {
      console.log(`   📸 Artifacts captured to ${artifactsDir}`);
    }

    return {
      stepId: step.stepId,
      status: 'failed',
      durationMs: Date.now() - startTime,
      currentUrl: page.url(),
      consoleErrors,
      error: errorMsg,
      skippable: step.skippable,
      // L3-5C: Classify the error for triage hints
      classification: classifyError(errorMsg),
      // L3-5D: Include artifact paths
      artifacts,
    };
  } finally {
    // REACT: cleanup subscription (R1) - Clean up console handler to prevent memory leaks
    page.off('console', consoleHandler);
  }
}

export async function executeStep(
  page: Page,
  step: TestableStep,
  options: {
    timeout?: number;
    verbose?: boolean;
    artifactsDir?: string;
    alwaysScreenshot?: boolean;
  } = {}
): Promise<StepTestResult> {
  return {
    ...(await executeStepCore(page, step, options)),
    stepKind: step.stepKind,
  };
}
/**
 * Execute all discovered steps in sequence (L3-3D enhanced).
 *
 * This function iterates through all steps and executes them in order.
 * It handles:
 * - Pre-completed steps (skipped)
 * - Steps without "Do it" buttons (skipped)
 * - Failed mandatory steps (stops execution, marks remaining as not_reached)
 * - Session validation every N steps to detect auth expiry (L3-3D)
 * - Real-time progress reporting via onStepComplete callback (L3-5A)
 * - Artifact collection on failure (L3-5D)
 *
 * Session validation (L3-3D):
 * - Checks session validity every `sessionCheckInterval` steps (default: 5)
 * - Validates at step indices 0, N, 2N, etc. to ensure session is valid
 * - On auth expiry, aborts with AUTH_EXPIRED reason and exit code 4
 * - Remaining steps marked as not_reached
 *
 * Artifact collection (L3-5D):
 * - If artifactsDir is specified, captures screenshot, DOM snapshot, and console errors on failure
 * - Artifacts are only captured for failed steps to save space
 *
 * @param page - Playwright Page object
 * @param steps - Array of testable steps to execute
 * @param options - Execution options
 * @returns AllStepsResult with step results and abort information
 */
export async function executeAllSteps(
  page: Page,
  steps: TestableStep[],
  options: {
    timeout?: number;
    verbose?: boolean;
    stopOnMandatoryFailure?: boolean;
    /** Session check interval in steps (L3-3D). Default: 5 */
    sessionCheckInterval?: number;
    /** Callback for real-time step progress (L3-5A). Called after each step completes. */
    onStepComplete?: OnStepCompleteCallback;
    /** Directory for artifacts (L3-5D). If not set, no artifacts captured. */
    artifactsDir?: string;
    /** Capture screenshots on success, not just failure. Default: false */
    alwaysScreenshot?: boolean;
  } = {}
): Promise<AllStepsResult> {
  const {
    verbose = false,
    stopOnMandatoryFailure = true,
    sessionCheckInterval = DEFAULT_SESSION_CHECK_INTERVAL,
    onStepComplete,
    artifactsDir,
    alwaysScreenshot = false,
  } = options;
  const results: StepTestResult[] = [];
  let aborted = false;
  let abortReason: AbortReason | undefined;
  let abortMessage: string | undefined;

  if (verbose) {
    console.log(`\n🚀 Executing ${steps.length} steps...`);
    console.log(`   Session validation: every ${sessionCheckInterval} steps`);
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    // If we've aborted, mark remaining steps as not_reached
    if (aborted) {
      results.push({
        stepId: step.stepId,
        stepKind: step.stepKind,
        status: 'not_reached',
        durationMs: 0,
        currentUrl: page.url(),
        consoleErrors: [],
        skippable: step.skippable,
      });
      continue;
    }

    // L3-3D: Session validation every N steps
    // Check at step indices 0, sessionCheckInterval, 2*sessionCheckInterval, etc.
    if (i % sessionCheckInterval === 0) {
      if (verbose) {
        console.log(`\n   🔐 Validating session (step ${i + 1})...`);
      }

      const sessionValid = await validateSession(page);

      if (!sessionValid) {
        if (verbose) {
          console.log(`   ❌ Session expired, aborting remaining steps`);
        }
        aborted = true;
        abortReason = 'AUTH_EXPIRED';
        abortMessage = 'Session expired mid-test';

        // Mark current and remaining steps as not_reached
        // L3-5C: Classify as infrastructure since it's due to AUTH_EXPIRED
        for (let j = i; j < steps.length; j++) {
          results.push({
            stepId: steps[j].stepId,
            stepKind: steps[j].stepKind,
            status: 'not_reached',
            durationMs: 0,
            currentUrl: page.url(),
            consoleErrors: [],
            skippable: steps[j].skippable,
            // L3-5C: AUTH_EXPIRED is always infrastructure
            classification: 'infrastructure',
          });
        }
        break;
      }

      if (verbose) {
        console.log(`   ✓ Session valid`);
      }
    }

    if (verbose) {
      console.log(`\n   [${i + 1}/${steps.length}] Step: ${step.stepId}`);
    }

    // L3-5D: Pass artifactsDir to executeStep for artifact capture
    const result = await executeStep(page, step, { ...options, artifactsDir, alwaysScreenshot });
    results.push(result);

    // L3-5A: Real-time progress callback
    if (onStepComplete) {
      onStepComplete(result, i, steps.length);
    }

    // Log result (verbose mode only - regular output uses onStepComplete)
    if (verbose) {
      logStepResult(result);
    }

    // L3-4C: Skippable vs Mandatory Logic
    // Only abort on mandatory step failures. Skippable step failures are logged but don't stop the test.
    // Per design doc decision tree:
    // - Skippable steps: if fail for any reason, log and continue (does NOT fail overall test)
    // - Mandatory steps: if fail for any reason, abort and mark remaining as NOT_REACHED
    if (result.status === 'failed') {
      if (!step.skippable && stopOnMandatoryFailure) {
        // Mandatory step failed - abort test
        if (verbose) {
          console.log(`   ❌ Mandatory step failed, aborting remaining steps`);
        }
        aborted = true;
        abortReason = 'MANDATORY_FAILURE';
        abortMessage = `Mandatory step ${step.stepId} failed: ${result.error || 'unknown error'}`;
      } else if (step.skippable) {
        // Skippable step failed - log but continue
        if (verbose) {
          console.log(`   ⚠ Skippable step failed, continuing to next step`);
        }
        // Note: Result is already recorded as 'failed', but test continues
      }
    }
  }

  // Capture final screenshot if alwaysScreenshot is enabled
  let finalScreenshot: string | undefined;
  if (artifactsDir && alwaysScreenshot) {
    finalScreenshot = await captureFinalScreenshot(page, artifactsDir);
    if (verbose && finalScreenshot) {
      console.log(`\n   📸 Final screenshot captured: ${finalScreenshot}`);
    }
  }

  return {
    results,
    aborted,
    abortReason,
    abortMessage,
    finalScreenshot,
  };
}

// ============================================
// Logging and Summary Functions
// ============================================

/**
 * Log a step execution result in a human-readable format (L3-4C enhanced).
 *
 * Shows skippable/mandatory indicator for failed steps to clarify
 * whether the failure affects overall test success.
 *
 * @param result - The step test result
 */
export function logStepResult(result: StepTestResult): void {
  const statusIcon = {
    passed: '✓',
    failed: '✗',
    skipped: '⊘',
    not_reached: '○',
  }[result.status];

  const statusColor = {
    passed: 'passed',
    failed: 'FAILED',
    skipped: 'skipped',
    not_reached: 'not reached',
  }[result.status];

  let message = `   ${statusIcon} ${result.stepId} - ${statusColor} (${result.durationMs}ms)`;

  // L3-4C: Show skippable indicator for failed steps
  if (result.status === 'failed') {
    message += result.skippable ? ' [skippable - test continues]' : ' [mandatory - test stops]';
  }

  if (result.skipReason) {
    message += ` [${result.skipReason}]`;
  }

  if (result.error) {
    message += `\n      Error: ${result.error}`;
  }

  if (result.consoleErrors.length > 0) {
    message += `\n      Console errors: ${result.consoleErrors.length}`;
  }

  console.log(message);
}

/**
 * Summarize execution results (L3-4C enhanced).
 *
 * Per design doc, overall test success is determined by:
 * - Mandatory step failures always fail the overall test
 * - Skippable step failures fail the test only when no step has a verified pass
 * - A clean all-skipped run succeeds
 *
 * @param results - Array of step test results
 * @returns Summary object with counts and overall status
 */
export interface ExecutionSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  notReached: number;
  /** L3-4C: Count of mandatory step failures (determines overall success) */
  mandatoryFailed: number;
  /** L3-4C: Count of skippable failures (affect success when no step passed) */
  skippableFailed: number;
  success: boolean;
  totalDurationMs: number;
}

export function summarizeResults(results: StepTestResult[]): ExecutionSummary {
  const failedResults = results.filter((r) => r.status === 'failed');

  // L3-4C: Separate mandatory vs skippable failures
  const mandatoryFailed = failedResults.filter((r) => !r.skippable).length;
  const skippableFailed = failedResults.filter((r) => r.skippable).length;

  const counts = {
    total: results.length,
    passed: results.filter((r) => r.status === 'passed').length,
    failed: failedResults.length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    notReached: results.filter((r) => r.status === 'not_reached').length,
    mandatoryFailed,
    skippableFailed,
  };

  return {
    ...counts,
    success: mandatoryFailed === 0 && (counts.passed > 0 || counts.failed === 0),
    totalDurationMs: results.reduce((sum, r) => sum + r.durationMs, 0),
  };
}

export function skippableFailuresAffectSuccess(summary: ExecutionSummary): boolean {
  return !summary.success && summary.mandatoryFailed === 0 && summary.skippableFailed > 0;
}

/**
 * Log execution summary in a human-readable format (L3-4C enhanced).
 *
 * Shows breakdown of mandatory vs skippable failures to help understand
 * why the test passed or failed per the L3-4C decision tree.
 *
 * @param results - Array of step test results
 */
export function logExecutionSummary(results: StepTestResult[]): void {
  const summary = summarizeResults(results);

  console.log(`\n📊 Execution Summary`);
  console.log(`   Total steps: ${summary.total}`);
  console.log(`   ✓ Passed: ${summary.passed}`);

  // L3-4C: Show breakdown of failures
  if (summary.failed > 0) {
    console.log(`   ✗ Failed: ${summary.failed}`);
    if (summary.mandatoryFailed > 0) {
      console.log(`      └─ Mandatory: ${summary.mandatoryFailed} (affects result)`);
    }
    if (summary.skippableFailed > 0) {
      const impact = skippableFailuresAffectSuccess(summary)
        ? 'affects result: no verified pass'
        : 'does not affect result';
      console.log(`      └─ Skippable: ${summary.skippableFailed} (${impact})`);
    }
  } else {
    console.log(`   ✗ Failed: 0`);
  }

  console.log(`   ⊘ Skipped: ${summary.skipped}`);
  console.log(`   ○ Not reached: ${summary.notReached}`);
  console.log(`   Total duration: ${summary.totalDurationMs}ms`);
  console.log(`   Overall: ${summary.success ? '✅ SUCCESS' : '❌ FAILURE'}`);
}
