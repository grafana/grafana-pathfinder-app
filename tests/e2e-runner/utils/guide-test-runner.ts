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
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { testIds } from '../../../src/components/testIds';
import { isSessionValid } from '../auth/grafana-auth';

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

  /**
   * The target element selector (L3-4A).
   * Extracted from data-reftarget attribute.
   */
  refTarget?: string;

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
  | 'requirements_unmet'; // Step requirements couldn't be satisfied

// ============================================
// Requirements Detection Types (L3-4A)
// ============================================

/**
 * Status of a step's requirements (L3-4A).
 */
export type RequirementStatus =
  | 'met' // All requirements satisfied
  | 'unmet' // Requirements not satisfied
  | 'checking' // Requirements are being checked
  | 'unknown'; // Requirements status cannot be determined

/**
 * Type of fix available for a requirement (L3-4A).
 *
 * Per design doc: Fix buttons trigger different actions based on fixType.
 */
export type RequirementFixType =
  | 'navigation' // Click mega-menu, expand sections
  | 'location' // Navigate to a specific path
  | 'expand-parent-navigation' // Expand collapsed nav section
  | 'lazy-scroll'; // Scroll container to discover element

/**
 * Result of detecting requirements for a step (L3-4A).
 *
 * Captures all requirement-related information for decision making
 * in L3-4B (Fix Button Execution) and L3-4C (Skippable vs Mandatory Logic).
 */
export interface RequirementResult {
  /** Whether all requirements are met */
  requirementsMet: boolean;

  /** Current status of requirements */
  status: RequirementStatus;

  /** Whether a fix button is available */
  hasFixButton: boolean;

  /** Type of fix available (if hasFixButton is true) */
  fixType?: RequirementFixType;

  /** Whether the step is skippable */
  skippable: boolean;

  /** Human-readable explanation text from the UI */
  explanationText?: string;

  /** Whether requirements are currently being checked */
  isChecking: boolean;

  /** Whether a skip button is available */
  hasSkipButton: boolean;

  /** Whether a retry button is available (non-fixable requirement failure) */
  hasRetryButton: boolean;
}

// ============================================
// Fix Button Execution Types (L3-4B)
// ============================================

/**
 * Result of a single fix button click attempt (L3-4B).
 */
export interface FixAttemptResult {
  /** Whether the fix attempt succeeded (requirements now met) */
  success: boolean;

  /** The attempt number (1-based) */
  attemptNumber: number;

  /** Duration of the fix attempt in ms */
  durationMs: number;

  /** Error message if the fix failed */
  error?: string;

  /** Whether requirements were met after this attempt */
  requirementsMet: boolean;
}

/**
 * Result of attempting to fix requirements (L3-4B).
 *
 * Captures all fix attempt results and the final outcome.
 */
export interface FixResult {
  /** Whether requirements were ultimately satisfied */
  success: boolean;

  /** Total number of fix attempts made */
  totalAttempts: number;

  /** Individual attempt results */
  attempts: FixAttemptResult[];

  /** Total duration of all fix attempts */
  totalDurationMs: number;

  /** Final requirements status */
  finalStatus: RequirementStatus;

  /** Reason if fix failed */
  failureReason?: string;
}

/**
 * Reason why test execution was aborted (L3-3D).
 */
export type AbortReason =
  | 'AUTH_EXPIRED' // Session expired mid-test
  | 'MANDATORY_FAILURE'; // A mandatory step failed

// ============================================
// Artifact Collection Types (L3-5D)
// ============================================

/**
 * Paths to captured failure artifacts (L3-5D).
 *
 * Artifacts are captured when a step fails to provide debugging context
 * in CI environments where you can't watch the browser.
 *
 * @see tests/e2e-runner/design/e2e-test-runner-design.md#artifact-collection-on-failure
 */
export interface ArtifactPaths {
  /** Path to screenshot PNG file (POST step execution) */
  screenshot?: string;
  /** Path to screenshot PNG file (PRE step execution) */
  screenshotPre?: string;
  /** Path to DOM snapshot HTML file */
  dom?: string;
  /** Path to console errors JSON file */
  console?: string;
}

// ============================================
// Error Classification Types (L3-5C)
// ============================================

/**
 * Error classification for failure triage (L3-5C).
 *
 * Per design doc MVP approach:
 * - Only `infrastructure` can be reliably auto-classified
 * - All other failures default to `unknown` and require human triage
 *
 * Classification types (for future use):
 * - `content-drift`: Selector/requirement issues → Content team
 * - `product-regression`: Action failures → Product team
 * - `infrastructure`: TIMEOUT/NETWORK/AUTH → Environmental
 * - `unknown`: Default for anything that can't be reliably classified
 *
 * @see tests/e2e-runner/design/e2e-test-runner-design.md#error-classification
 */
export type ErrorClassification =
  | 'content-drift' // Selector/requirement issues (requires human validation)
  | 'product-regression' // Action failures (requires human validation)
  | 'infrastructure' // TIMEOUT, NETWORK_ERROR, AUTH_EXPIRED
  | 'unknown'; // Default - cannot be reliably classified

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
 * - Skippable: whether the step was marked as skippable (L3-4C)
 * - Classification: error classification for triage (L3-5C)
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

  /**
   * Whether the step was skippable (L3-4C).
   * Used to determine if failures count against overall test success.
   * Per design doc: skippable step failures do NOT fail the overall test.
   */
  skippable: boolean;

  /**
   * Error classification for failure triage (L3-5C).
   * Only present for failed steps.
   * Per design doc MVP: only `infrastructure` is auto-classified,
   * all others default to `unknown`.
   */
  classification?: ErrorClassification;

  /**
   * Paths to artifacts captured on failure (L3-5D).
   * Only present for failed steps when artifacts directory is configured.
   * Contains screenshot and DOM snapshot for debugging.
   */
  artifacts?: ArtifactPaths;
}

/**
 * Result of executing all steps (L3-3D).
 *
 * Extends the array of step results with abort information
 * for graceful handling of session expiry and mandatory failures.
 */
export interface AllStepsResult {
  /** Individual step results */
  results: StepTestResult[];

  /** Whether execution was aborted before completing all steps */
  aborted: boolean;

  /** Reason for abort if aborted is true */
  abortReason?: AbortReason;

  /** Human-readable abort message */
  abortMessage?: string;

  /** Path to final screenshot (only when alwaysScreenshot is enabled) */
  finalScreenshot?: string;
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
 * Timeout for waiting for "Do it" button to appear.
 * Longer than enable timeout since it needs to wait for
 * previous step completion in sequential sections.
 */
const BUTTON_APPEAR_TIMEOUT_MS = 15000;

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
// Session Validation Constants (L3-3D)
// ============================================

/**
 * Default number of steps between session validation checks.
 * Per design doc: validate session every 5 steps to detect expiry before cryptic failures.
 */
const DEFAULT_SESSION_CHECK_INTERVAL = 5;

/**
 * Timeout for session validation API call.
 * Should be short since this is a lightweight check.
 */
const SESSION_VALIDATION_TIMEOUT_MS = 5000;

// ============================================
// Requirements Detection Constants (L3-4A)
// ============================================

/**
 * Timeout for waiting for requirements checking to complete.
 * Requirements checking involves async operations (API calls, DOM checks).
 */
const REQUIREMENTS_CHECK_TIMEOUT_MS = 10000;

/**
 * Polling interval for checking if requirements are still being checked.
 */
const REQUIREMENTS_POLL_INTERVAL_MS = 200;

// ============================================
// Fix Button Execution Constants (L3-4B)
// ============================================

/**
 * Timeout for individual fix button operation.
 * Per design doc: 10s per fix operation.
 */
const FIX_BUTTON_TIMEOUT_MS = 10000;

/**
 * Maximum number of fix attempts before giving up.
 * Per design doc: 3 attempts (reduced from original 10 for faster failure).
 */
const MAX_FIX_ATTEMPTS = 3;

/**
 * Delay after fix button click to allow the fix action to complete.
 * Navigation fixes may involve page loads and menu animations.
 */
const POST_FIX_SETTLE_DELAY_MS = 1000;

/**
 * Delay after navigation fix to wait for page load completion.
 * Location fixes trigger navigation which needs time to settle.
 */
const NAVIGATION_FIX_SETTLE_DELAY_MS = 2000;

// ============================================
// Error Classification Functions (L3-5C)
// ============================================

/**
 * Patterns for identifying infrastructure errors (L3-5C).
 *
 * These patterns indicate environmental/infrastructure issues that
 * are unlikely to be caused by guide content or product code changes.
 */
const INFRASTRUCTURE_ERROR_PATTERNS = [
  // Timeout patterns - environmental/performance issues
  /timeout/i,
  /timed out/i,
  /waiting for/i, // "Timeout waiting for X"
  /exceeded/i, // "Timeout exceeded"

  // Network patterns - connectivity issues
  /network/i,
  /net::/i, // Chrome network errors like net::ERR_*
  /fetch failed/i,
  /econnrefused/i,
  /enotfound/i,
  /connection refused/i,
  /connection reset/i,
  /dns/i,

  // Auth patterns - session/authentication issues
  /auth.*expir/i,
  /session.*expir/i,
  /unauthorized/i,
  /401/,
  /403.*forbidden/i,

  // Browser/Playwright infrastructure
  /browser.*closed/i,
  /target.*closed/i,
  /page.*crashed/i,
  /context.*destroyed/i,
] as const;

/**
 * Classify an error for failure triage (L3-5C).
 *
 * Per design doc MVP approach:
 * - TIMEOUT, NETWORK_ERROR, AUTH_EXPIRED → `infrastructure`
 * - Everything else → `unknown` (requires human triage)
 *
 * This function analyzes error messages to determine classification.
 * Only high-confidence infrastructure patterns are auto-classified.
 * All ambiguous cases default to `unknown` to avoid misrouting.
 *
 * @param error - Error message to classify
 * @param abortReason - Optional abort reason (AUTH_EXPIRED is always infrastructure)
 * @returns ErrorClassification
 *
 * @example
 * ```typescript
 * classifyError('Timeout waiting for step completion')  // → 'infrastructure'
 * classifyError('net::ERR_CONNECTION_REFUSED')          // → 'infrastructure'
 * classifyError('Element not found')                    // → 'unknown'
 * classifyError(undefined, 'AUTH_EXPIRED')              // → 'infrastructure'
 * ```
 */
export function classifyError(error?: string, abortReason?: AbortReason): ErrorClassification {
  // AUTH_EXPIRED abort is always infrastructure
  if (abortReason === 'AUTH_EXPIRED') {
    return 'infrastructure';
  }

  // No error message means we can't classify
  if (!error) {
    return 'unknown';
  }

  // Check if error matches any infrastructure patterns
  const isInfrastructure = INFRASTRUCTURE_ERROR_PATTERNS.some((pattern) => pattern.test(error));

  if (isInfrastructure) {
    return 'infrastructure';
  }

  // Default to unknown for all other errors
  // Per design doc: "default to `unknown` and require human triage"
  return 'unknown';
}

// ============================================
// Artifact Collection Functions (L3-5D)
// ============================================

/**
 * Capture failure artifacts (screenshot, DOM snapshot, console errors) (L3-5D).
 *
 * This function captures diagnostic artifacts when a step fails to provide
 * debugging context in CI environments where you can't watch the browser.
 *
 * Per design doc:
 * - Screenshot: PNG image of visual state at failure
 * - DOM snapshot: HTML element structure for selector debugging
 * - Console errors: JSON file with console.error() calls during step
 *
 * Artifacts are only captured for failed steps to save space.
 *
 * @param page - Playwright Page object
 * @param stepId - The step identifier (used in filenames)
 * @param consoleErrors - Console errors captured during step execution
 * @param artifactsDir - Directory to write artifacts to
 * @returns ArtifactPaths with paths to captured files, undefined if capture fails
 *
 * @example
 * ```typescript
 * const artifacts = await captureFailureArtifacts(page, 'step-1', errors, './artifacts');
 * // artifacts.screenshot = './artifacts/step-1-failure.png'
 * // artifacts.dom = './artifacts/step-1-dom.html'
 * // artifacts.console = './artifacts/step-1-console.json'
 * ```
 */
export async function captureFailureArtifacts(
  page: Page,
  stepId: string,
  consoleErrors: string[],
  artifactsDir: string
): Promise<ArtifactPaths | undefined> {
  try {
    // Ensure artifacts directory exists
    mkdirSync(artifactsDir, { recursive: true });

    const artifacts: ArtifactPaths = {};

    // Capture screenshot
    const screenshotPath = join(artifactsDir, `${stepId}-failure.png`);
    try {
      await page.screenshot({ path: screenshotPath, fullPage: false });
      artifacts.screenshot = screenshotPath;
    } catch (screenshotError) {
      console.warn(
        `   ⚠ Failed to capture screenshot: ${screenshotError instanceof Error ? screenshotError.message : 'Unknown error'}`
      );
    }

    // Capture DOM snapshot
    const domPath = join(artifactsDir, `${stepId}-dom.html`);
    try {
      const html = await page.content();
      writeFileSync(domPath, html, 'utf-8');
      artifacts.dom = domPath;
    } catch (domError) {
      console.warn(
        `   ⚠ Failed to capture DOM snapshot: ${domError instanceof Error ? domError.message : 'Unknown error'}`
      );
    }

    // Capture console errors if any were collected
    if (consoleErrors.length > 0) {
      const consolePath = join(artifactsDir, `${stepId}-console.json`);
      try {
        writeFileSync(consolePath, JSON.stringify(consoleErrors, null, 2), 'utf-8');
        artifacts.console = consolePath;
      } catch (consoleError) {
        console.warn(
          `   ⚠ Failed to write console errors: ${consoleError instanceof Error ? consoleError.message : 'Unknown error'}`
        );
      }
    }

    // Return artifacts only if we captured at least one
    if (artifacts.screenshot || artifacts.dom || artifacts.console) {
      return artifacts;
    }

    return undefined;
  } catch (error) {
    console.warn(
      `   ⚠ Failed to capture failure artifacts: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    return undefined;
  }
}

/**
 * Capture success artifacts (screenshot only).
 *
 * This is a lighter-weight version of captureFailureArtifacts that only
 * captures a screenshot on success. DOM and console logs are not captured
 * on success to save space.
 *
 * @param page - Playwright Page object
 * @param stepId - The step identifier (used in filenames)
 * @param artifactsDir - Directory to write artifacts to
 * @returns ArtifactPaths with screenshot path, undefined if capture fails
 *
 * @example
 * ```typescript
 * const artifacts = await captureSuccessArtifacts(page, 'step-1', './artifacts');
 * // artifacts.screenshot = './artifacts/step-1-success.png'
 * ```
 */
export async function captureSuccessArtifacts(
  page: Page,
  stepId: string,
  artifactsDir: string
): Promise<ArtifactPaths | undefined> {
  try {
    // Ensure artifacts directory exists
    mkdirSync(artifactsDir, { recursive: true });

    const screenshotPath = join(artifactsDir, `${stepId}-success.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });

    return { screenshot: screenshotPath };
  } catch (error) {
    console.warn(
      `   ⚠ Failed to capture success screenshot: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    return undefined;
  }
}

/**
 * Capture PRE step artifacts (screenshot before step execution).
 *
 * This function captures a screenshot of the page state before a step
 * is executed. Only captured when alwaysScreenshot is enabled.
 *
 * @param page - Playwright Page object
 * @param stepId - The step identifier (used in filenames)
 * @param artifactsDir - Directory to write artifacts to
 * @returns Path to screenshot file, undefined if capture fails
 *
 * @example
 * ```typescript
 * const prePath = await capturePreStepArtifacts(page, 'step-1', './artifacts');
 * // prePath = './artifacts/step-1-pre.png'
 * ```
 */
export async function capturePreStepArtifacts(
  page: Page,
  stepId: string,
  artifactsDir: string
): Promise<string | undefined> {
  try {
    // Ensure artifacts directory exists
    mkdirSync(artifactsDir, { recursive: true });

    const screenshotPath = join(artifactsDir, `${stepId}-pre.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });

    return screenshotPath;
  } catch (error) {
    console.warn(`   ⚠ Failed to capture PRE screenshot: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return undefined;
  }
}

/**
 * Capture final screenshot at the end of test execution.
 *
 * This function captures a screenshot of the final page state after
 * all steps have been executed. Only captured when alwaysScreenshot is enabled.
 *
 * @param page - Playwright Page object
 * @param artifactsDir - Directory to write artifacts to
 * @returns Path to screenshot file, undefined if capture fails
 *
 * @example
 * ```typescript
 * const finalPath = await captureFinalScreenshot(page, './artifacts');
 * // finalPath = './artifacts/execution-final.png'
 * ```
 */
export async function captureFinalScreenshot(page: Page, artifactsDir: string): Promise<string | undefined> {
  try {
    // Ensure artifacts directory exists
    mkdirSync(artifactsDir, { recursive: true });

    const screenshotPath = join(artifactsDir, 'execution-final.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });

    return screenshotPath;
  } catch (error) {
    console.warn(
      `   ⚠ Failed to capture final screenshot: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    return undefined;
  }
}

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

    // L3-4A: Extract refTarget for requirements detection
    const refTarget = (await element.getAttribute('data-reftarget')) ?? undefined;

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
      refTarget,
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
// Session Validation Functions (L3-3D)
// ============================================

/**
 * Validate that the current session is still active (L3-3D).
 *
 * This function delegates to the auth abstraction module for session validation,
 * enabling swappable auth strategies for different environments.
 *
 * Performs a lightweight check against the /api/user endpoint to verify
 * the session hasn't expired during long-running tests. This is called
 * periodically during step execution to detect auth expiry before steps
 * fail with cryptic errors.
 *
 * Per design doc: Check every N steps (default 5) to balance overhead
 * vs early detection.
 *
 * @param page - Playwright Page object
 * @returns true if session is valid, false if expired
 *
 * @see tests/e2e-runner/auth/grafana-auth.ts for auth strategy customization
 */
export async function validateSession(page: Page): Promise<boolean> {
  // Delegate to auth abstraction module (L3-7A)
  // This uses the default plugin-e2e auth strategy
  return isSessionValid(page);
}

// ============================================
// Requirements Detection Functions (L3-4A)
// ============================================

/**
 * Detect requirements status for a step (L3-4A).
 *
 * This function examines the DOM to determine:
 * 1. Whether requirements are met (step is enabled)
 * 2. Whether a Fix button is available
 * 3. Whether a Skip button is available
 * 4. The current explanation text (if any)
 *
 * This information is used in subsequent milestones:
 * - L3-4B: Fix Button Execution - uses hasFixButton and fixType
 * - L3-4C: Skippable vs Mandatory Logic - uses skippable and requirementsMet
 *
 * @param page - Playwright Page object
 * @param step - The testable step to check
 * @returns RequirementResult with detected requirements information
 */
export async function detectRequirements(page: Page, step: TestableStep): Promise<RequirementResult> {
  const { stepId, skippable } = step;

  // Check if step is pre-completed - if so, requirements are implicitly met
  if (step.isPreCompleted) {
    return {
      requirementsMet: true,
      status: 'met',
      hasFixButton: false,
      skippable,
      isChecking: false,
      hasSkipButton: false,
      hasRetryButton: false,
    };
  }

  // Check if "Do it" button exists and is enabled (indicates requirements met)
  const doItButton = page.getByTestId(testIds.interactive.doItButton(stepId));
  const doItButtonCount = await doItButton.count();
  const doItButtonEnabled = doItButtonCount > 0 ? await doItButton.isEnabled() : false;

  // Check for requirement explanation element (indicates requirements not met or checking)
  const explanationElement = page.getByTestId(testIds.interactive.requirementCheck(stepId));
  const hasExplanation = (await explanationElement.count()) > 0;

  // Check if requirements are currently being checked (spinner visible)
  const isChecking = hasExplanation
    ? await explanationElement
        .locator('.interactive-requirement-spinner')
        .count()
        .then((c) => c > 0)
    : false;

  // Extract explanation text if available
  let explanationText: string | undefined;
  if (hasExplanation && !isChecking) {
    try {
      explanationText = await explanationElement.textContent().then((t) => t?.trim());
      // Remove button text from explanation (Fix this, Retry, Skip)
      explanationText = explanationText
        ?.replace(/Fix this$/, '')
        .replace(/Retry$/, '')
        .replace(/Skip$/, '')
        .replace(/⟳/g, '')
        .trim();
    } catch {
      // Ignore errors reading explanation text
    }
  }

  // Check for Fix button
  const fixButton = page.getByTestId(testIds.interactive.requirementFixButton(stepId));
  const hasFixButton = (await fixButton.count()) > 0;

  // Check for Retry button (non-fixable requirement failure)
  const retryButton = page.getByTestId(testIds.interactive.requirementRetryButton(stepId));
  const hasRetryButton = (await retryButton.count()) > 0;

  // Check for Skip button
  const skipButton = page.getByTestId(testIds.interactive.requirementSkipButton(stepId));
  const hasSkipButton = (await skipButton.count()) > 0;

  // Determine fix type from DOM if fix button exists
  let fixType: RequirementFixType | undefined;
  if (hasFixButton) {
    fixType = await detectFixType(page, step);
  }

  // Determine requirement status
  let status: RequirementStatus;
  let requirementsMet: boolean;

  if (isChecking) {
    status = 'checking';
    requirementsMet = false;
  } else if (doItButtonEnabled && !hasExplanation) {
    // Button enabled and no explanation = requirements met
    status = 'met';
    requirementsMet = true;
  } else if (hasExplanation || hasFixButton || hasRetryButton || hasSkipButton) {
    // Has explanation or action buttons = requirements not met
    status = 'unmet';
    requirementsMet = false;
  } else if (doItButtonCount > 0) {
    // Button exists but disabled without explanation - could be sequential dependency
    status = 'unknown';
    requirementsMet = false;
  } else {
    // No button, no explanation - unknown state
    status = 'unknown';
    requirementsMet = true; // Assume met if nothing indicates otherwise
  }

  return {
    requirementsMet,
    status,
    hasFixButton,
    fixType,
    skippable,
    explanationText,
    isChecking,
    hasSkipButton,
    hasRetryButton,
  };
}

/**
 * Detect the fix type available for a step (L3-4A).
 *
 * Fix types are determined by the requirement that failed:
 * - navmenu-open → 'navigation' (click mega-menu)
 * - on-page:/path → 'location' (navigate to path)
 * - exists-reftarget with navigation item → 'expand-parent-navigation'
 * - exists-reftarget with lazyRender → 'lazy-scroll'
 *
 * This function examines the step's target action and explanation text
 * to infer the fix type, since it's not directly exposed in the DOM.
 *
 * @param page - Playwright Page object
 * @param step - The testable step to check
 * @returns The detected fix type, or undefined if cannot be determined
 */
async function detectFixType(page: Page, step: TestableStep): Promise<RequirementFixType | undefined> {
  const { stepId, targetAction, refTarget } = step;

  // Get explanation text for clues about the fix type
  const explanationElement = page.getByTestId(testIds.interactive.requirementCheck(stepId));
  let explanationText = '';
  try {
    explanationText = (await explanationElement.textContent()) || '';
  } catch {
    // Ignore errors
  }

  const lowerExplanation = explanationText.toLowerCase();

  // Check for navigation-related fixes
  if (lowerExplanation.includes('navigation') || lowerExplanation.includes('menu')) {
    if (lowerExplanation.includes('expand') || lowerExplanation.includes('section')) {
      return 'expand-parent-navigation';
    }
    return 'navigation';
  }

  // Check for location/page fixes
  if (lowerExplanation.includes('page') || lowerExplanation.includes('navigate')) {
    return 'location';
  }

  // Check for scroll-related fixes
  if (lowerExplanation.includes('scroll') || lowerExplanation.includes('discover')) {
    return 'lazy-scroll';
  }

  // Infer from target action if explanation doesn't help
  if (targetAction === 'navigate') {
    return 'location';
  }

  // Check if refTarget suggests navigation menu item
  if (refTarget?.includes('grafana:nav-menu') || refTarget?.includes('nav-item')) {
    return 'navigation';
  }

  // Default to navigation for generic fix cases
  return 'navigation';
}

/**
 * Wait for requirements checking to complete (L3-4A).
 *
 * When a step's requirements are being checked (spinner visible),
 * this function waits for the check to complete before proceeding.
 *
 * @param page - Playwright Page object
 * @param stepId - The step identifier
 * @param timeout - Maximum time to wait in ms (default 10s)
 * @returns true if checking completed, false if timeout
 */
export async function waitForRequirementsCheckComplete(
  page: Page,
  stepId: string,
  timeout = REQUIREMENTS_CHECK_TIMEOUT_MS
): Promise<boolean> {
  const startTime = Date.now();
  const explanationElement = page.getByTestId(testIds.interactive.requirementCheck(stepId));

  while (Date.now() - startTime < timeout) {
    // Check if explanation element exists and has spinner
    const hasExplanation = (await explanationElement.count()) > 0;
    if (!hasExplanation) {
      // No explanation = requirements met or step completed
      return true;
    }

    const hasSpinner = await explanationElement
      .locator('.interactive-requirement-spinner')
      .count()
      .then((c) => c > 0);
    if (!hasSpinner) {
      // Explanation without spinner = checking complete
      return true;
    }

    // Still checking, wait and retry
    await page.waitForTimeout(REQUIREMENTS_POLL_INTERVAL_MS);
  }

  // Timeout reached
  return false;
}

/**
 * Handle requirements for a step (L3-4A).
 *
 * This is the main entry point for requirements handling in step execution.
 * It performs the following:
 * 1. Wait for any ongoing requirements check to complete
 * 2. Detect current requirements status
 * 3. Return the result for decision-making
 *
 * Note: Fix button execution (L3-4B) and skip/mandatory logic (L3-4C)
 * are implemented in subsequent milestones. This function only detects
 * requirements status.
 *
 * @param page - Playwright Page object
 * @param step - The testable step to handle
 * @param options - Options for requirements handling
 * @returns RequirementResult with detected requirements information
 */
export async function handleRequirements(
  page: Page,
  step: TestableStep,
  options: {
    verbose?: boolean;
    timeout?: number;
  } = {}
): Promise<RequirementResult> {
  const { verbose = false, timeout = REQUIREMENTS_CHECK_TIMEOUT_MS } = options;

  if (verbose) {
    console.log(`   🔍 Checking requirements for step ${step.stepId}...`);
  }

  // Wait for any ongoing requirements check to complete
  const checkComplete = await waitForRequirementsCheckComplete(page, step.stepId, timeout);
  if (!checkComplete && verbose) {
    console.log(`   ⚠ Requirements check timeout for step ${step.stepId}`);
  }

  // Detect current requirements status
  const result = await detectRequirements(page, step);

  if (verbose) {
    logRequirementResult(step.stepId, result);
  }

  return result;
}

/**
 * Log requirements detection result in a human-readable format.
 *
 * @param stepId - The step identifier
 * @param result - The requirement detection result
 */
function logRequirementResult(stepId: string, result: RequirementResult): void {
  const statusIcon = {
    met: '✓',
    unmet: '✗',
    checking: '⟳',
    unknown: '?',
  }[result.status];

  let message = `   ${statusIcon} Requirements ${result.status}`;

  if (result.hasFixButton) {
    message += ` (fix: ${result.fixType || 'available'})`;
  }

  if (result.hasSkipButton) {
    message += ' (skippable)';
  }

  if (result.explanationText) {
    message += `\n      Explanation: ${result.explanationText}`;
  }

  console.log(message);
}

// ============================================
// Fix Button Execution Functions (L3-4B)
// ============================================

/**
 * Click the Fix button for a step and wait for the fix action to complete (L3-4B).
 *
 * This function:
 * 1. Clicks the Fix button
 * 2. Waits for the appropriate settle delay based on fix type
 * 3. Waits for requirements check to complete
 * 4. Returns whether the fix succeeded
 *
 * Per design doc: Different fix types have different behaviors:
 * - navigation: Click mega-menu, expand sections
 * - location: Navigate to path (triggers page load)
 * - expand-parent-navigation: Expand collapsed nav section
 * - lazy-scroll: Scroll container to discover element
 *
 * @param page - Playwright Page object
 * @param step - The testable step to fix
 * @param fixType - The type of fix being applied (affects wait times)
 * @param timeout - Maximum time to wait for fix completion (default 10s)
 * @returns true if fix button was clicked and requirements check completed
 */
export async function clickFixButton(
  page: Page,
  step: TestableStep,
  fixType?: RequirementFixType,
  timeout = FIX_BUTTON_TIMEOUT_MS
): Promise<boolean> {
  const { stepId } = step;
  const fixButton = page.getByTestId(testIds.interactive.requirementFixButton(stepId));

  // Check if fix button exists and is clickable
  const buttonCount = await fixButton.count();
  if (buttonCount === 0) {
    return false;
  }

  try {
    // Click the fix button with timeout
    await fixButton.click({ timeout });

    // Determine settle delay based on fix type
    // Location fixes require longer wait for navigation
    const settleDelay = fixType === 'location' ? NAVIGATION_FIX_SETTLE_DELAY_MS : POST_FIX_SETTLE_DELAY_MS;

    // Wait for fix action to complete
    await page.waitForTimeout(settleDelay);

    // If it's a location fix, also wait for network to idle
    if (fixType === 'location') {
      try {
        await page.waitForLoadState('networkidle', { timeout: timeout / 2 });
      } catch {
        // Network idle timeout is not critical - proceed anyway
      }
    }

    // Wait for requirements recheck to complete
    const recheckComplete = await waitForRequirementsCheckComplete(page, stepId, timeout);
    return recheckComplete;
  } catch (error) {
    // Fix button click failed (timeout or element detached)
    return false;
  }
}

/**
 * Attempt to fix requirements for a step with retry logic (L3-4B).
 *
 * This function implements the fix button retry mechanism:
 * 1. Click the Fix button
 * 2. Wait for the fix to take effect
 * 3. Recheck requirements
 * 4. If still not met, retry up to MAX_FIX_ATTEMPTS times
 *
 * Per design doc:
 * - Max 3 fix attempts (reduced from 10 for faster failure)
 * - 10s timeout per fix operation
 * - Navigation fixes trigger page load wait
 *
 * @param page - Playwright Page object
 * @param step - The testable step to fix
 * @param options - Options for fix handling
 * @returns FixResult with all attempt results and final outcome
 */
export async function attemptToFixRequirements(
  page: Page,
  step: TestableStep,
  options: {
    verbose?: boolean;
    maxAttempts?: number;
    timeout?: number;
  } = {}
): Promise<FixResult> {
  const { verbose = false, maxAttempts = MAX_FIX_ATTEMPTS, timeout = FIX_BUTTON_TIMEOUT_MS } = options;

  const attempts: FixAttemptResult[] = [];
  const overallStartTime = Date.now();
  let success = false;
  let finalStatus: RequirementStatus = 'unmet';
  let failureReason: string | undefined;

  if (verbose) {
    console.log(`   🔧 Attempting to fix requirements (max ${maxAttempts} attempts)...`);
  }

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    const attemptStartTime = Date.now();

    if (verbose) {
      console.log(`   → Fix attempt ${attemptNumber}/${maxAttempts}...`);
    }

    // First, detect current requirements to get fix type
    const currentRequirements = await detectRequirements(page, step);

    // If requirements are already met, we're done
    if (currentRequirements.requirementsMet) {
      if (verbose) {
        console.log(`   ✓ Requirements already met`);
      }
      success = true;
      finalStatus = 'met';
      attempts.push({
        success: true,
        attemptNumber,
        durationMs: Date.now() - attemptStartTime,
        requirementsMet: true,
      });
      break;
    }

    // Check if fix button is available
    if (!currentRequirements.hasFixButton) {
      if (verbose) {
        console.log(`   ✗ No Fix button available - cannot fix requirements`);
      }
      failureReason = 'No Fix button available';
      attempts.push({
        success: false,
        attemptNumber,
        durationMs: Date.now() - attemptStartTime,
        error: 'No Fix button available',
        requirementsMet: false,
      });
      break;
    }

    // Click the fix button
    const fixClicked = await clickFixButton(page, step, currentRequirements.fixType, timeout);

    if (!fixClicked) {
      if (verbose) {
        console.log(`   ✗ Fix button click failed or timed out`);
      }
      attempts.push({
        success: false,
        attemptNumber,
        durationMs: Date.now() - attemptStartTime,
        error: 'Fix button click failed',
        requirementsMet: false,
      });
      continue; // Try again
    }

    // Recheck requirements after fix
    const postFixRequirements = await detectRequirements(page, step);

    if (postFixRequirements.requirementsMet) {
      if (verbose) {
        console.log(`   ✓ Fix successful - requirements now met`);
      }
      success = true;
      finalStatus = 'met';
      attempts.push({
        success: true,
        attemptNumber,
        durationMs: Date.now() - attemptStartTime,
        requirementsMet: true,
      });
      break;
    } else {
      if (verbose) {
        const remaining = maxAttempts - attemptNumber;
        console.log(`   ⚠ Fix did not satisfy requirements${remaining > 0 ? `, ${remaining} attempts remaining` : ''}`);
      }
      attempts.push({
        success: false,
        attemptNumber,
        durationMs: Date.now() - attemptStartTime,
        error: 'Requirements still not met after fix',
        requirementsMet: false,
      });

      // Update final status from post-fix check
      finalStatus = postFixRequirements.status;
    }
  }

  // If we exhausted all attempts without success, record the failure reason
  if (!success && !failureReason) {
    failureReason = `Failed after ${attempts.length} fix attempts`;
  }

  return {
    success,
    totalAttempts: attempts.length,
    attempts,
    totalDurationMs: Date.now() - overallStartTime,
    finalStatus,
    failureReason,
  };
}

/**
 * Handle requirements with automatic fix attempts for mandatory steps (L3-4B).
 *
 * This function extends handleRequirements() with fix button execution:
 * 1. Detect requirements
 * 2. If unmet and fix button available, attempt to fix
 * 3. Return final requirements status
 *
 * This is the main integration point for L3-4B fix button execution.
 *
 * @param page - Playwright Page object
 * @param step - The testable step to handle
 * @param options - Options for requirements handling
 * @returns Object with requirements result and any fix attempts
 */
export async function handleRequirementsWithFix(
  page: Page,
  step: TestableStep,
  options: {
    verbose?: boolean;
    timeout?: number;
    attemptFix?: boolean;
    maxFixAttempts?: number;
  } = {}
): Promise<{
  requirements: RequirementResult;
  fixResult?: FixResult;
}> {
  const { verbose = false, timeout = REQUIREMENTS_CHECK_TIMEOUT_MS, attemptFix = true, maxFixAttempts } = options;

  // First, handle requirements detection (L3-4A)
  const requirements = await handleRequirements(page, step, { verbose, timeout });

  // If requirements are met, no fix needed
  if (requirements.requirementsMet) {
    return { requirements };
  }

  // If requirements are unmet and we should attempt fix
  if (attemptFix && requirements.hasFixButton && requirements.status === 'unmet') {
    if (verbose) {
      console.log(`   🔧 Requirements unmet, attempting automatic fix...`);
    }

    const fixResult = await attemptToFixRequirements(page, step, {
      verbose,
      maxAttempts: maxFixAttempts,
      timeout: FIX_BUTTON_TIMEOUT_MS,
    });

    // Re-detect requirements after fix attempts
    const postFixRequirements = await detectRequirements(page, step);

    return {
      requirements: postFixRequirements,
      fixResult,
    };
  }

  // No fix attempted
  return { requirements };
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
        step.refTarget ? `target:${step.refTarget.substring(0, 30)}${step.refTarget.length > 30 ? '...' : ''}` : null,
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
 * Callback for real-time step progress reporting (L3-5A).
 * Called after each step completes for immediate console output.
 */
export type OnStepCompleteCallback = (result: StepTestResult, stepIndex: number, totalSteps: number) => void;

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
