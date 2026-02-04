/**
 * Guide Test Runner Utilities
 *
 * Provides utilities for discovering and testing interactive steps in guide documents.
 * This module implements DOM-based step discovery per the E2E Test Runner design.
 *
 * @see tests/e2e-runner/design/e2e-test-runner-design.md
 * @see tests/e2e-runner/design/L3-phase1-verification-results.md
 */

import { Page, Locator, expect } from '@playwright/test';
import { testIds } from '../../../src/components/testIds';

// ============================================
// Types
// ============================================

/**
 * A step discovered from the rendered DOM.
 *
 * This interface captures the essential metadata needed to test a step,
 * including edge cases identified in L3 Phase 1 verification:
 * - U1: Not all steps have "Do it" buttons (doIt: false, noop actions)
 * - U2: Steps can pre-complete via objectives before clicking
 * - U3: Steps may not be clickable when discovered (sequential dependencies)
 */
export interface TestableStep {
  /** Unique identifier for the step (extracted from data-testid) */
  stepId: string;

  /** Zero-based index in DOM order (top to bottom) */
  index: number;

  /** Parent section ID, if the step is within an interactive section */
  sectionId?: string;

  /** Whether the step can be skipped if requirements fail */
  skippable: boolean;

  /** Whether a "Do it" button exists for this step (U1) */
  hasDoItButton: boolean;

  /** Whether the step is already completed (U2 - objectives/noop) */
  isPreCompleted: boolean;

  /** The target action type (highlight, button, navigate, formfill, noop, multistep, etc.) */
  targetAction?: string;

  /**
   * Whether this is a multistep action (L3-3C).
   * Multisteps require longer timeouts as they execute multiple internal actions.
   */
  isMultistep: boolean;

  /**
   * Number of internal actions for multisteps (L3-3C).
   * Used to calculate appropriate timeout: 30s base + 5s per action.
   */
  internalActionCount: number;

  /** Locator for the step element (for convenience in later operations) */
  locator: Locator;
}

/**
 * Result of step discovery operation.
 */
export interface StepDiscoveryResult {
  /** All discovered steps in DOM order */
  steps: TestableStep[];

  /** Total count of steps found */
  totalSteps: number;

  /** Count of steps that are pre-completed */
  preCompletedCount: number;

  /** Count of steps without "Do it" buttons */
  noDoItButtonCount: number;

  /** Duration of discovery in milliseconds */
  durationMs: number;
}

/**
 * Status of a step execution.
 */
export type StepStatus = 'passed' | 'failed' | 'skipped' | 'not_reached';

/**
 * Reason why a step was skipped.
 */
export type SkipReason =
  | 'pre_completed' // Step was already completed before execution
  | 'no_do_it_button' // Step doesn't have a "Do it" button (doIt: false or noop)
  | 'requirements_unmet'; // Step requirements couldn't be satisfied (future milestone)

/**
 * Result of executing a single step.
 *
 * Captures diagnostics for debugging and reporting:
 * - Status: passed, failed, skipped, or not_reached
 * - Duration: execution time in ms
 * - URL: page URL when step completed (useful for navigation steps)
 * - Console errors: any console.error() calls during execution
 * - Error message: if status is 'failed'
 * - Skip reason: if status is 'skipped'
 */
export interface StepTestResult {
  /** The step identifier */
  stepId: string;

  /** Execution outcome */
  status: StepStatus;

  /** Execution duration in milliseconds */
  durationMs: number;

  /** Page URL when step completed/failed */
  currentUrl: string;

  /** Console errors captured during step execution */
  consoleErrors: string[];

  /** Error message if status is 'failed' */
  error?: string;

  /** Reason if status is 'skipped' */
  skipReason?: SkipReason;
}

// ============================================
// Constants
// ============================================

/**
 * Selector pattern for interactive step elements.
 * Steps are identified by data-testid starting with "interactive-step-".
 */
const STEP_SELECTOR = '[data-testid^="interactive-step-"]';

/**
 * Prefix to strip from data-testid to get the step ID.
 */
const STEP_TESTID_PREFIX = 'interactive-step-';

/**
 * Selector pattern for interactive sections (parent containers of steps).
 */
const SECTION_SELECTOR = '[data-testid^="interactive-section-"]';

// ============================================
// Timing Constants (L3-3C)
// ============================================

/**
 * Default timeout for waiting for step completion.
 * Per design doc: 30 seconds as a generous default.
 */
const DEFAULT_STEP_TIMEOUT_MS = 30000;

/**
 * Additional timeout per internal action for multisteps.
 * Per design doc: 30s base + 5s per action.
 */
const TIMEOUT_PER_MULTISTEP_ACTION_MS = 5000;

/**
 * Timeout for waiting for "Do it" button to become enabled.
 * Sequential dependencies (isEligibleForChecking) may disable buttons.
 */
const BUTTON_ENABLE_TIMEOUT_MS = 10000;

/**
 * Delay after scrolling to allow animations to settle.
 * Per design doc: 300ms for scroll animation.
 */
const SCROLL_SETTLE_DELAY_MS = 300;

/**
 * Delay after clicking "Do it" before checking completion.
 * Allows the reactive system to settle (debounced rechecks: 500ms context, 1200ms DOM).
 */
const POST_CLICK_SETTLE_DELAY_MS = 500;

/**
 * Polling interval for checking completion during wait.
 * Used for detecting objective-based auto-completion.
 */
const COMPLETION_POLL_INTERVAL_MS = 250;

// ============================================
// Discovery Functions
// ============================================

/**
 * Discover all testable steps from the rendered DOM.
 *
 * This function implements DOM-based step discovery per the design document.
 * It queries the page for interactive step elements and extracts metadata
 * needed for test execution.
 *
 * Key behaviors:
 * - Steps are returned in document order (top to bottom)
 * - Pre-completed steps are detected (completion indicator visible)
 * - Steps without "Do it" buttons are flagged (doIt: false or noop actions)
 * - Skippable flag is determined by presence of skip button
 *
 * @param page - Playwright Page object
 * @returns StepDiscoveryResult with all discovered steps and statistics
 *
 * @example
 * ```typescript
 * const result = await discoverStepsFromDOM(page);
 * console.log(`Found ${result.totalSteps} steps`);
 * for (const step of result.steps) {
 *   if (step.isPreCompleted) {
 *     console.log(`Step ${step.stepId} already completed`);
 *   }
 * }
 * ```
 */
export async function discoverStepsFromDOM(page: Page): Promise<StepDiscoveryResult> {
  const startTime = Date.now();
  const steps: TestableStep[] = [];

  // Query all rendered step elements in DOM order
  const stepElements = await page.locator(STEP_SELECTOR).all();

  for (let index = 0; index < stepElements.length; index++) {
    const element = stepElements[index];

    // Extract step ID from data-testid attribute
    const dataTestId = await element.getAttribute('data-testid');
    if (!dataTestId) {
      console.warn(`Step at index ${index} missing data-testid attribute, skipping`);
      continue;
    }

    const stepId = dataTestId.replace(STEP_TESTID_PREFIX, '');

    // Extract target action type from data-targetaction attribute
    const targetAction = (await element.getAttribute('data-targetaction')) ?? undefined;

    // Check if "Do it" button exists (U1: not all steps have buttons)
    const hasDoItButton = await checkDoItButtonExists(page, stepId);

    // Check if already completed (U2: objectives-based or noop completion)
    const isPreCompleted = await checkStepCompleted(page, stepId);

    // Check if step is skippable (presence of skip button indicates skippable)
    // Note: Skip button only renders when step is skippable AND not completed
    const skippable = await checkStepSkippable(page, stepId, isPreCompleted, targetAction);

    // Try to find parent section ID
    const sectionId = await findParentSectionId(element);

    // L3-3C: Detect multisteps and extract internal action count for timeout calculation
    const { isMultistep, internalActionCount } = await extractMultistepInfo(element, targetAction);

    steps.push({
      stepId,
      index,
      sectionId,
      skippable,
      hasDoItButton,
      isPreCompleted,
      targetAction,
      isMultistep,
      internalActionCount,
      locator: element,
    });
  }

  const durationMs = Date.now() - startTime;

  return {
    steps,
    totalSteps: steps.length,
    preCompletedCount: steps.filter((s) => s.isPreCompleted).length,
    noDoItButtonCount: steps.filter((s) => !s.hasDoItButton).length,
    durationMs,
  };
}

/**
 * Check if a "Do it" button exists for the given step.
 *
 * Per U1 findings: Not all steps have "Do it" buttons.
 * - Steps with `doIt: false` don't render the button
 * - Steps with `targetAction: 'noop'` are informational-only
 *
 * @param page - Playwright Page object
 * @param stepId - The step identifier
 * @returns true if the "Do it" button exists
 */
async function checkDoItButtonExists(page: Page, stepId: string): Promise<boolean> {
  const doItButton = page.getByTestId(testIds.interactive.doItButton(stepId));
  const count = await doItButton.count();
  return count > 0;
}

/**
 * Check if a step is already completed.
 *
 * Per U2 findings: Steps can complete via:
 * - Objectives satisfaction before user clicks "Do it"
 * - Noop actions that auto-complete when eligible
 * - `completeEarly: true` flag
 *
 * @param page - Playwright Page object
 * @param stepId - The step identifier
 * @returns true if the completion indicator is visible
 */
async function checkStepCompleted(page: Page, stepId: string): Promise<boolean> {
  const completedIndicator = page.getByTestId(testIds.interactive.stepCompleted(stepId));
  return completedIndicator.isVisible();
}

/**
 * Determine if a step is skippable.
 *
 * Detection strategy:
 * 1. If step is already completed, we can't detect skip button - assume not skippable
 * 2. If step has noop action, it's not skippable (auto-completes)
 * 3. Otherwise, check for skip button presence
 *
 * Note: The skip button only renders when:
 * - `skippable` prop is true
 * - Not a noop action
 * - Not already completed
 *
 * @param page - Playwright Page object
 * @param stepId - The step identifier
 * @param isPreCompleted - Whether step is already completed
 * @param targetAction - The action type (if known)
 * @returns true if the step is skippable
 */
async function checkStepSkippable(
  page: Page,
  stepId: string,
  isPreCompleted: boolean,
  targetAction?: string
): Promise<boolean> {
  // Noop actions are informational-only, not skippable
  if (targetAction === 'noop') {
    return false;
  }

  // If already completed, skip button won't be visible
  // Default to false for completed steps (conservative assumption)
  if (isPreCompleted) {
    return false;
  }

  // Check for skip button presence
  const skipButton = page.getByTestId(testIds.interactive.skipButton(stepId));
  const count = await skipButton.count();
  return count > 0;
}

/**
 * Find the parent section ID for a step element.
 *
 * Walks up the DOM tree looking for an interactive section container.
 *
 * @param stepElement - Locator for the step element
 * @returns Section ID if found, undefined otherwise
 */
async function findParentSectionId(stepElement: Locator): Promise<string | undefined> {
  // Get the closest ancestor with section test ID pattern
  // We use evaluate to walk up the DOM tree since Playwright doesn't have a direct "closest" method
  const sectionId = await stepElement.evaluate((el) => {
    const section = el.closest('[data-testid^="interactive-section-"]');
    if (!section) return null;

    const testId = section.getAttribute('data-testid');
    if (!testId) return null;

    return testId.replace('interactive-section-', '');
  });

  return sectionId ?? undefined;
}

/**
 * Extract multistep information from a step element (L3-3C).
 *
 * Multisteps have data-targetaction="multistep" and data-internal-actions
 * containing a JSON array of internal action definitions.
 *
 * @param stepElement - Locator for the step element
 * @param targetAction - Already-extracted target action type
 * @returns Object with isMultistep flag and internal action count
 */
async function extractMultistepInfo(
  stepElement: Locator,
  targetAction?: string
): Promise<{ isMultistep: boolean; internalActionCount: number }> {
  // Quick check: if targetAction isn't "multistep", skip the expensive DOM read
  if (targetAction !== 'multistep') {
    return { isMultistep: false, internalActionCount: 0 };
  }

  // Extract internal actions count from data-internal-actions attribute
  const internalActionsJson = await stepElement.getAttribute('data-internal-actions');

  if (!internalActionsJson) {
    // Fallback: it's a multistep but we couldn't get the count, assume 3 actions
    return { isMultistep: true, internalActionCount: 3 };
  }

  try {
    const internalActions = JSON.parse(internalActionsJson);
    const count = Array.isArray(internalActions) ? internalActions.length : 0;
    return { isMultistep: true, internalActionCount: count };
  } catch {
    // JSON parse failed, assume 3 actions as fallback
    return { isMultistep: true, internalActionCount: 3 };
  }
}

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

/**
 * Log step discovery results in a human-readable format.
 *
 * @param result - The step discovery result
 * @param verbose - Whether to log detailed per-step information
 */
export function logDiscoveryResults(result: StepDiscoveryResult, verbose = false): void {
  // Count multisteps for summary
  const multistepCount = result.steps.filter((s) => s.isMultistep).length;

  console.log(`\n📋 Step Discovery Results`);
  console.log(`   Total steps: ${result.totalSteps}`);
  console.log(`   Pre-completed: ${result.preCompletedCount}`);
  console.log(`   Without "Do it": ${result.noDoItButtonCount}`);
  if (multistepCount > 0) {
    console.log(`   Multisteps: ${multistepCount}`);
  }
  console.log(`   Discovery time: ${result.durationMs}ms`);

  if (verbose && result.steps.length > 0) {
    console.log(`\n   Steps:`);
    for (const step of result.steps) {
      const flags = [
        step.isPreCompleted ? 'pre-completed' : null,
        !step.hasDoItButton ? 'no-button' : null,
        step.skippable ? 'skippable' : null,
        step.isMultistep ? `multistep:${step.internalActionCount}` : null,
      ]
        .filter(Boolean)
        .join(', ');

      const flagsStr = flags ? ` (${flags})` : '';
      const actionStr = step.targetAction ? ` [${step.targetAction}]` : '';
      const sectionStr = step.sectionId ? ` in section:${step.sectionId}` : '';

      // L3-3C: Show calculated timeout for multisteps in verbose mode
      const timeoutStr = step.isMultistep ? ` timeout:${Math.round(calculateStepTimeout(step) / 1000)}s` : '';

      console.log(`   ${step.index + 1}. ${step.stepId}${actionStr}${sectionStr}${flagsStr}${timeoutStr}`);
    }
  }
}

// ============================================
// Step Execution Functions (L3-3C Enhanced)
// ============================================

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
 *
 * Timing enhancements (L3-3C):
 * - Sequential dependencies: 10s timeout for button enable
 * - Multisteps: Dynamic timeout (30s base + 5s per internal action)
 * - Objective completion: Polling during wait to detect auto-completion
 * - Settle delays: Post-scroll and post-click delays for reactive system
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
  } = {}
): Promise<StepTestResult> {
  // L3-3C: Calculate appropriate timeout based on step type
  const calculatedTimeout = calculateStepTimeout(step);
  const { timeout = calculatedTimeout, verbose = false } = options;
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

  try {
    // Handle pre-completed steps (U2: objectives/noop auto-completion)
    if (step.isPreCompleted) {
      if (verbose) {
        console.log(`   ⊘ Step ${step.stepId} already completed (discovered as pre-completed)`);
      }
      return createSkippedResult(step, page, startTime, consoleErrors, 'pre_completed');
    }

    // Handle steps without "Do it" buttons (U1: doIt: false, noop actions)
    if (!step.hasDoItButton) {
      if (verbose) {
        console.log(`   ⊘ Step ${step.stepId} has no "Do it" button, skipping`);
      }
      return createSkippedResult(step, page, startTime, consoleErrors, 'no_do_it_button');
    }

    // Scroll step into view before interaction
    await scrollStepIntoView(page, step.stepId, SCROLL_SETTLE_DELAY_MS);

    // L3-3C: Check for objective-based auto-completion BEFORE clicking
    // Objectives may be satisfied by prior actions (e.g., navigation completed the step)
    const preClickCompleted = await checkObjectiveCompletion(page, step.stepId);
    if (preClickCompleted) {
      if (verbose) {
        console.log(`   ✓ Step ${step.stepId} auto-completed via objectives before clicking`);
      }
      return {
        stepId: step.stepId,
        status: 'passed',
        durationMs: Date.now() - startTime,
        currentUrl: page.url(),
        consoleErrors,
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
    await doItButton.click();

    if (verbose) {
      console.log(`   → Clicked "Do it" for step ${step.stepId}`);
    }

    // L3-3C: Allow reactive system to settle after click
    // Per design doc: debounced rechecks (500ms context, 1200ms DOM)
    await page.waitForTimeout(POST_CLICK_SETTLE_DELAY_MS);

    // L3-3C: Wait for step completion with objective polling
    // This detects both manual completion and objective-based auto-completion
    const { completedViaObjectives } = await waitForCompletionWithObjectivePolling(page, step.stepId, timeout);

    if (verbose && completedViaObjectives) {
      console.log(`   ℹ Step ${step.stepId} completed quickly (possibly via objectives)`);
    }

    // Return success result with diagnostics
    return {
      stepId: step.stepId,
      status: 'passed',
      durationMs: Date.now() - startTime,
      currentUrl: page.url(),
      consoleErrors,
    };
  } catch (error) {
    // Return failure result with error details
    return {
      stepId: step.stepId,
      status: 'failed',
      durationMs: Date.now() - startTime,
      currentUrl: page.url(),
      consoleErrors,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    // REACT: cleanup subscription (R1) - Clean up console handler to prevent memory leaks
    page.off('console', consoleHandler);
  }
}

/**
 * Execute all discovered steps in sequence.
 *
 * This is a convenience function that iterates through all steps and
 * executes them in order. It handles:
 * - Pre-completed steps (skipped)
 * - Steps without "Do it" buttons (skipped)
 * - Failed mandatory steps (stops execution, marks remaining as not_reached)
 *
 * Note: This is the happy path implementation. Requirements handling
 * and skip/mandatory logic refinements are in later milestones.
 *
 * @param page - Playwright Page object
 * @param steps - Array of testable steps to execute
 * @param options - Execution options
 * @returns Array of StepTestResult for all steps
 */
export async function executeAllSteps(
  page: Page,
  steps: TestableStep[],
  options: {
    timeout?: number;
    verbose?: boolean;
    stopOnMandatoryFailure?: boolean;
  } = {}
): Promise<StepTestResult[]> {
  const { verbose = false, stopOnMandatoryFailure = true } = options;
  const results: StepTestResult[] = [];
  let aborted = false;

  if (verbose) {
    console.log(`\n🚀 Executing ${steps.length} steps...`);
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
      });
      continue;
    }

    if (verbose) {
      console.log(`\n   [${i + 1}/${steps.length}] Step: ${step.stepId}`);
    }

    const result = await executeStep(page, step, options);
    results.push(result);

    // Log result
    if (verbose) {
      logStepResult(result);
    }

    // Check if we should stop on mandatory failure
    // Note: For L3-3B (happy path), we treat all failures as stopping the test
    // The skip/mandatory logic refinement is in L3-4C
    if (result.status === 'failed' && stopOnMandatoryFailure) {
      if (verbose) {
        console.log(`   ❌ Mandatory step failed, aborting remaining steps`);
      }
      aborted = true;
    }
  }

  return results;
}

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
  };
}

/**
 * Log a step execution result in a human-readable format.
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
 * Summarize execution results.
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
  success: boolean;
  totalDurationMs: number;
} {
  const counts = {
    total: results.length,
    passed: results.filter((r) => r.status === 'passed').length,
    failed: results.filter((r) => r.status === 'failed').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    notReached: results.filter((r) => r.status === 'not_reached').length,
  };

  return {
    ...counts,
    success: counts.failed === 0,
    totalDurationMs: results.reduce((sum, r) => sum + r.durationMs, 0),
  };
}

/**
 * Log execution summary in a human-readable format.
 *
 * @param results - Array of step test results
 */
export function logExecutionSummary(results: StepTestResult[]): void {
  const summary = summarizeResults(results);

  console.log(`\n📊 Execution Summary`);
  console.log(`   Total steps: ${summary.total}`);
  console.log(`   ✓ Passed: ${summary.passed}`);
  console.log(`   ✗ Failed: ${summary.failed}`);
  console.log(`   ⊘ Skipped: ${summary.skipped}`);
  console.log(`   ○ Not reached: ${summary.notReached}`);
  console.log(`   Total duration: ${summary.totalDurationMs}ms`);
  console.log(`   Overall: ${summary.success ? '✅ SUCCESS' : '❌ FAILURE'}`);
}
