import { expect, type Page } from '@playwright/test';

import { testIds } from '../../../../../src/constants/testIds';
import { dismissBadgeCelebrations } from '../badge-celebrations';
import {
  COMPLETION_POLL_INTERVAL_MS,
  DEFAULT_STEP_TIMEOUT_MS,
  REQUIREMENTS_CHECK_TIMEOUT_MS,
  SKIP_SYNC_TIMEOUT_MS,
} from '../constants';
import type { StepDriver } from './types';

function quizRoot(page: Page, stepId: string) {
  return page.getByTestId(testIds.interactive.quiz(stepId));
}

export const quizDriver: StepDriver = {
  kind: 'quiz',
  supported: true,
  root: quizRoot,
  detachmentCompletes: false,
  timeout: () => DEFAULT_STEP_TIMEOUT_MS,
  async inspect(page, root, stepId) {
    return {
      actionCount: 0,
      targetAction: 'quiz',
      skippable: (await root.getAttribute('data-test-skippable')) === 'true',
      isPreCompleted: (await root.getAttribute('data-test-step-state')) === 'completed',
      hasDoItButton: (await page.getByTestId(testIds.interactive.quizCheckButton(stepId)).count()) > 0,
      hasShowMeButton: false,
    };
  },
  async completionState(page, stepId) {
    const root = quizRoot(page, stepId);
    return (
      (await root.getAttribute('data-test-step-state')) === 'completed' &&
      (await root.getAttribute('data-test-quiz-result')) === 'correct'
    );
  },
  async checkRequirements({ page, step, timeout }) {
    const root = quizRoot(page, step.stepId);
    const mode = await root.getAttribute('data-test-quiz-multi-select', { timeout });
    if (mode !== 'true' && mode !== 'false') {
      throw new Error('Quiz execution requires a Pathfinder build with the quiz runner DOM contract.');
    }
    const deadline = Date.now() + Math.min(timeout, REQUIREMENTS_CHECK_TIMEOUT_MS);
    let state: string | null;
    while (true) {
      if (Date.now() >= deadline) {
        throw new Error(`Quiz step ${step.stepId} requirements did not settle.`);
      }
      state = await root.getAttribute('data-test-step-state', { timeout: Math.max(1, deadline - Date.now()) });
      if (state !== 'checking') {
        break;
      }
      await page.waitForTimeout(Math.min(COMPLETION_POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())));
    }
    const unmet = state === 'requirements-unmet';
    const message = root.getByTestId(testIds.interactive.requirementCheck(step.stepId));
    return {
      requirements: {
        requirementsMet: !unmet,
        status: unmet ? 'unmet' : 'met',
        hasFixButton: false,
        hasRetryButton: false,
        hasSkipButton: (await root.getByTestId(testIds.interactive.quizSkipButton(step.stepId)).count()) > 0,
        skippable: step.skippable,
        isChecking: false,
        explanationText: (await message.count()) > 0 ? (await message.textContent())?.trim() : undefined,
      },
    };
  },
  async skip(page, stepId, timeout = SKIP_SYNC_TIMEOUT_MS) {
    const root = quizRoot(page, stepId);
    await dismissBadgeCelebrations(page);
    await root.getByTestId(testIds.interactive.quizSkipButton(stepId)).click({ timeout });
    await expect(root).toHaveAttribute('data-test-step-state', 'completed', { timeout });
  },
  async execute({ page, step, timeout }) {
    const root = quizRoot(page, step.stepId);
    const deadline = Date.now() + timeout;
    const remaining = () => Math.max(1, deadline - Date.now());
    const multiSelect = (await root.getAttribute('data-test-quiz-multi-select', { timeout: remaining() })) === 'true';
    const choices = await root.locator('button[data-test-quiz-correct]').all();
    const answers = [];
    for (const choice of choices) {
      const correct = await choice.getAttribute('data-test-quiz-correct', { timeout: remaining() });
      if (correct !== 'true' && correct !== 'false') {
        throw new Error(`Quiz step ${step.stepId} has an invalid authored answer contract.`);
      }
      answers.push({ choice, correct: correct === 'true' });
    }
    if (!answers.some(({ correct }) => correct)) {
      throw new Error(`Quiz step ${step.stepId} has no authored correct answer.`);
    }
    await dismissBadgeCelebrations(page);
    let selectedCorrect = false;
    for (const { choice, correct } of answers) {
      const desired = correct && (multiSelect || !selectedCorrect);
      selectedCorrect ||= desired;
      const selected = (await choice.getAttribute('aria-pressed', { timeout: remaining() })) === 'true';
      if ((multiSelect && selected !== desired) || (!multiSelect && desired && !selected)) {
        await choice.click({ timeout: remaining() });
      }
    }
    await root.getByTestId(testIds.interactive.quizCheckButton(step.stepId)).click({ timeout: remaining() });
    while (Date.now() < deadline) {
      const state = await root.getAttribute('data-test-step-state', { timeout: remaining() });
      const result = await root.getAttribute('data-test-quiz-result', { timeout: remaining() });
      if (result === 'incorrect' || result === 'revealed') {
        throw new Error(`Quiz step ${step.stepId} returned ${result}; a correct answer is required.`);
      }
      if (state === 'completed' && result === 'correct') {
        return { outcome: 'completed' };
      }
      if (state === 'error' || state === 'cancelled' || state === 'requirements-unmet') {
        throw new Error(`Quiz step ${step.stepId} entered ${state} state.`);
      }
      await page.waitForTimeout(Math.min(COMPLETION_POLL_INTERVAL_MS, remaining()));
    }
    throw new Error(`Quiz step ${step.stepId} did not reach correct completion before its deadline.`);
  },
};
