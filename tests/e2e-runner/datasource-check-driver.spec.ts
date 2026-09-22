import { expect, test, type Page } from '@playwright/test';

import { testIds } from '../../src/constants/testIds';
import { discoverStepsFromDOM } from './utils/guide-runner/discovery';
import { executeStep } from './utils/guide-runner/execution';

// These fixtures model the picker portal and verdict contract, not a live data source.
test.use({ storageState: { cookies: [], origins: [] } });

async function loadCheck(
  page: Page,
  options: {
    count?: number;
    selected?: string;
    loading?: boolean;
    blocked?: boolean;
    skippable?: boolean;
    runnable?: boolean;
    outcome?: 'passed' | 'no-data' | 'error' | 'detach' | 'hang' | 'completion-only' | 'pass-only' | 'selection-change';
  } = {}
) {
  await page.setContent(`
    <div data-testid="${testIds.dataCheck.step('check')}" data-test-step-kind="datasource-check" data-test-step-id="check"
      data-test-step-state="idle" data-test-skippable="false" data-test-datasource-check-state="idle"
      data-test-datasource-selected="" data-test-datasource-count="1" data-test-datasource-loading="false" data-test-datasource-can-run="false">
    </div>
    <div id="datasource-check-menu" role="listbox" hidden></div>
    <div id="unrelated-menu" role="listbox"><div role="option">Unrelated option</div></div>
  `);
  await page.evaluate(
    ({ options, ids }) => {
      const root = document.querySelector<HTMLElement>('[data-test-step-kind="datasource-check"]')!;
      const menu = document.getElementById('datasource-check-menu')!;
      const count = options.count ?? 1;
      root.setAttribute('data-test-datasource-count', String(count));
      root.setAttribute('data-test-datasource-selected', options.selected ?? '');
      root.setAttribute('data-test-datasource-loading', String(!!options.loading));
      root.setAttribute('data-test-skippable', String(!!options.skippable));
      root.setAttribute('data-test-datasource-can-run', String(!!options.selected && options.runnable !== false));
      document.body.dataset.queryCount = '0';
      document.body.dataset.pickerCount = '0';
      document.body.dataset.skipCount = '0';
      if (options.blocked) {
        root.setAttribute('data-test-step-state', 'requirements-unmet');
        const message = document.createElement('div');
        message.dataset.testid = ids.requirement;
        message.textContent = 'Complete previous step';
        root.append(message);
      }
      if (options.skippable) {
        const skip = document.createElement('button');
        skip.dataset.testid = ids.skip;
        skip.textContent = 'Skip';
        skip.onclick = () => {
          document.body.dataset.skipCount = String(Number(document.body.dataset.skipCount) + 1);
          root.setAttribute('data-test-step-state', 'completed');
          root.setAttribute('data-test-datasource-check-state', 'idle');
        };
        root.append(skip);
      }
      if (options.blocked || count === 0) {
        return;
      }
      const picker = document.createElement('input');
      picker.dataset.testid = ids.picker;
      picker.setAttribute('role', 'combobox');
      picker.setAttribute('aria-controls', menu.id);
      picker.onclick = () => {
        document.body.dataset.pickerCount = String(Number(document.body.dataset.pickerCount) + 1);
        menu.hidden = false;
      };
      root.append(picker);
      const run = document.createElement('button');
      run.dataset.testid = ids.run;
      run.textContent = 'Run check';
      run.disabled = !options.selected || options.runnable === false;
      root.append(run);
      for (let i = 0; i < count; i++) {
        const option = document.createElement('div');
        option.setAttribute('role', 'option');
        option.textContent = `Prometheus ${i + 1}`;
        option.onclick = () => {
          root.setAttribute('data-test-datasource-selected', `prom-${i + 1}`);
          root.setAttribute('data-test-datasource-can-run', String(options.runnable !== false));
          picker.value = option.textContent!;
          run.disabled = options.runnable === false;
          menu.hidden = true;
        };
        menu.append(option);
      }
      run.onclick = () => {
        document.body.dataset.queryCount = String(Number(document.body.dataset.queryCount) + 1);
        document.body.dataset.querySource = root.getAttribute('data-test-datasource-selected')!;
        root.setAttribute('data-test-step-state', 'executing');
        root.setAttribute('data-test-datasource-check-state', 'checking');
        run.disabled = true;
        setTimeout(() => {
          const outcome = options.outcome ?? 'passed';
          if (outcome === 'detach') {
            root.remove();
            return;
          }
          if (outcome === 'hang') {
            return;
          }
          if (outcome === 'selection-change') {
            root.setAttribute('data-test-datasource-selected', 'different-source');
            root.setAttribute('data-test-datasource-check-state', 'passed');
            root.setAttribute('data-test-step-state', 'completed');
          } else if (outcome === 'completion-only') {
            root.setAttribute('data-test-datasource-check-state', 'idle');
            root.setAttribute('data-test-step-state', 'completed');
          } else if (outcome === 'pass-only') {
            root.setAttribute('data-test-datasource-check-state', 'passed');
            root.setAttribute('data-test-step-state', 'idle');
          } else {
            root.setAttribute('data-test-datasource-check-state', outcome);
            root.setAttribute('data-test-step-state', outcome === 'passed' ? 'completed' : 'error');
            if (outcome !== 'passed') {
              const message = document.createElement('div');
              message.dataset.testid = ids.failure;
              message.textContent =
                outcome === 'no-data' ? 'The authored metric is missing.' : 'The check could not run. Query refused.';
              root.append(message);
            }
          }
          run.disabled = false;
        }, 50);
      };
    },
    {
      options,
      ids: {
        picker: testIds.dataCheck.datasourcePicker('check'),
        run: testIds.dataCheck.runQueryButton('check'),
        skip: testIds.dataCheck.skipButton('check'),
        failure: testIds.dataCheck.failure('check'),
        requirement: testIds.interactive.requirementCheck('check'),
      },
    }
  );
  const discovery = await discoverStepsFromDOM(page);
  expect(discovery.coverage).toMatchObject({ supported: 1, unsupported: 0 });
  return discovery.steps[0]!;
}

test('selects the sole offered source through its linked picker and runs once', async ({ page }) => {
  const step = await loadCheck(page);
  expect(await executeStep(page, step)).toMatchObject({ status: 'passed' });
  await expect(page.locator('body')).toHaveAttribute('data-picker-count', '1');
  await expect(page.locator('body')).toHaveAttribute('data-query-count', '1');
  await expect(page.locator('body')).toHaveAttribute('data-query-source', 'prom-1');
});

test('preserves a prepared selection instead of choosing the first source', async ({ page }) => {
  const step = await loadCheck(page, { count: 2, selected: 'prom-2' });
  expect(await executeStep(page, step)).toMatchObject({ status: 'passed' });
  await expect(page.locator('body')).toHaveAttribute('data-picker-count', '0');
  await expect(page.locator('body')).toHaveAttribute('data-query-source', 'prom-2');
});

for (const count of [0, 2]) {
  for (const skippable of [false, true]) {
    test(`does not guess when count=${count} and skippable=${skippable}`, async ({ page }) => {
      const step = await loadCheck(page, { count, skippable });
      expect(await executeStep(page, step)).toMatchObject({ status: skippable ? 'skipped' : 'failed' });
      await expect(page.locator('body')).toHaveAttribute('data-query-count', '0');
      await expect(page.locator('body')).toHaveAttribute('data-picker-count', '0');
      await expect(page.locator('body')).toHaveAttribute('data-skip-count', skippable ? '1' : '0');
    });
  }
}

for (const outcome of [
  'no-data',
  'error',
  'detach',
  'hang',
  'completion-only',
  'pass-only',
  'selection-change',
] as const) {
  test(`does not pass ${outcome} or retry the query`, async ({ page }) => {
    const step = await loadCheck(page, { selected: 'prom-1', outcome });
    const result = await executeStep(page, step, { timeout: 600 });
    expect(result).toMatchObject({ status: 'failed' });
    if (outcome === 'no-data') {
      expect(result.error).toContain('authored metric is missing');
    }
    if (outcome === 'error') {
      expect(result.error).toContain('Query refused');
    }
    if (outcome === 'selection-change') {
      expect(result.error).toContain('changed selection');
    }
    await expect(page.locator('body')).toHaveAttribute('data-query-count', '1');
  });
}

test('does not turn an optional query failure into a silent skip', async ({ page }) => {
  const step = await loadCheck(page, { selected: 'prom-1', outcome: 'no-data', skippable: true });
  expect(await executeStep(page, step)).toMatchObject({ status: 'failed' });
  await expect(page.locator('body')).toHaveAttribute('data-skip-count', '0');
});

test('waits for saved selection hydration before checking ambiguity', async ({ page }) => {
  const step = await loadCheck(page, { count: 2, loading: true });
  await page.evaluate((runId) => {
    setTimeout(() => {
      const root = document.querySelector('[data-test-step-kind="datasource-check"]')!;
      root.setAttribute('data-test-datasource-selected', 'prom-2');
      root.setAttribute('data-test-datasource-loading', 'false');
      root.setAttribute('data-test-datasource-can-run', 'true');
      document.querySelector<HTMLButtonElement>(`[data-testid="${runId}"]`)!.disabled = false;
    }, 750);
  }, testIds.dataCheck.runQueryButton('check'));
  expect(await executeStep(page, step)).toMatchObject({ status: 'passed' });
  await expect(page.locator('body')).toHaveAttribute('data-picker-count', '0');
  await expect(page.locator('body')).toHaveAttribute('data-query-source', 'prom-2');
});

test('bounds saved responses that never load', async ({ page }) => {
  const step = await loadCheck(page, { loading: true });
  expect(await executeStep(page, step, { timeout: 300 })).toMatchObject({ status: 'failed' });
  await expect(page.locator('body')).toHaveAttribute('data-query-count', '0');
  await expect(page.locator('body')).toHaveAttribute('data-picker-count', '0');
});

for (const skippable of [false, true]) {
  test(`handles an unsupported selected type or empty query with skippable=${skippable}`, async ({ page }) => {
    const step = await loadCheck(page, { selected: 'prom-1', runnable: false, skippable });
    expect(await executeStep(page, step)).toMatchObject({ status: skippable ? 'skipped' : 'failed' });
    await expect(page.locator('body')).toHaveAttribute('data-query-count', '0');
  });
}

test('skips blocked optional prerequisites without opening the picker', async ({ page }) => {
  const step = await loadCheck(page, { blocked: true, skippable: true });
  expect(await executeStep(page, step)).toMatchObject({ status: 'skipped', skipReason: 'requirements_unmet' });
  await expect(page.locator('body')).toHaveAttribute('data-picker-count', '0');
});

test('waits for an existing check instead of submitting another query', async ({ page }) => {
  const step = await loadCheck(page, { selected: 'prom-1' });
  await page.evaluate((runId) => {
    const root = document.querySelector('[data-test-step-kind="datasource-check"]')!;
    root.setAttribute('data-test-datasource-check-state', 'checking');
    root.setAttribute('data-test-step-state', 'executing');
    document.querySelector<HTMLButtonElement>(`[data-testid="${runId}"]`)!.disabled = true;
    setTimeout(() => {
      root.setAttribute('data-test-datasource-check-state', 'passed');
      root.setAttribute('data-test-step-state', 'completed');
    }, 1_000);
  }, testIds.dataCheck.runQueryButton('check'));
  expect(await executeStep(page, step)).toMatchObject({ status: 'passed' });
  await expect(page.locator('body')).toHaveAttribute('data-query-count', '0');
});

test('does not query when the run control is disabled', async ({ page }) => {
  const step = await loadCheck(page, { selected: 'prom-1' });
  await page.getByTestId(testIds.dataCheck.runQueryButton('check')).evaluate((button: HTMLButtonElement) => {
    button.disabled = true;
  });
  expect(await executeStep(page, step, { timeout: 300 })).toMatchObject({ status: 'failed' });
  await expect(page.locator('body')).toHaveAttribute('data-query-count', '0');
});

test('rejects a picker whose options no longer match the sole-source contract', async ({ page }) => {
  const step = await loadCheck(page);
  await page.locator('#datasource-check-menu').evaluate((menu) => {
    const option = document.createElement('div');
    option.setAttribute('role', 'option');
    option.textContent = 'Unexpected source';
    menu.append(option);
  });
  expect(await executeStep(page, step, { timeout: 300 })).toMatchObject({ status: 'failed' });
  await expect(page.locator('body')).toHaveAttribute('data-query-count', '0');
});

test('preserves pre-completed steps without querying again', async ({ page }) => {
  const step = await loadCheck(page, { selected: 'prom-1' });
  await step.locator.evaluate((root) => root.setAttribute('data-test-step-state', 'completed'));
  const { steps } = await discoverStepsFromDOM(page);
  expect(await executeStep(page, steps[0]!)).toMatchObject({ status: 'skipped', skipReason: 'pre_completed' });
  await expect(page.locator('body')).toHaveAttribute('data-query-count', '0');
});

test('requires synchronized Skip', async ({ page }) => {
  const step = await loadCheck(page, { count: 0, skippable: true });
  await page.getByTestId(testIds.dataCheck.skipButton('check')).evaluate((button: HTMLButtonElement) => {
    button.onclick = () => undefined;
  });
  expect(await executeStep(page, step, { timeout: 300 })).toMatchObject({ status: 'failed' });
});

test('fails explicitly against a plugin without the contract', async ({ page }) => {
  const step = await loadCheck(page);
  await step.locator.evaluate((root) => root.removeAttribute('data-test-datasource-check-state'));
  expect(await executeStep(page, step)).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('DOM contract'),
  });
  await expect(page.locator('body')).toHaveAttribute('data-query-count', '0');
});
