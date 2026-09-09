import type { Locator, Page } from '@playwright/test';

import { testIds } from '../../../../../src/constants/testIds';
import {
  GUIDED_SUBSTEP_SETTLED_EVENT,
  type GuidedSubstepSettledDetail,
} from '../../../../../src/types/interactive-actions.types';
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
  GUIDED_SUBSTEP_ADVANCE_POLL_MS,
  GUIDED_TARGET_RESOLUTION_TIMEOUT_MS,
  TIMEOUT_PER_GUIDED_SUBSTEP_MS,
} from '../constants';
import type { ArtifactPaths, GuidedSubstepResult, TestableStep } from '../types';
import { startStepAction, waitForCompletion } from './shared';
import type { StepDriverExecutionContext, StepDriverExecutionResult } from './types';

const GUIDED_WAIT_EXECUTING_MS = 5000;
let guidedCollectorId = 0;

function remainingTimeout(deadline: number, maximum = Number.POSITIVE_INFINITY): number {
  return Math.max(1, Math.min(maximum, deadline - Date.now()));
}

function isGuidedSubstepDetail(value: unknown, stepId: string): value is GuidedSubstepSettledDetail {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const detail = value as Partial<GuidedSubstepSettledDetail>;
  return (
    detail.stepId === stepId &&
    Number.isInteger(detail.index) &&
    detail.index! >= 0 &&
    Number.isInteger(detail.total) &&
    detail.total! > 0 &&
    detail.index! < detail.total! &&
    typeof detail.action === 'string' &&
    ['completed', 'skipped', 'timeout', 'cancelled', 'error'].includes(detail.outcome ?? '') &&
    typeof detail.durationMs === 'number' &&
    Number.isFinite(detail.durationMs) &&
    detail.durationMs >= 0 &&
    typeof detail.skippable === 'boolean'
  );
}

async function installGuidedSettlementCollector(context: StepDriverExecutionContext): Promise<() => Promise<void>> {
  if (
    typeof context.page.exposeFunction !== 'function' ||
    typeof context.page.evaluate !== 'function' ||
    !context.onGuidedSubstepSettled
  ) {
    return async () => undefined;
  }

  guidedCollectorId += 1;
  const bindingName = `__pathfinderGuidedSettlement${guidedCollectorId}`;
  const listenerName = `${bindingName}Listener`;
  const storageKey = `pathfinder-e2e-guided-${Date.now()}-${guidedCollectorId}`;
  const activeKey = `${storageKey}-active`;
  const seen = new Set<string>();
  const record = (value: unknown) => {
    if (!isGuidedSubstepDetail(value, context.step.stepId)) {
      return;
    }
    const key = JSON.stringify(value);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    const result: GuidedSubstepResult = {
      index: value.index,
      total: value.total,
      action: value.action,
      outcome: value.outcome,
      durationMs: value.durationMs,
      timeoutMs: context.step.guidedStepTimeoutMs ?? TIMEOUT_PER_GUIDED_SUBSTEP_MS,
      skippable: value.skippable,
    };
    context.onGuidedSubstepSettled?.(result);
  };

  await context.page.exposeFunction(bindingName, record);
  const collector = {
    bindingName,
    listenerName,
    storageKey,
    activeKey,
    stepId: context.step.stepId,
    eventName: GUIDED_SUBSTEP_SETTLED_EVENT,
  };
  await context.page.evaluate(
    ({ bindingName: name, listenerName, storageKey: evidenceKey, activeKey: enabledKey, stepId, eventName }) => {
      sessionStorage.setItem(evidenceKey, '[]');
      sessionStorage.setItem(enabledKey, 'true');
      const listener = (event: Event) => {
        if (sessionStorage.getItem(enabledKey) !== 'true') {
          return;
        }
        const detail = (event as CustomEvent<GuidedSubstepSettledDetail>).detail;
        if (detail?.stepId !== stepId) {
          return;
        }
        const current = JSON.parse(sessionStorage.getItem(evidenceKey) ?? '[]') as unknown[];
        current.push(detail);
        sessionStorage.setItem(evidenceKey, JSON.stringify(current));
        const binding = (window as unknown as Record<string, ((value: unknown) => Promise<void>) | undefined>)[name];
        void binding?.(detail);
      };
      (window as unknown as Record<string, EventListener | undefined>)[listenerName] = listener;
      document.addEventListener(eventName, listener);
    },
    collector
  );

  return async () => {
    const stored = await context.page
      .evaluate(({ listenerName, storageKey: evidenceKey, activeKey: enabledKey, eventName }) => {
        sessionStorage.setItem(enabledKey, 'false');
        const listeners = window as unknown as Record<string, EventListener | undefined>;
        const listener = listeners[listenerName];
        if (listener) {
          document.removeEventListener(eventName, listener);
          delete listeners[listenerName];
        }
        const value = sessionStorage.getItem(evidenceKey);
        sessionStorage.removeItem(evidenceKey);
        sessionStorage.removeItem(enabledKey);
        return value;
      }, collector)
      .catch(() => null);
    if (!stored) {
      return;
    }
    try {
      const values = JSON.parse(stored) as unknown[];
      values.forEach(record);
    } catch {
      return;
    }
  };
}

export async function waitForGuidedExecutionStart(
  page: Page,
  stepLocator: Locator,
  timeout = GUIDED_WAIT_EXECUTING_MS
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await stepLocator.getAttribute('data-test-step-state', { timeout: remainingTimeout(deadline) });
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

async function resolveGuidedTarget(
  page: Page,
  reftarget: string,
  actionType: string,
  timeout = GUIDED_TARGET_RESOLUTION_TIMEOUT_MS
): Promise<Locator> {
  await dismissBadgeCelebrations(page);
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
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastState: string | null = null;
  let lastIndex: string | null = null;

  while (Date.now() < deadline) {
    // Count first because Playwright waits for attributes on a missing locator.
    if ((await stepLocator.count()) === 0) {
      return;
    }

    try {
      lastState = await stepLocator.getAttribute('data-test-step-state', {
        timeout: remainingTimeout(deadline, 2000),
      });
      lastIndex = await stepLocator.getAttribute('data-test-substep-index', {
        timeout: remainingTimeout(deadline, 2000),
      });
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

    await page.waitForTimeout(Math.min(GUIDED_SUBSTEP_ADVANCE_POLL_MS, Math.max(0, deadline - Date.now())));
  }

  throw new Error(
    `Guided substep did not advance within ${timeoutMs}ms (previous index: ${previousSubstepIndex}, last state: ${lastState ?? 'unknown'}, last substep-index: ${lastIndex ?? 'unknown'})`
  );
}

export async function waitForFormfillSettle(
  page: Page,
  stepLocator: Locator,
  target: Locator,
  targetValue: string,
  deadline = Date.now() + GUIDED_FORMFILL_DEBOUNCE_MS + GUIDED_FORMFILL_VALID_TIMEOUT_MS
): Promise<void> {
  await page.waitForTimeout(Math.min(GUIDED_FORMFILL_DEBOUNCE_MS, Math.max(0, deadline - Date.now())));

  const validDeadline = Math.min(deadline, Date.now() + GUIDED_FORMFILL_VALID_TIMEOUT_MS);
  let invalidSince: number | null = null;

  const readFormState = async (): Promise<string | null> => {
    if ((await stepLocator.count()) === 0) {
      return null;
    }
    if (Date.now() >= deadline) {
      return null;
    }
    try {
      return await stepLocator.getAttribute('data-test-form-state', {
        timeout: remainingTimeout(deadline, 2000),
      });
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
        await target.fill(targetValue, { timeout: remainingTimeout(deadline) });
        await page.waitForTimeout(Math.min(GUIDED_FORMFILL_DEBOUNCE_MS, Math.max(0, deadline - Date.now())));
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
    await page.waitForTimeout(Math.min(GUIDED_SUBSTEP_ADVANCE_POLL_MS, Math.max(0, deadline - Date.now())));
  }
}

export type GuidedCommentBoxWaitOutcome = 'ready' | 'advanced' | 'completed' | 'detached';

export async function waitForGuidedCommentBoxReady(
  page: Page,
  stepLocator: Locator,
  commentBox: Locator,
  timeoutMs = GUIDED_COMMENT_BOX_VISIBLE_TIMEOUT_MS,
  previousSubstepIndex?: number
): Promise<GuidedCommentBoxWaitOutcome> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error('Guided step: comment box not visible');
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
    if (previousSubstepIndex !== undefined) {
      const indexReadTimeout = deadline - Date.now();
      if (indexReadTimeout <= 0) {
        throw new Error('Guided step: comment box not visible');
      }
      const rawIndex = await stepLocator.getAttribute('data-test-substep-index', { timeout: indexReadTimeout });
      const index = rawIndex === null ? Number.NaN : Number.parseInt(rawIndex, 10);
      if (Number.isFinite(index) && index > previousSubstepIndex) {
        return 'advanced';
      }
    }
    if ((await commentBox.count()) > 0 && (await commentBox.isVisible())) {
      return 'ready';
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
  const actionCount = Math.max(1, step.actionCount);

  const captureLoopError = async (error: unknown): Promise<Error> => {
    const normalized = error instanceof Error ? error : new Error(String(error));
    if (!artifactsDir) {
      return normalized;
    }
    const artifacts = await captureFailureArtifacts(page, step.stepId, [], artifactsDir).catch(() => undefined);
    if (artifacts) {
      (normalized as Error & { artifacts?: ArtifactPaths }).artifacts = artifacts;
    }
    return normalized;
  };

  // Re-resolve after navigation, but propagate locator errors as execution failures.
  const stepDetached = async (): Promise<boolean> => {
    stepLocator = page.getByTestId(testIds.interactive.step(step.stepId));
    return (await stepLocator.count()) === 0;
  };

  while (true) {
    if (await stepDetached()) {
      return { completed: true };
    }

    const substepDeadline = Date.now() + perSubstepTimeoutMs;
    const state = await stepLocator.getAttribute('data-test-step-state', {
      timeout: remainingTimeout(substepDeadline),
    });
    if (state === 'completed') {
      return { completed: true };
    }
    if (state === 'error') {
      throw await captureLoopError(new Error('Guided step entered error state'));
    }
    if (state === 'cancelled') {
      throw await captureLoopError(new Error('Guided step was cancelled'));
    }
    if (state !== 'executing') {
      throw await captureLoopError(new Error(`Unexpected guided step state: ${state}`));
    }
    const indexStr = await stepLocator.getAttribute('data-test-substep-index', {
      timeout: remainingTimeout(substepDeadline),
    });

    const currentIndex = indexStr != null ? parseInt(indexStr, 10) : 0;
    const safeIndex = Number.isNaN(currentIndex) ? 0 : currentIndex;
    if (safeIndex >= actionCount) {
      return { completed: false };
    }
    const isSkippable =
      (await stepLocator.getAttribute('data-test-substep-skippable', {
        timeout: remainingTimeout(substepDeadline),
      })) === 'true';

    const commentBox = page.locator('.interactive-comment-box').first();
    let commentBoxOutcome: GuidedCommentBoxWaitOutcome;
    try {
      commentBoxOutcome = await waitForGuidedCommentBoxReady(
        page,
        stepLocator,
        commentBox,
        Math.max(1, Math.min(options.commentBoxDeadlineMs ?? substepDeadline, substepDeadline) - Date.now()),
        safeIndex
      );
    } catch (err) {
      if (isSkippable) {
        const skipButton = commentBox.getByRole('button', { name: /^(Skip|Skip this step)$/ });
        if ((await skipButton.count()) > 0) {
          await dismissBadgeCelebrations(page);
          await skipButton.click({ timeout: remainingTimeout(substepDeadline) });
          await waitForSubstepAdvance(page, stepLocator, safeIndex, remainingTimeout(substepDeadline));
          continue;
        } else {
          throw await captureLoopError(err);
        }
      } else {
        throw await captureLoopError(err);
      }
    }
    if (commentBoxOutcome === 'completed' || commentBoxOutcome === 'detached') {
      return { completed: true };
    }
    if (commentBoxOutcome === 'advanced') {
      continue;
    }

    const action = await commentBox.getAttribute('data-test-action', {
      timeout: remainingTimeout(substepDeadline),
    });
    const reftarget = await commentBox.getAttribute('data-test-reftarget', {
      timeout: remainingTimeout(substepDeadline),
    });
    const targetValue = await commentBox.getAttribute('data-test-target-value', {
      timeout: remainingTimeout(substepDeadline),
    });

    if (verbose) {
      console.log(`   📍 Guided substep ${safeIndex + 1}/${actionCount} action=${action}`);
    }

    try {
      if (action === 'noop') {
        const continueBtn = commentBox.getByRole('button', { name: /Continue/ });
        await dismissBadgeCelebrations(page);
        await continueBtn.click({ timeout: remainingTimeout(substepDeadline) });
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
          const target = await resolveGuidedTarget(
            page,
            reftarget,
            action,
            remainingTimeout(substepDeadline, GUIDED_TARGET_RESOLUTION_TIMEOUT_MS)
          );
          await target.scrollIntoViewIfNeeded({ timeout: remainingTimeout(substepDeadline) });
          await dismissBadgeCelebrations(page);
          await target.click({ timeout: remainingTimeout(substepDeadline) });
          await page.waitForTimeout(Math.min(100, Math.max(0, substepDeadline - Date.now())));
        } finally {
          page.off('framenavigated', onFrameNavigated);
        }
        if (navigated || urlBefore !== page.url()) {
          // Navigation invalidates the old locator, so wait for the new document.
          await page.waitForLoadState('domcontentloaded', {
            timeout: remainingTimeout(substepDeadline, GUIDED_RELOAD_LOAD_TIMEOUT_MS),
          });
          stepLocator = page.getByTestId(testIds.interactive.step(step.stepId));
        }
      } else if (action === 'hover') {
        if (!reftarget) {
          throw new Error('Guided step: hover substep missing data-test-reftarget');
        }
        const target = await resolveGuidedTarget(
          page,
          reftarget,
          'hover',
          remainingTimeout(substepDeadline, GUIDED_TARGET_RESOLUTION_TIMEOUT_MS)
        );
        await target.scrollIntoViewIfNeeded({ timeout: remainingTimeout(substepDeadline) });
        await dismissBadgeCelebrations(page);
        await target.hover({ timeout: remainingTimeout(substepDeadline) });
        await page.waitForTimeout(Math.min(GUIDED_HOVER_DWELL_MS, Math.max(0, substepDeadline - Date.now())));
      } else if (action === 'formfill') {
        if (!reftarget) {
          throw new Error('Guided step: formfill substep missing data-test-reftarget');
        }
        const target = await resolveGuidedTarget(
          page,
          reftarget,
          'formfill',
          remainingTimeout(substepDeadline, GUIDED_TARGET_RESOLUTION_TIMEOUT_MS)
        );
        await target.scrollIntoViewIfNeeded({ timeout: remainingTimeout(substepDeadline) });
        await dismissBadgeCelebrations(page);
        await target.fill(targetValue ?? '', { timeout: remainingTimeout(substepDeadline) });
        await waitForFormfillSettle(page, stepLocator, target, targetValue ?? '', substepDeadline);
      } else {
        throw new Error(`Guided step: unknown data-test-action "${action}"`);
      }
    } catch (err) {
      if (isSkippable) {
        const skipButton = commentBox.getByRole('button', { name: /^(Skip|Skip this step)$/ });
        if ((await skipButton.count()) > 0) {
          await dismissBadgeCelebrations(page);
          await skipButton.click({ timeout: Math.max(1, substepDeadline - Date.now()) });
        } else {
          throw await captureLoopError(err);
        }
      } else {
        throw await captureLoopError(err);
      }
    }

    if (await stepDetached()) {
      return { completed: true };
    }

    await waitForSubstepAdvance(page, stepLocator, safeIndex, remainingTimeout(substepDeadline));
    await page.waitForTimeout(GUIDED_BETWEEN_SUBSTEP_DELAY_MS);
  }
}

export async function executeGuidedStep(context: StepDriverExecutionContext): Promise<StepDriverExecutionResult> {
  const stopCollector = await installGuidedSettlementCollector(context);
  try {
    const action = await startStepAction(context);
    if (action.outcome !== 'started') {
      return { outcome: action.outcome };
    }

    const stepLocator = context.page.getByTestId(testIds.interactive.step(context.step.stepId));
    await waitForGuidedExecutionStart(context.page, stepLocator);
    const { completed } = await runGuidedSubstepLoop(context.page, context.step, {
      stepLocator,
      perSubstepTimeoutMs: context.step.guidedStepTimeoutMs ?? TIMEOUT_PER_GUIDED_SUBSTEP_MS,
      verbose: context.verbose,
      artifactsDir: context.artifactsDir,
    });
    if (!completed) {
      await waitForCompletion(context.page, context.step.stepId, context.timeout);
    }
    return { outcome: 'completed' };
  } finally {
    await stopCollector();
  }
}
