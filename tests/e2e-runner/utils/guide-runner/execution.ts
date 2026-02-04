/**
 * Guide Test Runner Execution
 *
 * Functions for executing interactive steps and reporting results.
 * Implements step execution with proper timing, artifact collection,
 * and session validation per the E2E Test Runner design.
 *
 * @see tests/e2e-runner/design/e2e-test-runner-design.md
 */

import { Page, expect } from '@playwright/test';

import { testIds } from '../../../../src/components/testIds';
import {
  DEFAULT_STEP_TIMEOUT_MS,
  TIMEOUT_PER_MULTISTEP_ACTION_MS,
  BUTTON_ENABLE_TIMEOUT_MS,
  BUTTON_APPEAR_TIMEOUT_MS,
  SCROLL_SETTLE_DELAY_MS,
  POST_CLICK_SETTLE_DELAY_MS,
  COMPLETION_POLL_INTERVAL_MS,
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
  scrollDelay = SCROLL_SETTLE_DELAY_MS
): Promise<void> {
  const stepElement = page.getByTestId(testIds.interactive.step(stepId));

  // Scroll within the docs panel container
  await stepElement.scrollIntoViewIfNeeded();

  // Wait for scroll animation to complete
  if (scrollDelay > 0) {
    await page.waitForTimeout(scrollDelay);
  }
}

/**
 * Wait for a step's "Do it" button to become enabled (L3-3C).
 *
 * Per U3 findings: Steps may not be clickable immediately when discovered.
 * Sequential dependencies enforced by isEligibleForChecking mean buttons
 * can be disabled until previous steps complete.
 *
 * This function respects sequential dependencies by waiting for the button
 * to become enabled, not just visible.
 *
 * @param page - Playwright Page object
 * @param stepId - The step identifier
 * @param timeout - Maximum time to wait (ms), default 10s
 */
export async function waitForDoItButtonEnabled(
  page: Page,
  stepId: string,
  timeout = BUTTON_ENABLE_TIMEOUT_MS
): Promise<void> {
  const doItButton = page.getByTestId(testIds.interactive.doItButton(stepId));
  await expect(doItButton).toBeEnabled({ timeout });
}

/**
 * Wait for a "Do it" button to appear in the DOM.
 *
 * For steps in sections with sequential dependencies, the button
 * only appears after the previous step completes. This function
 * waits for the button to be present (not necessarily enabled).
 *
 * @param page - Playwright Page object
 * @param stepId - The step identifier
 * @param timeout - Maximum time to wait (ms), default 15s
 * @returns true if button appeared, false if timeout
 */
export async function waitForDoItButtonToAppear(
  page: Page,
  stepId: string,
  timeout = BUTTON_APPEAR_TIMEOUT_MS
): Promise<boolean> {
  const doItButton = page.getByTestId(testIds.interactive.doItButton(stepId));
  try {
    await doItButton.waitFor({ state: 'attached', timeout });
    return true;
  } catch {
    return false;
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
  if (step.isMultistep && step.internalActionCount > 0) {
    // Multistep: base timeout + time per internal action
    return DEFAULT_STEP_TIMEOUT_MS + step.internalActionCount * TIMEOUT_PER_MULTISTEP_ACTION_MS;
  }
  return DEFAULT_STEP_TIMEOUT_MS;
}

/**
 * Wait for a step to show its completion indicator (L3-3C).
 *
 * Primary completion detection mechanism using DOM polling.
 * The completion indicator appears when:
 * - User clicks "Do it" and action completes
 * - Objectives are satisfied (auto-completion)
 * - Step is skipped
 * - completeEarly is true (completes before action finishes)
 *
 * This function polls for completion more frequently to detect
 * objective-based auto-completion that may happen at any time.
 *
 * @param page - Playwright Page object
 * @param stepId - The step identifier
 * @param timeout - Maximum time to wait (ms), default 30s per design
 */
export async function waitForStepCompletion(
  page: Page,
  stepId: string,
  timeout = DEFAULT_STEP_TIMEOUT_MS
): Promise<void> {
  const completedIndicator = page.getByTestId(testIds.interactive.stepCompleted(stepId));
  await expect(completedIndicator).toBeVisible({ timeout });
}

/**
 * Check if a step has completed via objectives while waiting (L3-3C).
 *
 * Objectives-based auto-completion can happen at any time based on
 * the application state. This function checks if completion occurred
 * without clicking "Do it" (e.g., user navigated to the right page).
 *
 * @param page - Playwright Page object
 * @param stepId - The step identifier
 * @returns true if the step completed via objectives
 */
export async function checkObjectiveCompletion(page: Page, stepId: string): Promise<boolean> {
  const completedIndicator = page.getByTestId(testIds.interactive.stepCompleted(stepId));
  return completedIndicator.isVisible();
}

/**
 * Wait for completion with periodic polling for objective-based auto-completion (L3-3C).
 *
 * This enhanced completion wait function:
 * 1. Periodically checks if the step auto-completed via objectives
 * 2. Uses the standard completion indicator for final detection
 * 3. Provides early exit if objectives are satisfied
 *
 * @param page - Playwright Page object
 * @param stepId - The step identifier
 * @param timeout - Maximum time to wait (ms)
 * @returns Object indicating if completion was via objectives
 */
export async function waitForCompletionWithObjectivePolling(
  page: Page,
  stepId: string,
  timeout: number
): Promise<{ completedViaObjectives: boolean }> {
  const startTime = Date.now();
  const completedIndicator = page.getByTestId(testIds.interactive.stepCompleted(stepId));

  // Poll for completion until timeout
  while (Date.now() - startTime < timeout) {
    // Check if already completed (via objectives or otherwise)
    const isVisible = await completedIndicator.isVisible();

    if (isVisible) {
      // Determine if this was likely an objective completion
      // (completed very quickly after clicking, within 2 poll intervals)
      const elapsed = Date.now() - startTime;
      const likelyObjectiveCompletion = elapsed < COMPLETION_POLL_INTERVAL_MS * 2;
      return { completedViaObjectives: likelyObjectiveCompletion };
    }

    // Wait before next poll
    await page.waitForTimeout(COMPLETION_POLL_INTERVAL_MS);
  }

  // Timeout reached - do one final check with Playwright's built-in expect
  // This will throw TimeoutError if not completed
  await expect(completedIndicator).toBeVisible({ timeout: 1000 });
  return { completedViaObjectives: false };
}

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
export async function executeStep(
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

    // Scroll step into view before interaction
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
      if (step.skippable) {
        // Skippable steps: skip with reason logged
        if (verbose) {
          console.log(`   ⊘ Step ${step.stepId} skipped due to unmet requirements (skippable)`);
        }
        return createSkippedResult(step, page, startTime, consoleErrors, 'requirements_unmet');
      }

      // Mandatory steps: if fix was attempted and failed, report failure
      if (fixResult && !fixResult.success) {
        if (verbose) {
          console.log(
            `   ✗ Step ${step.stepId} failed: requirements not met after ${fixResult.totalAttempts} fix attempts`
          );
        }
        const errorMsg = `Requirements not met after ${fixResult.totalAttempts} fix attempt(s): ${fixResult.failureReason || 'unknown reason'}`;

        // L3-5D: Capture artifacts on failure
        let artifacts: ArtifactPaths | undefined;
        if (artifactsDir) {
          artifacts = await captureFailureArtifacts(page, step.stepId, consoleErrors, artifactsDir);
          // Include PRE screenshot if captured
          if (artifacts && preScreenshotPath) {
            artifacts.screenshotPre = preScreenshotPath;
          } else if (preScreenshotPath) {
            artifacts = { screenshotPre: preScreenshotPath };
          }
          if (verbose && artifacts) {
            console.log(`   📸 Artifacts captured to ${artifactsDir}`);
          }
        }

        return {
          stepId: step.stepId,
          status: 'failed',
          durationMs: Date.now() - startTime,
          currentUrl: page.url(),
          consoleErrors,
          error: errorMsg,
          skippable: step.skippable,
          // L3-5C: Classify the error - requirements failures are typically 'unknown'
          classification: classifyError(errorMsg),
          // L3-5D: Include artifact paths
          artifacts,
        };
      }

      // Mandatory steps without fix button available - proceed to try "Do it"
      // (button may still become enabled via sequential dependencies)
      if (verbose) {
        console.log(`   ⚠ Step ${step.stepId} has unmet requirements but no fix available, attempting execution`);
      }
    }

    // Wait for "Do it" button to appear (handles sequential dependencies)
    // Button may not exist at discovery time but appears after previous step completes
    if (verbose) {
      console.log(`   ⏳ Waiting for "Do it" button to appear...`);
    }
    const buttonAppeared = await waitForDoItButtonToAppear(page, step.stepId);
    if (!buttonAppeared) {
      if (verbose) {
        console.log(`   ⊘ Step ${step.stepId} has no "Do it" button (timeout waiting for appearance), skipping`);
      }
      return createSkippedResult(step, page, startTime, consoleErrors, 'no_do_it_button');
    }

    // L3-3C: Check for objective-based auto-completion BEFORE clicking
    // Objectives may be satisfied by prior actions (e.g., navigation completed the step)
    const preClickCompleted = await checkObjectiveCompletion(page, step.stepId);
    if (preClickCompleted) {
      if (verbose) {
        console.log(`   ✓ Step ${step.stepId} auto-completed via objectives before clicking`);
      }

      // Capture success screenshot if alwaysScreenshot is enabled
      let artifacts: ArtifactPaths | undefined;
      if (artifactsDir && alwaysScreenshot) {
        artifacts = await captureSuccessArtifacts(page, step.stepId, artifactsDir);
        // Include PRE screenshot if captured
        if (artifacts && preScreenshotPath) {
          artifacts.screenshotPre = preScreenshotPath;
        } else if (preScreenshotPath) {
          artifacts = { screenshotPre: preScreenshotPath };
        }
        if (verbose && artifacts) {
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
        artifacts,
      };
    }

    // L3-3C: Wait for "Do it" button to be enabled (U3: sequential dependencies)
    // Uses dedicated timeout constant for button enablement
    if (verbose && step.isMultistep) {
      console.log(
        `   ⏱ Multistep detected (${step.internalActionCount} actions), timeout: ${Math.round(timeout / 1000)}s`
      );
    }

    await waitForDoItButtonEnabled(page, step.stepId, BUTTON_ENABLE_TIMEOUT_MS);

    // Click "Do it" button
    const doItButton = page.getByTestId(testIds.interactive.doItButton(step.stepId));
    const urlBeforeClick = page.url();
    await doItButton.click();
    const urlAfterClick = page.url();

    if (verbose) {
      console.log(`   → Clicked "Do it" for step ${step.stepId}`);
    }

    // L3-3C: Allow reactive system to settle after click
    // Per design doc: debounced rechecks (500ms context, 1200ms DOM)
    await page.waitForTimeout(POST_CLICK_SETTLE_DELAY_MS);

    // FIX: Handle case where navigation causes step element to unmount
    // For highlight actions on nav links, clicking "Do it" navigates the page.
    // This can cause the step component to unmount before showing the completion indicator.
    // If URL changed AND step element no longer exists, the action succeeded - treat as passed.
    const urlChanged = urlBeforeClick !== urlAfterClick;
    if (urlChanged) {
      const stepElementExists = (await page.locator(`[data-testid="interactive-step-${step.stepId}"]`).count()) > 0;
      if (!stepElementExists) {
        if (verbose) {
          console.log(`   ✓ Step ${step.stepId} completed via navigation (element unmounted)`);
        }

        // Capture success screenshot if alwaysScreenshot is enabled
        let navSuccessArtifacts: ArtifactPaths | undefined;
        if (artifactsDir && alwaysScreenshot) {
          navSuccessArtifacts = await captureSuccessArtifacts(page, step.stepId, artifactsDir);
          if (navSuccessArtifacts && preScreenshotPath) {
            navSuccessArtifacts.screenshotPre = preScreenshotPath;
          } else if (preScreenshotPath) {
            navSuccessArtifacts = { screenshotPre: preScreenshotPath };
          }
        }

        return {
          stepId: step.stepId,
          status: 'passed',
          durationMs: Date.now() - startTime,
          currentUrl: page.url(),
          consoleErrors,
          skippable: step.skippable,
          artifacts: navSuccessArtifacts,
        };
      }
    }

    // L3-3C: Wait for step completion with objective polling
    // This detects both manual completion and objective-based auto-completion
    const { completedViaObjectives } = await waitForCompletionWithObjectivePolling(page, step.stepId, timeout);

    if (verbose && completedViaObjectives) {
      console.log(`   ℹ Step ${step.stepId} completed quickly (possibly via objectives)`);
    }

    // Capture success screenshot if alwaysScreenshot is enabled
    let successArtifacts: ArtifactPaths | undefined;
    if (artifactsDir && alwaysScreenshot) {
      successArtifacts = await captureSuccessArtifacts(page, step.stepId, artifactsDir);
      // Include PRE screenshot if captured
      if (successArtifacts && preScreenshotPath) {
        successArtifacts.screenshotPre = preScreenshotPath;
      } else if (preScreenshotPath) {
        successArtifacts = { screenshotPre: preScreenshotPath };
      }
      if (verbose && successArtifacts) {
        console.log(`   📸 Success screenshot captured`);
      }
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
    let artifacts: ArtifactPaths | undefined;
    if (artifactsDir) {
      artifacts = await captureFailureArtifacts(page, step.stepId, consoleErrors, artifactsDir);
      // Include PRE screenshot if captured
      if (artifacts && preScreenshotPath) {
        artifacts.screenshotPre = preScreenshotPath;
      } else if (preScreenshotPath) {
        artifacts = { screenshotPre: preScreenshotPath };
      }
      if (verbose && artifacts) {
        console.log(`   📸 Artifacts captured to ${artifactsDir}`);
      }
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
 * - Skippable step failures do NOT fail the overall test
 * - Only mandatory step failures count against success
 *
 * @param results - Array of step test results
 * @returns Summary object with counts and overall status
 */
export function summarizeResults(results: StepTestResult[]): {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  notReached: number;
  /** L3-4C: Count of mandatory step failures (determines overall success) */
  mandatoryFailed: number;
  /** L3-4C: Count of skippable step failures (do not affect overall success) */
  skippableFailed: number;
  success: boolean;
  totalDurationMs: number;
} {
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
    // L3-4C: Only mandatory failures count against overall success
    // Per design doc: "Skippable step failures do NOT fail the overall test"
    success: mandatoryFailed === 0,
    totalDurationMs: results.reduce((sum, r) => sum + r.durationMs, 0),
  };
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
      console.log(`      └─ Skippable: ${summary.skippableFailed} (does not affect result)`);
    }
  } else {
    console.log(`   ✗ Failed: 0`);
  }

  console.log(`   ⊘ Skipped: ${summary.skipped}`);
  console.log(`   ○ Not reached: ${summary.notReached}`);
  console.log(`   Total duration: ${summary.totalDurationMs}ms`);
  console.log(`   Overall: ${summary.success ? '✅ SUCCESS' : '❌ FAILURE'}`);
}
