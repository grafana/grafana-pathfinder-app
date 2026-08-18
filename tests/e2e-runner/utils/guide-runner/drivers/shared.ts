import { expect, type Locator, type Page } from '@playwright/test';

import { testIds } from '../../../../../src/constants/testIds';
import { dismissBadgeCelebrations } from '../badge-celebrations';
import {
  BUTTON_APPEAR_TIMEOUT_MS,
  BUTTON_ENABLE_TIMEOUT_MS,
  COMPLETION_POLL_INTERVAL_MS,
  DEFAULT_STEP_TIMEOUT_MS,
  GUIDED_SUBSTEP_ADVANCE_POLL_MS,
  POST_CLICK_SETTLE_DELAY_MS,
  SKIP_SYNC_TIMEOUT_MS,
} from '../constants';
import type { StepDriverExecutionContext, StepDriverExecutionResult, StepDriverInspection } from './types';

export type StepAction = 'do-it' | 'show-me';

export function selectStepAction(input: { hasDoItButton: boolean; hasShowMeButton: boolean }): StepAction | undefined {
  if (input.hasDoItButton) {
    return 'do-it';
  }
  if (input.hasShowMeButton) {
    return 'show-me';
  }
  return undefined;
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

export async function inspectCommonStep(
  page: Page,
  root: Locator,
  stepId: string
): Promise<Omit<StepDriverInspection, 'isMultistep' | 'internalActionCount' | 'isGuided' | 'guidedStepCount'>> {
  const targetAction = (await root.getAttribute('data-targetaction')) ?? undefined;
  const refTarget = (await root.getAttribute('data-reftarget')) ?? undefined;
  const hasDoItButton = (await page.getByTestId(testIds.interactive.doItButton(stepId)).count()) > 0;
  const hasShowMeButton = (await page.getByTestId(testIds.interactive.showMeButton(stepId)).count()) > 0;
  const isPreCompleted = await page.getByTestId(testIds.interactive.stepCompleted(stepId)).isVisible();
  const skippable =
    targetAction !== 'noop' &&
    !isPreCompleted &&
    (await page.getByTestId(testIds.interactive.skipButton(stepId)).count()) > 0;

  return {
    skippable,
    hasDoItButton,
    hasShowMeButton,
    isPreCompleted,
    targetAction,
    refTarget,
  };
}

export async function isStepComplete(page: Page, stepId: string): Promise<boolean> {
  return (
    (await page.getByTestId(testIds.interactive.step(stepId)).getAttribute('data-test-step-state')) === 'completed'
  );
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

export async function waitForCompletion(
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
      return { completedViaObjectives: Date.now() - startTime < COMPLETION_POLL_INTERVAL_MS * 2 };
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

export async function startStepAction(
  context: StepDriverExecutionContext
): Promise<{ outcome: 'started'; action: StepAction } | { outcome: 'completed' | 'no-control' }> {
  const { page, step, verbose } = context;
  const discoveredAction = selectStepAction(step);
  let action = await currentStepAction(page, step.stepId);
  if (!action) {
    action = await waitForStepActionToAppear(page, step.stepId, discoveredAction ? 1000 : BUTTON_APPEAR_TIMEOUT_MS);
  }
  if (!action) {
    if (await isStepComplete(page, step.stepId)) {
      return { outcome: 'completed' };
    }
    return { outcome: 'no-control' };
  }

  await expect(stepActionButton(page, step.stepId, action)).toBeEnabled({ timeout: BUTTON_ENABLE_TIMEOUT_MS });
  await dismissBadgeCelebrations(page);
  await stepActionButton(page, step.stepId, action).click();
  if (verbose) {
    console.log(`   → Clicked "${action === 'do-it' ? 'Do it' : 'Show me'}" for step ${step.stepId}`);
  }
  await page.waitForTimeout(POST_CLICK_SETTLE_DELAY_MS);
  return { outcome: 'started', action };
}

export async function executeStandardStep(context: StepDriverExecutionContext): Promise<StepDriverExecutionResult> {
  const action = await startStepAction(context);
  if (action.outcome !== 'started') {
    return { outcome: action.outcome };
  }
  const completion = await waitForCompletion(context.page, context.step.stepId, context.timeout);
  return { outcome: 'completed', completedViaObjectives: completion.completedViaObjectives };
}

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

export const defaultTimeout = (): number => DEFAULT_STEP_TIMEOUT_MS;
