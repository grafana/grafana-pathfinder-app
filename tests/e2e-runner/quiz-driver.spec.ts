import { expect, test, type Page } from '@playwright/test';

import { testIds } from '../../src/constants/testIds';
import { discoverStepsFromDOM } from './utils/guide-runner/discovery';
import { executeStep } from './utils/guide-runner/execution';

// These fixtures exercise product-shaped DOM controls, not a mounted Grafana plugin.
test.use({ storageState: { cookies: [], origins: [] } });

async function loadQuiz(
  page: Page,
  options: {
    multiSelect?: boolean;
    blocked?: boolean;
    skippable?: boolean;
    outcome?: 'correct' | 'incorrect' | 'revealed' | 'detach' | 'hang';
  } = {}
) {
  await page.setContent(`
    <div data-testid="${testIds.interactive.quiz('quiz')}" data-test-step-kind="quiz" data-test-step-id="quiz"
      data-test-step-state="idle" data-test-quiz-multi-select="false" data-test-quiz-result="none" data-test-skippable="false">
      <button data-testid="${testIds.interactive.quizChoice('quiz', 'wrong')}" data-test-quiz-correct="false" aria-pressed="true">Wrong preselection</button>
      <button data-testid="${testIds.interactive.quizChoice('quiz', 'right-b')}" data-test-quiz-correct="true" aria-pressed="false">Second authored answer</button>
      <button data-testid="${testIds.interactive.quizChoice('quiz', 'right-a')}" data-test-quiz-correct="true" aria-pressed="false">First authored answer</button>
      <button data-testid="${testIds.interactive.quizCheckButton('quiz')}">Check answer</button>
    </div>
  `);
  await page.evaluate(
    ({ options, ids }) => {
      const root = document.querySelector<HTMLElement>('[data-test-step-kind="quiz"]')!;
      const choices = Array.from(root.querySelectorAll<HTMLButtonElement>('button[data-test-quiz-correct]'));
      root.setAttribute('data-test-quiz-multi-select', String(!!options.multiSelect));
      root.setAttribute('data-test-skippable', String(!!options.skippable));
      document.body.dataset.checkCount = '0';
      if (options.blocked) {
        root.setAttribute('data-test-step-state', 'requirements-unmet');
        const message = document.createElement('div');
        message.dataset.testid = ids.requirement;
        message.textContent = 'Complete previous step';
        root.append(message);
        if (options.skippable) {
          const skip = document.createElement('button');
          skip.dataset.testid = ids.skip;
          skip.textContent = 'Skip';
          skip.onclick = () => root.setAttribute('data-test-step-state', 'completed');
          root.append(skip);
        }
      }
      for (const choice of choices) {
        choice.disabled = !!options.blocked;
        choice.onclick = () => {
          const wasSelected = choice.getAttribute('aria-pressed') === 'true';
          if (!options.multiSelect) {
            choices.forEach((c) => c.setAttribute('aria-pressed', 'false'));
          }
          choice.setAttribute('aria-pressed', String(!options.multiSelect || !wasSelected));
          root.setAttribute('data-test-quiz-result', 'none');
        };
      }
      const check = root.querySelector<HTMLButtonElement>(`[data-testid="${ids.check}"]`)!;
      check.disabled = !!options.blocked;
      check.onclick = () => {
        document.body.dataset.checkCount = String(Number(document.body.dataset.checkCount) + 1);
        if (options.outcome === 'detach') {
          root.remove();
          return;
        }
        if (options.outcome === 'hang') {
          return;
        }
        const selected = choices.filter((c) => c.getAttribute('aria-pressed') === 'true');
        const correct = options.multiSelect
          ? choices.every((c) => (c.getAttribute('aria-pressed') === 'true') === (c.dataset.testQuizCorrect === 'true'))
          : selected.length === 1 && selected[0]!.dataset.testQuizCorrect === 'true';
        const result = options.outcome ?? (correct ? 'correct' : 'incorrect');
        root.setAttribute('data-test-quiz-result', result);
        if (result === 'correct' || result === 'revealed') {
          root.setAttribute('data-test-step-state', 'completed');
        }
      };
    },
    {
      options,
      ids: {
        check: testIds.interactive.quizCheckButton('quiz'),
        skip: testIds.interactive.quizSkipButton('quiz'),
        requirement: testIds.interactive.requirementCheck('quiz'),
      },
    }
  );
  const discovery = await discoverStepsFromDOM(page);
  expect(discovery.coverage).toMatchObject({ rendered: 1, supported: 1, unsupported: 0 });
  return discovery.steps[0]!;
}

for (const multiSelect of [false, true]) {
  test(`submits authored answers regardless of order and clears wrong preselection: multiSelect=${multiSelect}`, async ({
    page,
  }) => {
    const step = await loadQuiz(page, { multiSelect });
    expect(await executeStep(page, step)).toMatchObject({ status: 'passed' });
    await expect(page.locator('body')).toHaveAttribute('data-check-count', '1');
    await expect(page.getByTestId(testIds.interactive.quizChoice('quiz', 'wrong'))).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });
}

for (const outcome of ['incorrect', 'revealed', 'detach', 'hang'] as const) {
  test(`does not count ${outcome} as a correct completion`, async ({ page }) => {
    const step = await loadQuiz(page, { outcome });
    expect(await executeStep(page, step, { timeout: 500 })).toMatchObject({ status: 'failed' });
    await expect(page.locator('body')).toHaveAttribute('data-check-count', '1');
  });
}

for (const skippable of [false, true]) {
  test(`handles an unmet requirement with skippable=${skippable}`, async ({ page }) => {
    const step = await loadQuiz(page, { blocked: true, skippable });
    expect(await executeStep(page, step)).toMatchObject({ status: skippable ? 'skipped' : 'failed' });
    await expect(page.locator('body')).toHaveAttribute('data-check-count', '0');
  });
}

test('refuses missing authored answers instead of guessing or exhausting attempts', async ({ page }) => {
  const step = await loadQuiz(page);
  await page
    .locator('[data-test-quiz-correct="true"]')
    .evaluateAll((choices) => choices.forEach((c) => c.setAttribute('data-test-quiz-correct', 'false')));
  expect(await executeStep(page, step)).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('no authored correct answer'),
  });
  await expect(page.locator('body')).toHaveAttribute('data-check-count', '0');
});

test('does not report an optional skip until the product completes it', async ({ page }) => {
  const step = await loadQuiz(page, { blocked: true, skippable: true });
  await page.getByTestId(testIds.interactive.quizSkipButton('quiz')).evaluate((button: HTMLButtonElement) => {
    button.onclick = () => undefined;
  });
  expect(await executeStep(page, step, { timeout: 300 })).toMatchObject({ status: 'failed' });
});

test('bounds requirements that never settle', async ({ page }) => {
  const step = await loadQuiz(page);
  await step.locator.evaluate((root) => root.setAttribute('data-test-step-state', 'checking'));
  expect(await executeStep(page, step, { timeout: 300 })).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('requirements did not settle'),
  });
  await expect(page.locator('body')).toHaveAttribute('data-check-count', '0');
});

test('preserves the existing pre-completed outcome without answering again', async ({ page }) => {
  await loadQuiz(page);
  await page
    .getByTestId(testIds.interactive.quiz('quiz'))
    .evaluate((root) => root.setAttribute('data-test-step-state', 'completed'));
  const { steps } = await discoverStepsFromDOM(page);
  expect(await executeStep(page, steps[0]!)).toMatchObject({ status: 'skipped', skipReason: 'pre_completed' });
  await expect(page.locator('body')).toHaveAttribute('data-check-count', '0');
});

test('rejects a plugin without the quiz contract', async ({ page }) => {
  const step = await loadQuiz(page);
  await step.locator.evaluate((root) => root.removeAttribute('data-test-quiz-multi-select'));
  expect(await executeStep(page, step)).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('quiz runner DOM contract'),
  });
});

test('does not pass a disabled Check answer control', async ({ page }) => {
  const step = await loadQuiz(page);
  await page.getByTestId(testIds.interactive.quizCheckButton('quiz')).evaluate((button: HTMLButtonElement) => {
    button.disabled = true;
  });
  expect(await executeStep(page, step, { timeout: 300 })).toMatchObject({ status: 'failed' });
  await expect(page.locator('body')).toHaveAttribute('data-check-count', '0');
});
