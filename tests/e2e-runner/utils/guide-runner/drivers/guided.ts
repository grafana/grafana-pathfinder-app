import type { Locator, Page } from '@playwright/test';
import { getGuidedStepTimeout } from '../../../../../src/constants/interactive-config';

import { testIds } from '../../../../../src/constants/testIds';
import { assertExhaustive } from '../../../../../src/lib/assert-exhaustive';
import { resolveSelector } from '../../selector-resolver';
import { captureFailureArtifacts } from '../artifacts';
import { dismissBadgeCelebrations } from '../badge-celebrations';
import { classifyError } from '../classification';
import {
  COMPLETION_POLL_INTERVAL_MS,
  DEFAULT_STEP_TIMEOUT_MS,
  GUIDED_FORMFILL_DEBOUNCE_MS,
  GUIDED_FORMFILL_INVALID_PERSIST_MS,
  GUIDED_FORMFILL_VALID_TIMEOUT_MS,
  GUIDED_HOVER_DWELL_MS,
  GUIDED_RELOAD_LOAD_TIMEOUT_MS,
  GUIDED_SUBSTEP_ADVANCE_POLL_MS,
  GUIDED_TARGET_RESOLUTION_TIMEOUT_MS,
} from '../constants';
import { isFatalTransitionError } from '../transition-error';
import type { StepSubstepResult, TestableStep } from '../types';
import { captureGuidedEvidence, isGuidedAction, type GuidedEvidence, type GuidedSnapshot } from './guided-evidence';
import { startStepAction } from './shared';
import type { StepDriverExecutionContext, StepDriverExecutionResult } from './types';
function operationTimeout(deadlineMs: number, limit = GUIDED_TARGET_RESOLUTION_TIMEOUT_MS): number {
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) {
    throw new Error('Guided substep deadline expired');
  }
  return Math.min(remaining, limit);
}

async function pause(page: Page, durationMs: number, deadlineMs: number): Promise<void> {
  const remaining = deadlineMs - Date.now();
  if (remaining > 0) {
    await page.waitForTimeout(Math.min(durationMs, remaining));
  }
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

async function revealGuidedTarget(page: Page, target: Locator, deadlineMs: number): Promise<Locator> {
  if (await target.isVisible()) {
    return target;
  }
  if ((await target.count()) > 0) {
    const panel = target.locator('xpath=ancestor::section[1]');
    if ((await panel.count()) > 0) {
      await panel.scrollIntoViewIfNeeded({ timeout: operationTimeout(deadlineMs) }).catch(() => {});
      await dismissBadgeCelebrations(page);
      await panel.hover({ timeout: operationTimeout(deadlineMs) }).catch(() => {});
      if (await target.isVisible()) {
        return target;
      }
      const menuButton = panel.locator('button[data-testid^="data-testid Panel menu "]').first();
      if ((await menuButton.count()) > 0 && (await menuButton.isVisible())) {
        return menuButton;
      }
    }
  }
  await target.waitFor({ state: 'visible', timeout: operationTimeout(deadlineMs) });
  return target;
}

async function resolveGuidedTarget(
  page: Page,
  reftarget: string,
  actionType: string,
  deadlineMs: number
): Promise<Locator> {
  await dismissBadgeCelebrations(page);
  const selector = reftarget.startsWith('grafana:') ? resolveSelector(reftarget) : reftarget;

  if (actionType === 'button') {
    const byRole = page.getByRole('button', { name: reftarget });
    const n = await byRole.count();
    if (n > 0) {
      return revealGuidedTarget(page, byRole.first(), deadlineMs);
    }
    const bySelector = guidedSelectorLocator(page, selector);
    const hasButton = bySelector.filter({ has: page.getByRole('button') });
    const hasCount = await hasButton.count();
    if (hasCount > 0) {
      return revealGuidedTarget(page, hasButton.first(), deadlineMs);
    }
    return revealGuidedTarget(page, bySelector.first(), deadlineMs);
  }

  return revealGuidedTarget(page, guidedSelectorLocator(page, selector), deadlineMs);
}

export async function waitForFormfillSettle(
  page: Page,
  stepLocator: Locator,
  target: Locator,
  targetValue: string,
  options: { deadlineMs?: number; isCurrent?: () => Promise<boolean> } = {}
): Promise<void> {
  const deadlineMs = options.deadlineMs ?? Date.now() + GUIDED_FORMFILL_VALID_TIMEOUT_MS + GUIDED_FORMFILL_DEBOUNCE_MS;
  await pause(page, GUIDED_FORMFILL_DEBOUNCE_MS, deadlineMs);
  const validDeadline = Math.min(deadlineMs, Date.now() + GUIDED_FORMFILL_VALID_TIMEOUT_MS);
  let invalidSince: number | null = null;

  const readFormState = async (): Promise<string | null> => {
    if ((await stepLocator.count()) === 0) {
      return null;
    }
    try {
      return await stepLocator.getAttribute('data-test-form-state', { timeout: operationTimeout(validDeadline, 2000) });
    } catch {
      return null;
    }
  };

  while (Date.now() < validDeadline) {
    if ((options.isCurrent && !(await options.isCurrent())) || (await stepLocator.count()) === 0) {
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
        if (options.isCurrent && !(await options.isCurrent())) {
          return;
        }
        await target.fill(targetValue, { timeout: operationTimeout(validDeadline) });
        await pause(page, GUIDED_FORMFILL_DEBOUNCE_MS, validDeadline);
        const afterRetry = await readFormState();
        if (afterRetry === 'invalid') {
          throw new Error('Guided formfill validation remained invalid after retry');
        }
        if (afterRetry === 'valid') {
          return;
        }
        invalidSince = null;
      }
    } else {
      invalidSince = null;
    }
    await pause(page, GUIDED_SUBSTEP_ADVANCE_POLL_MS, validDeadline);
  }
}

export type GuidedCommentBoxWaitOutcome = 'ready' | 'completed' | 'detached';

export async function waitForGuidedCommentBoxReady(
  page: Page,
  stepLocator: Locator,
  commentBox: Locator,
  timeoutMs = getGuidedStepTimeout()
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

    // Count first because Playwright waits for attributes on a missing locator.
    if ((await stepLocator.count()) === 0) {
      return 'detached';
    }

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

function assertGuidedState(snapshot: GuidedSnapshot): void {
  const failed = snapshot.substeps?.find((result) => result.status !== 'completed' && result.status !== 'skipped');
  if (failed) {
    throw new Error(`Guided substep ${failed.index + 1} settled as ${failed.status}`);
  }
  if (snapshot.state === 'error' || snapshot.state === 'cancelled') {
    throw new Error(`Guided step entered ${snapshot.state} state`);
  }
}

function isCurrentSubstep(snapshot: GuidedSnapshot, index: number): boolean {
  return (
    snapshot.attached &&
    snapshot.state === 'executing' &&
    snapshot.index === index &&
    !snapshot.substeps?.some((result) => result.index === index)
  );
}

function currentCommentBox(page: Page, index: number, hasLedger: boolean): Locator {
  const indexed = `.interactive-comment-box[data-test-substep-index="${index}"]`;
  const selector = hasLedger ? indexed : `${indexed}, .interactive-comment-box:not([data-test-substep-index])`;
  return page.locator(selector).filter({ visible: true }).first();
}

interface GuidedComment {
  action: StepSubstepResult['action'];
  reftarget: string | null;
  targetValue: string | null;
}

class GuidedContractError extends Error {}
class GuidedNavigationError extends Error {}

async function readGuidedComment(commentBox: Locator, deadlineMs: number): Promise<GuidedComment> {
  const comment = await commentBox.evaluate(
    (element) => ({
      action: element.getAttribute('data-test-action'),
      reftarget: element.getAttribute('data-test-reftarget'),
      targetValue: element.getAttribute('data-test-target-value'),
    }),
    undefined,
    { timeout: operationTimeout(deadlineMs) }
  );
  if (!isGuidedAction(comment.action)) {
    throw new GuidedContractError(`Guided step: unknown data-test-action "${comment.action}"`);
  }
  if (comment.action !== 'noop' && !comment.reftarget) {
    throw new GuidedContractError(`Guided step: ${comment.action} substep missing data-test-reftarget`);
  }
  return { ...comment, action: comment.action };
}

async function performGuidedAction(
  page: Page,
  stepLocator: Locator,
  commentBox: Locator,
  comment: GuidedComment,
  deadlineMs: number,
  isCurrent: () => Promise<boolean>
): Promise<void> {
  if (comment.action === 'noop') {
    await dismissBadgeCelebrations(page);
    if (await isCurrent()) {
      await commentBox.getByRole('button', { name: /Continue/ }).click({ timeout: operationTimeout(deadlineMs) });
    }
    return;
  }
  const target = await resolveGuidedTarget(page, comment.reftarget!, comment.action, deadlineMs);
  if (!(await isCurrent())) {
    return;
  }
  await target.scrollIntoViewIfNeeded({ timeout: operationTimeout(deadlineMs) });
  await dismissBadgeCelebrations(page);
  if (!(await isCurrent())) {
    return;
  }

  switch (comment.action) {
    case 'button':
    case 'highlight': {
      const urlBefore = page.url();
      let navigated = false;
      const onFrameNavigated = () => {
        navigated = true;
      };
      page.on('framenavigated', onFrameNavigated);
      try {
        await target.click({ timeout: operationTimeout(deadlineMs) });
        await pause(page, 100, deadlineMs);
      } finally {
        page.off('framenavigated', onFrameNavigated);
      }
      if (navigated || urlBefore !== page.url()) {
        try {
          await page.waitForLoadState('domcontentloaded', {
            timeout: operationTimeout(deadlineMs, GUIDED_RELOAD_LOAD_TIMEOUT_MS),
          });
        } catch (error) {
          throw new GuidedNavigationError(error instanceof Error ? error.message : String(error));
        }
      }
      return;
    }
    case 'hover':
      await target.hover({ timeout: operationTimeout(deadlineMs) });
      await pause(page, GUIDED_HOVER_DWELL_MS, deadlineMs);
      return;
    case 'formfill':
      await target.fill(comment.targetValue ?? '', { timeout: operationTimeout(deadlineMs) });
      await waitForFormfillSettle(page, stepLocator, target, comment.targetValue ?? '', { deadlineMs, isCurrent });
      return;
    default:
      assertExhaustive(comment.action);
  }
}

async function skipFailedGuidedAction(
  page: Page,
  evidence: GuidedEvidence,
  index: number,
  deadlineMs: number,
  error: unknown
): Promise<boolean> {
  const message = error instanceof Error ? error.message : String(error);
  if (
    isFatalTransitionError(error) ||
    error instanceof GuidedContractError ||
    error instanceof GuidedNavigationError ||
    classifyError(message) === 'infrastructure'
  ) {
    return false;
  }
  const snapshot = await evidence.read();
  assertGuidedState(snapshot);
  if (!isCurrentSubstep(snapshot, index)) {
    return true;
  }
  const commentBox = currentCommentBox(page, index, snapshot.substeps !== undefined);
  if ((await commentBox.count()) === 0) {
    return false;
  }
  const boxSkippable = await commentBox.getAttribute('data-test-substep-skippable', {
    timeout: operationTimeout(deadlineMs),
  });
  const skipButton = commentBox.getByRole('button', { name: /^Skip$/ });
  const visibleSkip = await skipButton.isVisible();
  const skippable =
    snapshot.skippable ??
    (boxSkippable === null ? snapshot.substeps === undefined && visibleSkip : boxSkippable === 'true');
  if (
    !skippable ||
    boxSkippable === 'false' ||
    (snapshot.substeps !== undefined && boxSkippable !== 'true') ||
    !visibleSkip ||
    !(await skipButton.isEnabled())
  ) {
    return false;
  }
  await dismissBadgeCelebrations(page);
  if (!isCurrentSubstep(await evidence.read(), index)) {
    return true;
  }
  await skipButton.click({ timeout: operationTimeout(deadlineMs) });
  evidence.recordActionFailure(index, message);
  return true;
}

interface GuidedLoopOptions {
  stepLocator: Locator;
  perSubstepTimeoutMs?: number;
  commentBoxDeadlineMs?: number;
  verbose?: boolean;
  artifactsDir?: string;
  onSubsteps?: (substeps: StepSubstepResult[]) => void;
}

async function driveGuidedSubsteps(
  page: Page,
  step: TestableStep,
  options: GuidedLoopOptions,
  evidence: GuidedEvidence
): Promise<void> {
  let activeIndex: number | undefined;
  let settledIndex: number | undefined;
  let deadlineMs = options.commentBoxDeadlineMs ?? Date.now() + getGuidedStepTimeout(options.perSubstepTimeoutMs);
  const attempted = new Set<number>();

  for (;;) {
    const snapshot = await evidence.read();
    assertGuidedState(snapshot);
    if (snapshot.state === 'completed' || !snapshot.attached) {
      return;
    }
    const index = snapshot.index;
    if (index !== activeIndex) {
      activeIndex = index;
      const timeout = options.perSubstepTimeoutMs ?? snapshot.timeoutMs;
      deadlineMs = Math.min(Date.now() + timeout, options.commentBoxDeadlineMs ?? Number.POSITIVE_INFINITY);
    }
    if (index !== undefined && settledIndex !== index && snapshot.substeps?.some((record) => record.index === index)) {
      settledIndex = index;
      deadlineMs = options.commentBoxDeadlineMs ?? Date.now() + DEFAULT_STEP_TIMEOUT_MS;
    }
    if (Date.now() >= deadlineMs) {
      throw new Error(
        `Guided substep ${index === undefined ? 'unknown' : index + 1} did not settle before its deadline`
      );
    }
    if (index === undefined || !isCurrentSubstep(snapshot, index) || attempted.has(index)) {
      await pause(page, GUIDED_SUBSTEP_ADVANCE_POLL_MS, deadlineMs);
      continue;
    }
    const commentBox = currentCommentBox(page, index, snapshot.substeps !== undefined);
    if ((await commentBox.count()) === 0) {
      await pause(page, GUIDED_SUBSTEP_ADVANCE_POLL_MS, deadlineMs);
      continue;
    }
    let comment: GuidedComment;
    try {
      comment = await readGuidedComment(commentBox, deadlineMs);
    } catch (error) {
      const current = await evidence.read();
      assertGuidedState(current);
      if (!isCurrentSubstep(current, index)) {
        continue;
      }
      throw error;
    }
    const isCurrent = async () => {
      const current = await evidence.read();
      assertGuidedState(current);
      return isCurrentSubstep(current, index);
    };
    if (!(await isCurrent())) {
      continue;
    }
    if (options.verbose) {
      console.log(`   Guided substep ${index + 1}/${step.actionCount}: ${comment.action}`);
    }
    try {
      await performGuidedAction(page, options.stepLocator, commentBox, comment, deadlineMs, isCurrent);
    } catch (error) {
      if (!(await skipFailedGuidedAction(page, evidence, index, deadlineMs, error))) {
        throw error;
      }
    }
    attempted.add(index);
  }
}

async function captureGuidedFailure(
  page: Page,
  step: TestableStep,
  evidence: GuidedEvidence,
  artifactsDir?: string
): Promise<void> {
  await evidence.read().catch(() => undefined);
  if (artifactsDir) {
    await captureFailureArtifacts(page, step.stepId, [], artifactsDir).catch(() => undefined);
  }
}

export async function runGuidedSubstepLoop(
  page: Page,
  step: TestableStep,
  options: GuidedLoopOptions
): Promise<{ completed: boolean; substeps?: StepSubstepResult[] }> {
  const evidence = await captureGuidedEvidence(options.stepLocator, options.onSubsteps);
  try {
    await driveGuidedSubsteps(page, step, options, evidence);
    assertGuidedState(await evidence.read());
    return { completed: true, ...(evidence.results() !== undefined ? { substeps: evidence.results() } : {}) };
  } catch (error) {
    await captureGuidedFailure(page, step, evidence, options.artifactsDir);
    throw error;
  } finally {
    await evidence.dispose();
  }
}

export async function executeGuidedStep(context: StepDriverExecutionContext): Promise<StepDriverExecutionResult> {
  const { page, step } = context;
  const stepLocator = page.getByTestId(testIds.interactive.step(step.stepId));
  const evidence = await captureGuidedEvidence(stepLocator, context.onSubsteps);
  try {
    const action = await startStepAction(context);
    if (action.outcome === 'started') {
      await driveGuidedSubsteps(
        page,
        step,
        { stepLocator, commentBoxDeadlineMs: Date.now() + context.timeout, verbose: context.verbose },
        evidence
      );
    }
    assertGuidedState(await evidence.read());
    return {
      outcome: action.outcome === 'no-control' ? 'no-control' : 'completed',
      ...(evidence.results() !== undefined ? { substeps: evidence.results() } : {}),
    };
  } catch (error) {
    await captureGuidedFailure(page, step, evidence, context.artifactsDir);
    throw error;
  } finally {
    await evidence.dispose();
  }
}
