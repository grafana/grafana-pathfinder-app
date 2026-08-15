/**
 * Guide Test Runner Execution
 *
 * Functions for executing interactive steps and reporting results.
 * Implements step execution with proper timing, artifact collection,
 * and session validation per the E2E Test Runner design.
 *
 * @see docs/developer/E2E_TESTING.md#how-it-works
 */

import { Page, expect } from '@playwright/test';

import { testIds } from '../../../../src/constants/testIds';
import {
  DEFAULT_STEP_TIMEOUT_MS,
  GUIDE_INITIAL_TIMEOUT_MS,
  STEP_OVERHEAD_TIMEOUT_MS,
  TIMEOUT_PER_MULTISTEP_ACTION_MS,
  TIMEOUT_PER_GUIDED_SUBSTEP_MS,
  BUTTON_ENABLE_TIMEOUT_MS,
  BUTTON_APPEAR_TIMEOUT_MS,
  SCROLL_SETTLE_DELAY_MS,
  SCROLL_INTO_VIEW_TIMEOUT_MS,
  LATE_COMPLETION_CHECK_TIMEOUT_MS,
  POST_CLICK_SETTLE_DELAY_MS,
  COMPLETION_POLL_INTERVAL_MS,
  DEFAULT_SESSION_CHECK_INTERVAL,
  MAX_FIX_ATTEMPTS,
  GUIDED_COMMENT_BOX_VISIBLE_TIMEOUT_MS,
  GUIDED_TARGET_RESOLUTION_TIMEOUT_MS,
  GUIDED_SUBSTEP_ADVANCE_POLL_MS,
  GUIDED_BETWEEN_SUBSTEP_DELAY_MS,
  GUIDED_FORMFILL_DEBOUNCE_MS,
  GUIDED_FORMFILL_VALID_TIMEOUT_MS,
  GUIDED_FORMFILL_INVALID_PERSIST_MS,
  GUIDED_HOVER_DWELL_MS,
  GUIDED_SKIP_AFTER_TIMEOUT_FRACTION,
  GUIDED_RELOAD_LOAD_TIMEOUT_MS,
  SKIP_SYNC_TIMEOUT_MS,
} from './constants';
import { classifyError } from './classification';
import {
  captureFailureArtifacts,
  captureSuccessArtifacts,
  capturePreStepArtifacts,
  captureFinalScreenshot,
} from './artifacts';
import { validateSession, handleRequirementsWithFix } from './requirements';
import { dismissBadgeCelebrations } from './badge-celebrations';
import type {
  TestableStep,
  SkipReason,
  AbortReason,
  ArtifactPaths,
  StepTestResult,
  AllStepsResult,
  OnStepCompleteCallback,
} from './types';
import { resolveSelector } from '../selector-resolver';
import type { Locator } from '@playwright/test';

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
  if (step.isGuided && step.guidedStepCount != null && step.guidedStepCount > 0) {
    return DEFAULT_STEP_TIMEOUT_MS + step.guidedStepCount * TIMEOUT_PER_GUIDED_SUBSTEP_MS;
  }
  if (step.isMultistep && step.internalActionCount > 0) {
    // Multistep: base timeout + time per internal action
    return DEFAULT_STEP_TIMEOUT_MS + step.internalActionCount * TIMEOUT_PER_MULTISTEP_ACTION_MS;
  }
  return DEFAULT_STEP_TIMEOUT_MS;
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
  if (step.hasDoItButton) {
    return 'do-it';
  }
  if (step.hasShowMeButton) {
    return 'show-me';
  }
  return undefined;
}

export function determineUnmetRequirementOutcome(skippable: boolean): 'skip' | 'fail' {
  return skippable ? 'skip' : 'fail';
}

function stepActionButton(page: Page, stepId: string, action: StepAction): Locator {
  const testId = action === 'do-it' ? testIds.interactive.doItButton(stepId) : testIds.interactive.showMeButton(stepId);
  return page.getByTestId(testId);
}

async function currentStepAction(page: Page, stepId: string): Promise<StepAction | undefined> {
  return selectStepAction({
    hasDoItButton: (await stepActionButton(page, stepId, 'do-it').count()) > 0,
    hasShowMeButton: (await stepActionButton(page, stepId, 'show-me').count()) > 0,
  });
}

async function waitForStepActionToAppear(
  page: Page,
  stepId: string,
  timeout = BUTTON_APPEAR_TIMEOUT_MS
): Promise<StepAction | undefined> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const action = await currentStepAction(page, stepId);
    if (action) {
      return action;
    }
    await page.waitForTimeout(COMPLETION_POLL_INTERVAL_MS);
  }
  return undefined;
}

async function waitForStepActionEnabled(
  page: Page,
  stepId: string,
  action: StepAction,
  timeout = BUTTON_ENABLE_TIMEOUT_MS
): Promise<void> {
  await expect(stepActionButton(page, stepId, action)).toBeEnabled({ timeout });
}

/**
 * Wait for a step to reach completed state (E2E contract).
 *
 * Uses data-test-step-state="completed" on the step element so that all step types
 * (single, multistep, guided) are considered complete when the contract says so.
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
  const stepLocator = page.getByTestId(testIds.interactive.step(stepId));
  await expect(stepLocator).toHaveAttribute('data-test-step-state', 'completed', { timeout });
}

/**
 * Check if a step has completed via objectives while waiting (L3-3C).
 *
 * Reads data-test-step-state from the step element; returns true when value is 'completed'.
 *
 * @param page - Playwright Page object
 * @param stepId - The step identifier
 * @returns true if the step completed via objectives (or any completion)
 */
export async function checkObjectiveCompletion(page: Page, stepId: string): Promise<boolean> {
  const stepLocator = page.getByTestId(testIds.interactive.step(stepId));
  const state = await stepLocator.getAttribute('data-test-step-state');
  return state === 'completed';
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

async function readStepError(page: Page, stepId: string): Promise<string | undefined> {
  const errorElement = page.getByTestId(testIds.interactive.errorMessage(stepId));
  if ((await errorElement.count()) > 0) {
    return (await errorElement.first().textContent())?.trim() || undefined;
  }
  const deployedError = page
    .getByTestId(testIds.interactive.step(stepId))
    .locator('.interactive-lazy-error-text, .interactive-step-execution-error')
    .first();
  return (await deployedError.count()) > 0 ? (await deployedError.textContent())?.trim() || undefined : undefined;
}

/**
 * Wait for a step to complete after it has been interacted with.
 *
 * Callers reach this only after the step was alive and acted on (its "Do it"
 * button was clicked, or the guided loop was running). A detached step element
 * therefore means the step completed and its section auto-collapsed — or
 * navigation unmounted it. Either way, detachment is a completion signal.
 *
 * Otherwise it polls data-test-step-state until 'completed', then asserts
 * completion so a genuinely stuck step fails with a clear error.
 *
 * @param page - Playwright Page object
 * @param stepId - The step identifier
 * @param timeout - Maximum time to wait (ms)
 * @returns Object indicating if completion was likely via objectives
 */
export async function waitForCompletionWithObjectivePolling(
  page: Page,
  stepId: string,
  timeout: number
): Promise<{ completedViaObjectives: boolean }> {
  const startTime = Date.now();
  const stepLocator = page.getByTestId(testIds.interactive.step(stepId));

  while (Date.now() - startTime < timeout) {
    if ((await stepLocator.count()) === 0) {
      return { completedViaObjectives: false };
    }

    let state: string | null = null;
    try {
      state = await stepLocator.getAttribute('data-test-step-state', { timeout: 2000 });
    } catch {
      if ((await stepLocator.count()) === 0) {
        return { completedViaObjectives: false };
      }
    }
    const errorMessage = await readStepError(page, stepId);
    if (errorMessage) {
      throw new Error(errorMessage);
    }
    if (state === 'completed') {
      const elapsed = Date.now() - startTime;
      const likelyObjectiveCompletion = elapsed < COMPLETION_POLL_INTERVAL_MS * 2;
      return { completedViaObjectives: likelyObjectiveCompletion };
    }
    if (state === 'error') {
      throw new Error((await readStepError(page, stepId)) ?? `Step ${stepId} entered error state`);
    }
    if (state === 'cancelled' || state === 'requirements-unmet') {
      throw new Error(`Step ${stepId} entered ${state} state`);
    }
    await page.waitForTimeout(COMPLETION_POLL_INTERVAL_MS);
  }

  await expect(stepLocator).toHaveAttribute('data-test-step-state', 'completed', { timeout: 1000 });
  return { completedViaObjectives: false };
}

// ============================================
// Guided Step Execution (Phase 3)
// ============================================

const GUIDED_WAIT_EXECUTING_MS = 5000;

async function waitForGuidedExecutionStart(page: Page, stepLocator: Locator, timeout: number): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await stepLocator.getAttribute('data-test-step-state');
    if (state === 'executing' || state === 'completed') {
      return;
    }
    if (state === 'error' || state === 'cancelled') {
      throw new Error(`Guided step entered ${state} state before execution`);
    }
    await page.waitForTimeout(COMPLETION_POLL_INTERVAL_MS);
  }
  throw new Error('Guided step did not enter executing state');
}

interface ParsedNthMatchSelector {
  baseSelector: string;
  index: number;
  trailingSelector: string;
}

export function parseNthMatchSelector(selector: string): ParsedNthMatchSelector | undefined {
  const match = selector.match(/^(.+?):nth-match\((\d+)\)(.*)$/);
  if (!match) {
    return undefined;
  }
  const oneBasedIndex = Number.parseInt(match[2]!, 10);
  if (oneBasedIndex < 1) {
    return undefined;
  }
  return {
    baseSelector: match[1]!,
    index: oneBasedIndex - 1,
    trailingSelector: match[3]!.trim(),
  };
}

function guidedSelectorLocator(page: Page, selector: string): Locator {
  const parsed = parseNthMatchSelector(selector);
  if (!parsed) {
    return page.locator(selector).first();
  }
  const matched = page.locator(parsed.baseSelector).nth(parsed.index);
  return parsed.trailingSelector ? matched.locator(parsed.trailingSelector).first() : matched;
}

async function revealGuidedTarget(page: Page, target: Locator, timeout: number): Promise<Locator> {
  if (await target.isVisible()) {
    return target;
  }
  if ((await target.count()) > 0) {
    const panel = target.locator('xpath=ancestor::section[1]');
    if ((await panel.count()) > 0) {
      await panel.scrollIntoViewIfNeeded().catch(() => {});
      await dismissBadgeCelebrations(page);
      await panel.hover({ timeout }).catch(() => {});
      if (await target.isVisible()) {
        return target;
      }
      const menuButton = panel.locator('button[data-testid^="data-testid Panel menu "]').first();
      if ((await menuButton.count()) > 0 && (await menuButton.isVisible())) {
        return menuButton;
      }
    }
  }
  await target.waitFor({ state: 'visible', timeout });
  return target;
}

/**
 * Resolve data-test-reftarget to a Playwright locator for the current substep.
 * Button: try getByRole('button', { name }) then locator(selector); others use locator(selector).
 * Handles grafana: prefix through the Node-safe E2E resolver.
 */
async function resolveGuidedTarget(page: Page, reftarget: string, actionType: string): Promise<Locator> {
  await dismissBadgeCelebrations(page);
  const timeout = GUIDED_TARGET_RESOLUTION_TIMEOUT_MS;
  const selector = reftarget.startsWith('grafana:') ? resolveSelector(reftarget) : reftarget;

  if (actionType === 'button') {
    const byRole = page.getByRole('button', { name: reftarget });
    const n = await byRole.count();
    if (n > 0) {
      return revealGuidedTarget(page, byRole.first(), timeout);
    }
    const bySelector = guidedSelectorLocator(page, selector);
    const hasButton = bySelector.filter({ has: page.getByRole('button') });
    const hasCount = await hasButton.count();
    if (hasCount > 0) {
      return revealGuidedTarget(page, hasButton.first(), timeout);
    }
    return revealGuidedTarget(page, bySelector.first(), timeout);
  }

  return revealGuidedTarget(page, guidedSelectorLocator(page, selector), timeout);
}

/**
 * Wait until the step's substep index increases or the step completes.
 * Fails if step state becomes 'error' or 'cancelled'.
 * Phase 4.3: If commentBox is provided, after 80% of timeout tries to click Skip button if present.
 * Phase 4.6: Timeout error includes last seen state for diagnostics.
 */
async function waitForSubstepAdvance(
  page: Page,
  stepLocator: Locator,
  previousSubstepIndex: number,
  timeoutMs: number,
  options: { commentBox?: Locator } = {}
): Promise<void> {
  const { commentBox } = options;
  const deadline = Date.now() + timeoutMs;
  const skipAfterMs = Math.floor(timeoutMs * GUIDED_SKIP_AFTER_TIMEOUT_FRACTION);
  let lastState: string | null = null;
  let lastIndex: string | null = null;

  while (Date.now() < deadline) {
    // Unmount mid-wait is a completion signal (section auto-collapse on final substep);
    // a bare getAttribute on a detached locator blocks until the global test timeout.
    if ((await stepLocator.count()) === 0) {
      return;
    }

    try {
      lastState = await stepLocator.getAttribute('data-test-step-state', { timeout: 2000 });
      lastIndex = await stepLocator.getAttribute('data-test-substep-index', { timeout: 2000 });
    } catch {
      if ((await stepLocator.count()) === 0) {
        return;
      }
      lastState = null;
      lastIndex = null;
    }

    if (lastState === 'error') {
      throw new Error('Guided step entered error state');
    }
    if (lastState === 'cancelled') {
      throw new Error('Guided step was cancelled');
    }
    const index = lastIndex != null ? parseInt(lastIndex, 10) : 0;
    if (!Number.isNaN(index) && index > previousSubstepIndex) {
      return;
    }
    if (lastState === 'completed' && lastIndex === null) {
      return;
    }

    const elapsed = Date.now() - (deadline - timeoutMs);
    if (commentBox && elapsed >= skipAfterMs) {
      const skipBtn = commentBox.getByRole('button', { name: /^Skip$/ });
      const count = await skipBtn.count();
      if (count > 0) {
        await dismissBadgeCelebrations(page);
        await skipBtn.click().catch(() => {});
      }
    }

    await page.waitForTimeout(GUIDED_SUBSTEP_ADVANCE_POLL_MS);
  }

  throw new Error(
    `Guided substep did not advance within ${timeoutMs}ms (previous index: ${previousSubstepIndex}, last state: ${lastState ?? 'unknown'}, last substep-index: ${lastIndex ?? 'unknown'})`
  );
}

/**
 * After formfill: debounce, optionally wait for data-test-form-state="valid", or retry once on persistent invalid (Phase 4.1).
 */
export async function waitForFormfillSettle(
  page: Page,
  stepLocator: Locator,
  target: Locator,
  targetValue: string
): Promise<void> {
  await page.waitForTimeout(GUIDED_FORMFILL_DEBOUNCE_MS);

  const validDeadline = Date.now() + GUIDED_FORMFILL_VALID_TIMEOUT_MS;
  let invalidSince: number | null = null;

  const readFormState = async (): Promise<string | null> => {
    if ((await stepLocator.count()) === 0) {
      return null;
    }
    try {
      return await stepLocator.getAttribute('data-test-form-state', { timeout: 2000 });
    } catch {
      return null;
    }
  };

  while (Date.now() < validDeadline) {
    if ((await stepLocator.count()) === 0) {
      return;
    }
    const formState = await readFormState();
    if (formState === 'valid') {
      return;
    }
    if (formState === 'invalid') {
      if (invalidSince == null) {
        invalidSince = Date.now();
      }
      if (Date.now() - invalidSince >= GUIDED_FORMFILL_INVALID_PERSIST_MS) {
        await dismissBadgeCelebrations(page);
        await target.fill(targetValue);
        await page.waitForTimeout(GUIDED_FORMFILL_DEBOUNCE_MS);
        const afterRetry = await readFormState();
        if (afterRetry === 'invalid') {
          throw new Error(
            `Guided step: formfill validation failed (data-test-form-state="invalid" persisted after retry with value "${targetValue}")`
          );
        }
        if (afterRetry === 'valid') {
          return;
        }
        invalidSince = null;
      }
    } else {
      invalidSince = null;
    }
    await page.waitForTimeout(GUIDED_SUBSTEP_ADVANCE_POLL_MS);
  }
  // No valid state on step element (e.g. guided step may not set form-state); proceed to waitForSubstepAdvance
}

/**
 * Outcome of waiting for the guided comment box:
 * - `ready`: the comment box is visible and its contract can be read.
 * - `completed`: the step reached `completed` while we were waiting.
 * - `detached`: the step element was confirmed gone (a successful query
 *   returned zero matches) while we were waiting.
 */
export type GuidedCommentBoxWaitOutcome = 'ready' | 'completed' | 'detached';

/**
 * Wait for the guided comment box to become visible, bounded by an absolute
 * deadline rather than a fixed short constant. Every locator read inside the
 * loop is itself bounded by the remaining time so a missing/slow locator
 * can't silently consume more than this wait's own budget (e.g. the outer
 * test timeout). Polls step state alongside the comment box so a step that
 * has already entered `error`/`cancelled` fails fast, and returns a distinct
 * outcome for `completed`/detached so the caller can treat those as legitimate
 * step completion rather than "comment box never appeared".
 */
export async function waitForGuidedCommentBoxReady(
  page: Page,
  stepLocator: Locator,
  commentBox: Locator,
  timeoutMs = GUIDED_COMMENT_BOX_VISIBLE_TIMEOUT_MS
): Promise<GuidedCommentBoxWaitOutcome> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error('Guided step: comment box not visible');
    }

    if ((await commentBox.count()) > 0 && (await commentBox.isVisible())) {
      return 'ready';
    }

    // Check detachment via an immediate, successful count() BEFORE any bounded
    // attribute read. In real Playwright, getAttribute() on a missing element
    // auto-waits up to its own timeout, so an already-detached step must be
    // caught here first or it would burn the full remaining budget for
    // nothing. A count() error is not caught: it propagates as designed.
    if ((await stepLocator.count()) === 0) {
      return 'detached';
    }

    // Bound this read by the remaining budget so a stuck-but-attached locator
    // can't exceed this wait's own deadline.
    let state: string | null;
    try {
      state = await stepLocator.getAttribute('data-test-step-state', { timeout: remainingMs });
    } catch {
      state = null;
    }

    if (state === 'completed') {
      return 'completed';
    }
    if (state === 'error') {
      throw new Error('Guided step entered error state while waiting for comment box');
    }
    if (state === 'cancelled') {
      throw new Error('Guided step was cancelled while waiting for comment box');
    }

    await page.waitForTimeout(Math.min(GUIDED_SUBSTEP_ADVANCE_POLL_MS, Math.max(1, deadline - Date.now())));
  }
}

/**
 * Run the guided substep loop: read comment box contract, perform action, wait for advance.
 * Phase 4: formfill validation, hover dwell, skippable substeps, navigation re-query, error diagnostics.
 */
export async function runGuidedSubstepLoop(
  page: Page,
  step: TestableStep,
  options: {
    stepLocator: Locator;
    perSubstepTimeoutMs: number;
    /**
     * Absolute deadline (Date.now()-based epoch ms) bounding the cumulative
     * comment-box visibility wait across every substep in this loop. Defaults
     * to `Date.now() + GUIDED_COMMENT_BOX_VISIBLE_TIMEOUT_MS` when omitted.
     */
    commentBoxDeadlineMs?: number;
    verbose?: boolean;
    artifactsDir?: string;
  }
): Promise<{ completed: boolean }> {
  let stepLocator = options.stepLocator;
  const { perSubstepTimeoutMs, verbose = false, artifactsDir } = options;
  const commentBoxDeadlineMs = options.commentBoxDeadlineMs ?? Date.now() + GUIDED_COMMENT_BOX_VISIBLE_TIMEOUT_MS;
  const guidedStepCount = step.guidedStepCount ?? 1;

  const captureLoopArtifacts = async (context: string) => {
    if (artifactsDir) {
      await captureFailureArtifacts(page, step.stepId, [], artifactsDir).catch(() => {});
    }
  };

  // Step unmount mid-loop is a completion signal (section auto-collapse, or
  // navigation unmounted it). Re-resolving the locator handles reload (e.g. a
  // completeEarly action). A query error is NOT treated as detachment here:
  // callers already synchronize on navigation before calling this, so a fault
  // at this point (closed page, destroyed context, unrelated query error)
  // is a genuine failure and must propagate rather than be reported as success.
  const stepDetached = async (): Promise<boolean> => {
    stepLocator = page.getByTestId(testIds.interactive.step(step.stepId));
    return (await stepLocator.count()) === 0;
  };

  while (true) {
    if (await stepDetached()) {
      return { completed: true };
    }

    const state = await stepLocator.getAttribute('data-test-step-state');
    if (state === 'completed') {
      return { completed: true };
    }
    if (state === 'error') {
      await captureLoopArtifacts('error-state');
      throw new Error('Guided step entered error state');
    }
    if (state === 'cancelled') {
      await captureLoopArtifacts('cancelled-state');
      throw new Error('Guided step was cancelled');
    }
    if (state !== 'executing') {
      await captureLoopArtifacts(`unexpected-state-${state}`);
      throw new Error(`Unexpected guided step state: ${state}`);
    }
    const indexStr = await stepLocator.getAttribute('data-test-substep-index');

    const currentIndex = indexStr != null ? parseInt(indexStr, 10) : 0;
    const safeIndex = Number.isNaN(currentIndex) ? 0 : currentIndex;
    if (safeIndex >= guidedStepCount) {
      return { completed: false };
    }

    const commentBox = page.locator('.interactive-comment-box').first();
    let commentBoxOutcome: GuidedCommentBoxWaitOutcome;
    try {
      commentBoxOutcome = await waitForGuidedCommentBoxReady(
        page,
        stepLocator,
        commentBox,
        Math.max(1, commentBoxDeadlineMs - Date.now())
      );
    } catch (err) {
      await captureLoopArtifacts('comment-box-not-visible');
      throw err;
    }
    if (commentBoxOutcome === 'completed' || commentBoxOutcome === 'detached') {
      return { completed: true };
    }

    const action = await commentBox.getAttribute('data-test-action');
    const reftarget = await commentBox.getAttribute('data-test-reftarget');
    const targetValue = await commentBox.getAttribute('data-test-target-value');

    if (verbose) {
      console.log(`   📍 Guided substep ${safeIndex + 1}/${guidedStepCount} action=${action}`);
    }

    try {
      if (action === 'noop') {
        const continueBtn = commentBox.getByRole('button', { name: /Continue/ });
        await dismissBadgeCelebrations(page);
        await continueBtn.click();
      } else if (action === 'button' || action === 'highlight') {
        if (!reftarget) {
          throw new Error('Guided step: button/highlight substep missing data-test-reftarget');
        }
        const urlBefore = page.url();
        let navigated = false;
        const onFrameNavigated = () => {
          navigated = true;
        };
        page.on('framenavigated', onFrameNavigated);
        try {
          const target = await resolveGuidedTarget(page, reftarget, action);
          await target.scrollIntoViewIfNeeded();
          await dismissBadgeCelebrations(page);
          await target.click();
          await page.waitForTimeout(100);
        } finally {
          page.off('framenavigated', onFrameNavigated);
        }
        if (navigated || urlBefore !== page.url()) {
          // The action reloaded/navigated the page (e.g. a completeEarly install).
          // The pre-navigation locator is stale, so wait for the new document to
          // settle before re-resolving the step locator against it. A failed/timed
          // out load is a genuine failure (broken reload) and must propagate, not
          // be swallowed into a false "completed" result.
          await page.waitForLoadState('domcontentloaded', { timeout: GUIDED_RELOAD_LOAD_TIMEOUT_MS });
          stepLocator = page.getByTestId(testIds.interactive.step(step.stepId));
        }
      } else if (action === 'hover') {
        if (!reftarget) {
          throw new Error('Guided step: hover substep missing data-test-reftarget');
        }
        const target = await resolveGuidedTarget(page, reftarget, 'hover');
        await target.scrollIntoViewIfNeeded();
        await dismissBadgeCelebrations(page);
        await target.hover();
        await page.waitForTimeout(GUIDED_HOVER_DWELL_MS);
      } else if (action === 'formfill') {
        if (!reftarget) {
          throw new Error('Guided step: formfill substep missing data-test-reftarget');
        }
        const target = await resolveGuidedTarget(page, reftarget, 'formfill');
        await target.scrollIntoViewIfNeeded();
        await dismissBadgeCelebrations(page);
        await target.fill(targetValue ?? '');
        await waitForFormfillSettle(page, stepLocator, target, targetValue ?? '');
      } else {
        throw new Error(`Guided step: unknown data-test-action "${action}"`);
      }
    } catch (err) {
      await captureLoopArtifacts(`substep-${safeIndex}-${action}`);
      throw err;
    }

    if (await stepDetached()) {
      return { completed: true };
    }

    await waitForSubstepAdvance(page, stepLocator, safeIndex, perSubstepTimeoutMs, { commentBox });
    await page.waitForTimeout(GUIDED_BETWEEN_SUBSTEP_DELAY_MS);
  }
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
 * Click a skippable step's Skip control and wait for the plugin to reach an
 * explicit terminal state — `completed`, or a successful detach — so the
 * next step in a sequential section isn't gated on "Complete previous step".
 * A transient, non-terminal state such as `checking` is not treated as sync;
 * only `completed`/detachment count, so we never mistake mid-flight state
 * for a synchronized skip.
 *
 * Two Skip controls exist in the plugin and both call the same underlying
 * `markSkipped()` action: the step's always-available Skip button (the one
 * `discoverStepsFromDOM` uses to determine `step.skippable`), and the
 * narrower Skip button rendered inside the requirements-explanation banner
 * (surfaced via `detectRequirements().hasSkipButton`). We prefer the general
 * one and fall back to the requirement-scoped one, so we support whichever
 * control the plugin actually rendered instead of assuming a single fixed
 * shape.
 *
 * Throws on any failure (no Skip control found, click error, or a timeout
 * before reaching a terminal state) instead of swallowing it: recording a
 * skip while the plugin never reached `completed`/detached reproduces the
 * exact bug this fixes, so the caller must surface a clear runner failure
 * rather than a false skip.
 *
 * @param page - Playwright Page object
 * @param stepId - The step identifier
 * @param timeout - Maximum time to wait for the terminal state (ms)
 */
export async function clickSkipButtonAndSync(
  page: Page,
  stepId: string,
  timeout = SKIP_SYNC_TIMEOUT_MS
): Promise<void> {
  const stepSkipButton = page.getByTestId(testIds.interactive.skipButton(stepId));
  const requirementSkipButton = page.getByTestId(testIds.interactive.requirementSkipButton(stepId));
  const skipButton = (await stepSkipButton.count()) > 0 ? stepSkipButton : requirementSkipButton;
  if ((await skipButton.count()) === 0) {
    throw new Error(`Step ${stepId}: no Skip control available to sync the requirements-unmet state`);
  }
  await dismissBadgeCelebrations(page);
  await skipButton.click({ timeout });

  const stepLocator = page.getByTestId(testIds.interactive.step(stepId));
  const deadline = Date.now() + timeout;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`Step ${stepId}: Skip did not reach a terminal state within ${timeout}ms`);
    }
    if ((await stepLocator.count()) === 0) {
      return;
    }
    let state: string | null;
    try {
      state = await stepLocator.getAttribute('data-test-step-state', { timeout: remaining });
    } catch {
      state = null;
    }
    if (state === 'completed') {
      return;
    }
    await page.waitForTimeout(Math.min(GUIDED_SUBSTEP_ADVANCE_POLL_MS, Math.max(1, deadline - Date.now())));
  }
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
interface StepExecutionOptions {
  timeout?: number;
  verbose?: boolean;
  /** Directory to write artifacts to (L3-5D). If not set, no artifacts captured. */
  artifactsDir?: string;
  /** Capture screenshots on success, not just failure. Default: false */
  alwaysScreenshot?: boolean;
  onDeadline?(): void;
}

const STEP_CLOSE_TIMEOUT_MS = 1000;
const STEP_WORK_DRAIN_TIMEOUT_MS = 1000;

async function settleWithin(work: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work.then(
        () => undefined,
        () => undefined
      ),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function closePageWithin(page: Page, timeoutMs: number): Promise<void> {
  await settleWithin(page.close({ runBeforeUnload: false }), timeoutMs);
}

export async function executeStep(
  page: Page,
  step: TestableStep,
  options: StepExecutionOptions = {}
): Promise<StepTestResult> {
  const timeout = options.timeout ?? calculateStepTimeout(step);
  const startedAt = Date.now();
  const work = executeStepWork(page, step, { ...options, timeout });

  return new Promise<StepTestResult>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      const currentUrl = page.url();
      options.onDeadline?.();
      void (async () => {
        await closePageWithin(page, STEP_CLOSE_TIMEOUT_MS);
        await settleWithin(work, STEP_WORK_DRAIN_TIMEOUT_MS);
        resolve({
          stepId: step.stepId,
          status: 'failed',
          durationMs: Date.now() - startedAt,
          currentUrl,
          consoleErrors: [],
          error: `Step ${step.stepId} exceeded its ${timeout}ms execution deadline`,
          deadlineExceeded: true,
          skippable: false,
          classification: 'unknown',
        });
      })();
    }, timeout);

    work.then(
      (result) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function executeStepWork(
  page: Page,
  step: TestableStep,
  options: StepExecutionOptions = {}
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
          await clickSkipButtonAndSync(page, step.stepId);
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
    const preClickCompleted = await checkObjectiveCompletion(page, step.stepId);
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

    const discoveredAction = selectStepAction(step);
    let action = await currentStepAction(page, step.stepId);
    if (!action) {
      if (verbose) {
        console.log(`   ⏳ Waiting for a step action to appear...`);
      }
      action = await waitForStepActionToAppear(page, step.stepId, discoveredAction ? 1000 : BUTTON_APPEAR_TIMEOUT_MS);
    }
    if (!action) {
      if (await checkObjectiveCompletion(page, step.stepId)) {
        return {
          stepId: step.stepId,
          status: 'passed',
          durationMs: Date.now() - startTime,
          currentUrl: page.url(),
          consoleErrors,
          skippable: step.skippable,
          artifacts: await buildSuccessArtifacts(page, step.stepId, artifactsDir, alwaysScreenshot, preScreenshotPath),
        };
      }
      if (step.skippable) {
        return createSkippedResult(step, page, startTime, consoleErrors, 'no_do_it_button');
      }
      throw new Error(`No executable Do it or Show me control appeared for mandatory step ${step.stepId}`);
    }
    if (verbose && step.isMultistep) {
      console.log(
        `   ⏱ Multistep detected (${step.internalActionCount} actions), timeout: ${Math.round(timeout / 1000)}s`
      );
    }
    await waitForStepActionEnabled(page, step.stepId, action);
    await dismissBadgeCelebrations(page);
    await stepActionButton(page, step.stepId, action).click();

    if (verbose) {
      console.log(`   → Clicked "${action === 'do-it' ? 'Do it' : 'Show me'}" for step ${step.stepId}`);
    }

    // Allow the reactive system to settle after click (debounced rechecks).
    await page.waitForTimeout(POST_CLICK_SETTLE_DELAY_MS);

    // Phase 3: Guided step — wait for executing, run substep loop, then wait for completion
    if (step.isGuided && step.guidedStepCount != null && step.guidedStepCount > 0) {
      const stepLocator = page.getByTestId(testIds.interactive.step(step.stepId));
      await waitForGuidedExecutionStart(page, stepLocator, GUIDED_WAIT_EXECUTING_MS);
      const { completed } = await runGuidedSubstepLoop(page, step, {
        stepLocator,
        perSubstepTimeoutMs: TIMEOUT_PER_GUIDED_SUBSTEP_MS,
        // Bound the *cumulative* comment-box readiness wait, across every
        // substep, by the step's own timeout budget (which already accounts
        // for guidedStepCount) instead of a fixed 5s re-granted per substep.
        commentBoxDeadlineMs: Date.now() + timeout,
        verbose,
        artifactsDir,
      });
      if (!completed) {
        await waitForCompletionWithObjectivePolling(page, step.stepId, timeout);
      }

      const guidedArtifacts = await buildSuccessArtifacts(
        page,
        step.stepId,
        artifactsDir,
        alwaysScreenshot,
        preScreenshotPath
      );
      if (verbose && guidedArtifacts) {
        console.log(`   📸 Success screenshot captured`);
      }

      return {
        stepId: step.stepId,
        status: 'passed',
        durationMs: Date.now() - startTime,
        currentUrl: page.url(),
        consoleErrors,
        skippable: step.skippable,
        artifacts: guidedArtifacts,
      };
    }

    // Wait for step completion. A detached element here means the step
    // completed (section auto-collapsed) or navigation unmounted it; otherwise
    // poll data-test-step-state. Detects manual and objective-based completion.
    const { completedViaObjectives } = await waitForCompletionWithObjectivePolling(page, step.stepId, timeout);

    if (verbose && completedViaObjectives) {
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
    /** Called before a hard step deadline closes the page. */
    onDeadline?(): void;
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
      if (result.deadlineExceeded || (!step.skippable && stopOnMandatoryFailure)) {
        // Mandatory step failed - abort test
        if (verbose) {
          console.log(`   ❌ Mandatory step failed, aborting remaining steps`);
        }
        aborted = true;
        abortReason = 'MANDATORY_FAILURE';
        abortMessage = result.deadlineExceeded
          ? result.error
          : `Mandatory step ${step.stepId} failed: ${result.error || 'unknown error'}`;
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
  if (artifactsDir && alwaysScreenshot && !results.some((result) => result.deadlineExceeded) && !page.isClosed()) {
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
