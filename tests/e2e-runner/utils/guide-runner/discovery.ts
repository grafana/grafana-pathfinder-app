/**
 * Guide Test Runner Discovery
 *
 * Functions for discovering testable steps from the rendered DOM.
 * Implements DOM-based step discovery per the E2E Test Runner design.
 *
 * @see tests/e2e-runner/design/e2e-test-runner-design.md
 * @see tests/e2e-runner/design/L3-phase1-verification-results.md
 */

import { Page, Locator } from '@playwright/test';

import { testIds } from '../../../../src/components/testIds';
import { STEP_SELECTOR, STEP_TESTID_PREFIX } from './constants';
import { calculateStepTimeout } from './execution';
import type { TestableStep, StepDiscoveryResult } from './types';

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

    // Scroll step into view so below-the-fold or lazy-rendered content (e.g. Skip button) is in DOM
    await element.scrollIntoViewIfNeeded().catch(() => {});

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

    // E2E contract: detect guided steps and substep count from DOM only
    const { isGuided, guidedStepCount } = await extractGuidedInfo(element, targetAction);

    // Guided steps require user to click each target; E2E runner does not automate that.
    // Treat as skippable when skip button wasn't detected so guides with guided blocks can pass (skippable failure).
    const effectiveSkippable = skippable || isGuided;

    steps.push({
      stepId,
      index,
      sectionId,
      skippable: effectiveSkippable,
      hasDoItButton,
      isPreCompleted,
      targetAction,
      isMultistep,
      internalActionCount,
      isGuided,
      guidedStepCount: isGuided ? guidedStepCount : undefined,
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

/**
 * Extract guided step information from a step element (E2E contract).
 *
 * Guided steps have data-targetaction="guided" and data-test-substep-total
 * (always present on multi-step and guided components per contract).
 *
 * Exported for unit testing (Phase 5).
 *
 * @param stepElement - Locator for the step element
 * @param targetAction - Already-extracted target action type
 * @returns Object with isGuided flag and guidedStepCount (substep total)
 */
export async function extractGuidedInfo(
  stepElement: Locator,
  targetAction?: string
): Promise<{ isGuided: boolean; guidedStepCount: number }> {
  // Guided steps may have data-targetaction="guided" or only data-test-substep-total (InteractiveGuided does not set targetaction).
  // Multistep also has data-test-substep-total, so exclude targetAction === 'multistep'.
  // Only infer guided from hasSubstepTotal when targetAction is unset (undefined); explicit 'button' etc. are not guided.
  const raw = await stepElement.getAttribute('data-test-substep-total');
  const parsed = raw !== null && raw !== '' ? parseInt(raw, 10) : NaN;
  const hasSubstepTotal = Number.isFinite(parsed) && parsed >= 1;
  const targetActionUnset = targetAction === undefined || targetAction === null || targetAction === '';
  const isGuided = targetAction === 'guided' || (hasSubstepTotal && targetAction !== 'multistep' && targetActionUnset);
  if (!isGuided) {
    return { isGuided: false, guidedStepCount: 1 };
  }
  const guidedStepCount = hasSubstepTotal ? parsed : 1;
  return { isGuided: true, guidedStepCount };
}

// ============================================
// Logging Functions
// ============================================

/**
 * Log step discovery results in a human-readable format.
 *
 * @param result - The step discovery result
 * @param verbose - Whether to log detailed per-step information
 */
export function logDiscoveryResults(result: StepDiscoveryResult, verbose = false): void {
  const multistepCount = result.steps.filter((s) => s.isMultistep).length;
  const guidedCount = result.steps.filter((s) => s.isGuided).length;

  console.log(`\n📋 Step Discovery Results`);
  console.log(`   Total steps: ${result.totalSteps}`);
  console.log(`   Pre-completed: ${result.preCompletedCount}`);
  console.log(`   Without "Do it": ${result.noDoItButtonCount}`);
  if (multistepCount > 0) {
    console.log(`   Multisteps: ${multistepCount}`);
  }
  if (guidedCount > 0) {
    console.log(`   Guided: ${guidedCount}`);
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
        step.isGuided && step.guidedStepCount != null ? `guided:${step.guidedStepCount}` : null,
        step.refTarget ? `target:${step.refTarget.substring(0, 30)}${step.refTarget.length > 30 ? '...' : ''}` : null,
      ]
        .filter(Boolean)
        .join(', ');

      const flagsStr = flags ? ` (${flags})` : '';
      const actionStr = step.targetAction ? ` [${step.targetAction}]` : '';
      const sectionStr = step.sectionId ? ` in section:${step.sectionId}` : '';

      const timeoutStr = step.isMultistep ? ` timeout:${Math.round(calculateStepTimeout(step) / 1000)}s` : '';

      console.log(`   ${step.index + 1}. ${step.stepId}${actionStr}${sectionStr}${flagsStr}${timeoutStr}`);
    }
  }
}
