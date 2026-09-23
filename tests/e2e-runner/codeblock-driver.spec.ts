import { expect, test, type Page } from '@playwright/test';

import { testIds } from '../../src/constants/testIds';
import { discoverStepsFromDOM, withExecutedCoverage } from './utils/guide-runner/discovery';
import { executeAllSteps, executeStep } from './utils/guide-runner/execution';

// This DOM fixture exercises the runner without Grafana or Monaco; component tests cover the product controls.
test.use({ storageState: { cookies: [], origins: [] } });

async function loadFixture(page: Page, outcome: 'completed' | 'error' | 'detached' = 'completed') {
  const insertId = 'insert-query';
  const nextId = 'run-query';
  await page.setContent(`
    <textarea data-testid="editor"></textarea>
    <div data-test-step-kind="codeblock" data-test-step-id="${insertId}" data-test-step-state="idle"
         data-test-skippable="false" data-testid="${testIds.codeBlock.step(insertId)}">
      <code>sum(rate(http_requests_total[5m]))</code>
      <button data-testid="${testIds.codeBlock.showMeButton(insertId)}">Show me</button>
      <button data-testid="${testIds.codeBlock.insertButton(insertId)}">Insert</button>
    </div>
    <div data-test-step-kind="plain" data-test-step-id="${nextId}" data-test-step-state="requirements-unmet"
         data-targetaction="button" data-testid="${testIds.interactive.step(nextId)}">
      <div data-testid="${testIds.interactive.requirementCheck(nextId)}">Complete previous step</div>
      <button disabled data-testid="${testIds.interactive.doItButton(nextId)}">Do it</button>
    </div>
  `);
  await page.evaluate(
    ({ outcome, insertId, nextId, ids }) => {
      const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
      const root = byTestId(ids.root);
      const next = byTestId(ids.nextRoot);
      const insert = byTestId(ids.insert);
      const nextButton = byTestId(ids.nextButton) as HTMLButtonElement;
      insert.addEventListener('click', () => {
        root.setAttribute('data-test-step-state', 'executing');
        setTimeout(() => {
          if (outcome === 'detached') {
            root.remove();
          } else if (outcome === 'error') {
            root.setAttribute('data-test-step-state', 'error');
            const error = document.createElement('div');
            error.dataset.testid = ids.error;
            error.textContent = 'Target editor not found';
            root.append(error);
          } else {
            document.querySelector<HTMLTextAreaElement>('textarea')!.value = root.querySelector('code')!.textContent!;
            root.setAttribute('data-test-step-state', 'completed');
            next.setAttribute('data-test-step-state', 'idle');
            byTestId(ids.requirement).remove();
            nextButton.disabled = false;
          }
        }, 50);
      });
      nextButton.addEventListener('click', () => {
        next.setAttribute('data-test-step-state', 'completed');
        document.body.dataset.executed = `${insertId},${nextId}`;
      });
    },
    {
      outcome,
      insertId,
      nextId,
      ids: {
        root: testIds.codeBlock.step(insertId),
        insert: testIds.codeBlock.insertButton(insertId),
        nextRoot: testIds.interactive.step(nextId),
        nextButton: testIds.interactive.doItButton(nextId),
        requirement: testIds.interactive.requirementCheck(nextId),
        error: testIds.interactive.errorMessage(insertId),
      },
    }
  );
  return discoverStepsFromDOM(page);
}

test('inserts code before executing the gated next step', async ({ page }) => {
  const discovery = await loadFixture(page);
  expect(discovery.coverage).toMatchObject({ rendered: 2, supported: 2, unsupported: 0 });

  const result = await executeAllSteps(page, discovery.steps, { sessionValidator: async () => ({ valid: true }) });

  expect(result.aborted).toBe(false);
  expect(result.results.map(({ stepKind, status }) => ({ stepKind, status }))).toEqual([
    { stepKind: 'codeblock', status: 'passed' },
    { stepKind: 'plain', status: 'passed' },
  ]);
  expect(withExecutedCoverage(discovery.coverage, result.results).executed).toBe(2);
  await expect(page.getByTestId('editor')).toHaveValue('sum(rate(http_requests_total[5m]))');
  await expect(page.locator('body')).toHaveAttribute('data-executed', 'insert-query,run-query');
});

test('reports a product insertion error and does not execute the gated next step', async ({ page }) => {
  const discovery = await loadFixture(page, 'error');
  const result = await executeAllSteps(page, discovery.steps, { sessionValidator: async () => ({ valid: true }) });

  expect(result.results[0]).toMatchObject({ status: 'failed', error: 'Target editor not found' });
  expect(result.results[1]).toMatchObject({ status: 'not_reached' });
  await expect(page.getByTestId('editor')).toHaveValue('');
});

test('does not pass when the codeblock disappears after Insert', async ({ page }) => {
  const discovery = await loadFixture(page, 'detached');
  const result = await executeStep(page, discovery.steps[0]!, { timeout: 300 });

  expect(result.status).toBe('failed');
  expect(result.error).toContain('did not reach completed state');
});

test('does not fall back to Show me when Insert is disabled', async ({ page }) => {
  const discovery = await loadFixture(page);
  await page.getByTestId(testIds.codeBlock.insertButton('insert-query')).evaluate((button: HTMLButtonElement) => {
    button.disabled = true;
  });
  const result = await executeStep(page, discovery.steps[0]!, { timeout: 300 });

  expect(result.status).toBe('failed');
  await expect(page.getByTestId('editor')).toHaveValue('');
  await expect(page.getByTestId(testIds.codeBlock.step('insert-query'))).toHaveAttribute(
    'data-test-step-state',
    'idle'
  );
});
