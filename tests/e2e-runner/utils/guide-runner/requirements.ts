/**
 * Guide Test Runner Requirements Handling
 *
 * Functions for detecting and fixing step requirements (L3-4A, L3-4B).
 * Includes session validation and automatic fix button execution.
 *
 * @see docs/design/e2e-test-runner-design.md
 */

import { Page } from '@playwright/test';

import { testIds } from '../../../../src/components/testIds';
import { isSessionValid } from '../../auth/grafana-auth';
import {
  REQUIREMENTS_CHECK_TIMEOUT_MS,
  REQUIREMENTS_POLL_INTERVAL_MS,
  FIX_BUTTON_TIMEOUT_MS,
  MAX_FIX_ATTEMPTS,
  POST_FIX_SETTLE_DELAY_MS,
  NAVIGATION_FIX_SETTLE_DELAY_MS,
} from './constants';
import type {
  TestableStep,
  RequirementStatus,
  RequirementFixType,
  RequirementResult,
  FixAttemptResult,
  FixResult,
} from './types';

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
  } catch {
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
