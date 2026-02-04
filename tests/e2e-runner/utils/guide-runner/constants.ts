/**
 * Guide Test Runner Constants
 *
 * Configuration constants for the guide test runner utilities.
 * Includes timing constants, selector patterns, and error classification patterns.
 *
 * @see tests/e2e-runner/design/e2e-test-runner-design.md
 */

// ============================================
// DOM Selectors
// ============================================

/**
 * Selector pattern for interactive step elements.
 * Steps are identified by data-testid starting with "interactive-step-".
 */
export const STEP_SELECTOR = '[data-testid^="interactive-step-"]';

/**
 * Prefix to strip from data-testid to get the step ID.
 */
export const STEP_TESTID_PREFIX = 'interactive-step-';

/**
 * Selector pattern for interactive sections (parent containers of steps).
 */
export const SECTION_SELECTOR = '[data-testid^="interactive-section-"]';

// ============================================
// Timing Constants (L3-3C)
// ============================================

/**
 * Default timeout for waiting for step completion.
 * Per design doc: 30 seconds as a generous default.
 */
export const DEFAULT_STEP_TIMEOUT_MS = 30000;

/**
 * Additional timeout per internal action for multisteps.
 * Per design doc: 30s base + 5s per action.
 */
export const TIMEOUT_PER_MULTISTEP_ACTION_MS = 5000;

/**
 * Timeout for waiting for "Do it" button to become enabled.
 * Sequential dependencies (isEligibleForChecking) may disable buttons.
 */
export const BUTTON_ENABLE_TIMEOUT_MS = 10000;

/**
 * Timeout for waiting for "Do it" button to appear.
 * Longer than enable timeout since it needs to wait for
 * previous step completion in sequential sections.
 */
export const BUTTON_APPEAR_TIMEOUT_MS = 15000;

/**
 * Delay after scrolling to allow animations to settle.
 * Per design doc: 300ms for scroll animation.
 */
export const SCROLL_SETTLE_DELAY_MS = 300;

/**
 * Delay after clicking "Do it" before checking completion.
 * Allows the reactive system to settle (debounced rechecks: 500ms context, 1200ms DOM).
 */
export const POST_CLICK_SETTLE_DELAY_MS = 500;

/**
 * Polling interval for checking completion during wait.
 * Used for detecting objective-based auto-completion.
 */
export const COMPLETION_POLL_INTERVAL_MS = 250;

// ============================================
// Session Validation Constants (L3-3D)
// ============================================

/**
 * Default number of steps between session validation checks.
 * Per design doc: validate session every 5 steps to detect expiry before cryptic failures.
 */
export const DEFAULT_SESSION_CHECK_INTERVAL = 5;

/**
 * Timeout for session validation API call.
 * Should be short since this is a lightweight check.
 */
export const SESSION_VALIDATION_TIMEOUT_MS = 5000;

// ============================================
// Requirements Detection Constants (L3-4A)
// ============================================

/**
 * Timeout for waiting for requirements checking to complete.
 * Requirements checking involves async operations (API calls, DOM checks).
 */
export const REQUIREMENTS_CHECK_TIMEOUT_MS = 10000;

/**
 * Polling interval for checking if requirements are still being checked.
 */
export const REQUIREMENTS_POLL_INTERVAL_MS = 200;

// ============================================
// Fix Button Execution Constants (L3-4B)
// ============================================

/**
 * Timeout for individual fix button operation.
 * Per design doc: 10s per fix operation.
 */
export const FIX_BUTTON_TIMEOUT_MS = 10000;

/**
 * Maximum number of fix attempts before giving up.
 * Per design doc: 3 attempts (reduced from original 10 for faster failure).
 */
export const MAX_FIX_ATTEMPTS = 3;

/**
 * Delay after fix button click to allow the fix action to complete.
 * Navigation fixes may involve page loads and menu animations.
 */
export const POST_FIX_SETTLE_DELAY_MS = 1000;

/**
 * Delay after navigation fix to wait for page load completion.
 * Location fixes trigger navigation which needs time to settle.
 */
export const NAVIGATION_FIX_SETTLE_DELAY_MS = 2000;

// ============================================
// Error Classification Patterns (L3-5C)
// ============================================

/**
 * Patterns for identifying infrastructure errors (L3-5C).
 *
 * These patterns indicate environmental/infrastructure issues that
 * are unlikely to be caused by guide content or product code changes.
 */
export const INFRASTRUCTURE_ERROR_PATTERNS = [
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
