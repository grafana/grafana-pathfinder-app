import { expect, type Page } from '@playwright/test';

import { testIds } from '../../../../../src/constants/testIds';
import { dismissBadgeCelebrations } from '../badge-celebrations';
import {
  BUTTON_APPEAR_TIMEOUT_MS,
  BUTTON_ENABLE_TIMEOUT_MS,
  COMPLETION_POLL_INTERVAL_MS,
  DEFAULT_STEP_TIMEOUT_MS,
  REQUIREMENTS_CHECK_TIMEOUT_MS,
  SKIP_SYNC_TIMEOUT_MS,
} from '../constants';
import type { StepDriver } from './types';

function codeblockRoot(page: Page, stepId: string) {
  return page.getByTestId(testIds.codeBlock.step(stepId));
}

async function readCodeblockError(page: Page, stepId: string): Promise<string | undefined> {
  const error = page.getByTestId(testIds.interactive.errorMessage(stepId));
  return (await error.count()) > 0 ? (await error.textContent())?.trim() || undefined : undefined;
}

async function waitForCodeblockCompletion(page: Page, stepId: string, timeout: number): Promise<void> {
  const root = codeblockRoot(page, stepId);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if ((await root.count()) > 0) {
      const state = await root.getAttribute('data-test-step-state', { timeout: Math.max(1, deadline - Date.now()) });
      if (state === 'completed') {
        return;
      }
      const error = await readCodeblockError(page, stepId);
      if (error) {
        throw new Error(error);
      }
      if (state === 'error' || state === 'cancelled' || state === 'requirements-unmet') {
        throw new Error(`Codeblock step ${stepId} entered ${state} state`);
      }
    }
    await page.waitForTimeout(Math.min(COMPLETION_POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())));
  }
  throw new Error(`Codeblock step ${stepId} did not reach completed state within ${timeout}ms`);
}

export const codeblockDriver: StepDriver = {
  kind: 'codeblock',
  supported: true,
  root: codeblockRoot,
  detachmentCompletes: false,
  timeout: () => DEFAULT_STEP_TIMEOUT_MS,
  async inspect(page, root, stepId) {
    const isPreCompleted = (await root.getAttribute('data-test-step-state')) === 'completed';
    const skippable = await root.getAttribute('data-test-skippable');
    return {
      actionCount: 0,
      targetAction: 'code-block',
      isPreCompleted,
      skippable:
        !isPreCompleted &&
        (skippable === 'true' ||
          (skippable === null && (await page.getByTestId(testIds.interactive.skipButton(stepId)).count()) > 0)),
      hasDoItButton: (await page.getByTestId(testIds.codeBlock.insertButton(stepId)).count()) > 0,
      hasShowMeButton: (await page.getByTestId(testIds.codeBlock.showMeButton(stepId)).count()) > 0,
    };
  },
  async completionState(page, stepId) {
    return (await codeblockRoot(page, stepId).getAttribute('data-test-step-state')) === 'completed';
  },
  async checkRequirements({ page, step, timeout }) {
    const root = codeblockRoot(page, step.stepId);
    const deadline = Date.now() + Math.min(timeout, REQUIREMENTS_CHECK_TIMEOUT_MS);
    let state: string | null;
    do {
      state = await root.getAttribute('data-test-step-state', { timeout: Math.max(1, deadline - Date.now()) });
      if (state !== 'checking') {
        break;
      }
      await page.waitForTimeout(Math.min(COMPLETION_POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())));
    } while (Date.now() < deadline);
    if (state === 'checking') {
      throw new Error(`Codeblock step ${step.stepId} requirements did not settle`);
    }

    const unmet = state === 'requirements-unmet';
    const explanation = page.getByTestId(testIds.interactive.requirementCheck(step.stepId));
    return {
      requirements: {
        requirementsMet: !unmet,
        status: unmet ? 'unmet' : 'met',
        hasFixButton: false,
        hasRetryButton: false,
        hasSkipButton: (await page.getByTestId(testIds.interactive.skipButton(step.stepId)).count()) > 0,
        skippable: step.skippable,
        isChecking: false,
        explanationText:
          unmet && (await explanation.count()) > 0 ? (await explanation.textContent())?.trim() : undefined,
      },
    };
  },
  async skip(page, stepId, timeout = SKIP_SYNC_TIMEOUT_MS) {
    await dismissBadgeCelebrations(page);
    await page.getByTestId(testIds.interactive.skipButton(stepId)).click({ timeout });
    await expect(codeblockRoot(page, stepId)).toHaveAttribute('data-test-step-state', 'completed', { timeout });
  },
  async execute({ page, step, timeout, verbose }) {
    const insert = page.getByTestId(testIds.codeBlock.insertButton(step.stepId));
    await insert.waitFor({ state: 'visible', timeout: Math.min(timeout, BUTTON_APPEAR_TIMEOUT_MS) });
    await expect(insert).toBeEnabled({ timeout: Math.min(timeout, BUTTON_ENABLE_TIMEOUT_MS) });
    await dismissBadgeCelebrations(page);
    await insert.click({ timeout });
    if (verbose) {
      console.log(`   → Clicked "Insert" for step ${step.stepId}`);
    }
    await waitForCodeblockCompletion(page, step.stepId, timeout);
    return { outcome: 'completed' };
  },
};
