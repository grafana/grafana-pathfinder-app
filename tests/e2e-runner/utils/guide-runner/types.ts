/**
 * Guide Test Runner Types
 *
 * Type definitions for the guide test runner utilities.
 * These types are used throughout the test runner for step discovery,
 * execution, and result reporting.
 *
 * @see tests/e2e-runner/design/e2e-test-runner-design.md
 */

import { Locator } from '@playwright/test';

// ============================================
// Step Types
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
   * Whether this is a guided step (E2E contract: data-targetaction="guided").
   * Guided steps run a substep loop driven by the comment box.
   */
  isGuided: boolean;

  /**
   * Total substeps for guided steps (from data-test-substep-total).
   * Used for timeouts and loop bound in Phase 3.
   */
  guidedStepCount?: number;

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

// ============================================
// Step Test Result Types
// ============================================

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

/**
 * Callback for real-time step progress reporting (L3-5A).
 * Called after each step completes for immediate console output.
 */
export type OnStepCompleteCallback = (result: StepTestResult, stepIndex: number, totalSteps: number) => void;
