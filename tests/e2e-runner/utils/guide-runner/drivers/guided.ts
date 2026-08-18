import type { Locator, Page } from '@playwright/test';

import { testIds } from '../../../../../src/constants/testIds';
import { resolveSelector } from '../../selector-resolver';
import { captureFailureArtifacts } from '../artifacts';
import { dismissBadgeCelebrations } from '../badge-celebrations';
import {
  COMPLETION_POLL_INTERVAL_MS,
  GUIDED_BETWEEN_SUBSTEP_DELAY_MS,
  GUIDED_COMMENT_BOX_VISIBLE_TIMEOUT_MS,
  GUIDED_FORMFILL_DEBOUNCE_MS,
  GUIDED_FORMFILL_INVALID_PERSIST_MS,
  GUIDED_FORMFILL_VALID_TIMEOUT_MS,
  GUIDED_HOVER_DWELL_MS,
  GUIDED_RELOAD_LOAD_TIMEOUT_MS,
  GUIDED_SKIP_AFTER_TIMEOUT_FRACTION,
  GUIDED_SUBSTEP_ADVANCE_POLL_MS,
  GUIDED_TARGET_RESOLUTION_TIMEOUT_MS,
  TIMEOUT_PER_GUIDED_SUBSTEP_MS,
} from '../constants';
import type { TestableStep } from '../types';
import { startStepAction, waitForCompletion } from './shared';
import type { StepDriverExecutionContext, StepDriverExecutionResult } from './types';

// ============================================
// Guided Step Execution (Phase 3)
// ============================================

const GUIDED_WAIT_EXECUTING_MS = 5000;

export async function waitForGuidedExecutionStart(
  page: Page,
  stepLocator: Locator,
  timeout = GUIDED_WAIT_EXECUTING_MS
): Promise<void> {
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

export type GuidedCommentBoxWaitOutcome = 'ready' | 'completed' | 'detached';

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

export async function runGuidedSubstepLoop(
  page: Page,
  step: TestableStep,
  options: {
    stepLocator: Locator;
    perSubstepTimeoutMs: number;
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

export async function executeGuidedStep(context: StepDriverExecutionContext): Promise<StepDriverExecutionResult> {
  const action = await startStepAction(context);
  if (action.outcome !== 'started') {
    return { outcome: action.outcome };
  }

  const stepLocator = context.page.getByTestId(testIds.interactive.step(context.step.stepId));
  await waitForGuidedExecutionStart(context.page, stepLocator);
  const { completed } = await runGuidedSubstepLoop(context.page, context.step, {
    stepLocator,
    perSubstepTimeoutMs: TIMEOUT_PER_GUIDED_SUBSTEP_MS,
    commentBoxDeadlineMs: Date.now() + context.timeout,
    verbose: context.verbose,
    artifactsDir: context.artifactsDir,
  });
  if (!completed) {
    await waitForCompletion(context.page, context.step.stepId, context.timeout);
  }
  return { outcome: 'completed' };
}
