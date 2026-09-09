/** @jest-environment node */

import { chromium, type Browser, type Page } from '@playwright/test';

import { executeStep } from '../execution';
import { DEFAULT_STEP_TIMEOUT_MS } from '../constants';
import type { StepSubstepResult, TestableStep } from '../types';
import { executeGuidedStep } from './guided';
import { getStepDriver } from './registry';

interface FixtureOptions {
  timeoutMs?: number;
  runtimeSkips?: number[];
  skippable?: number[];
  invalidFormTarget?: number;
  keepOldBoxes?: boolean;
  detachOnComplete?: boolean;
  completeEarlyAt?: number;
  failureAt?: number;
  failureStatus?: 'timeout' | 'cancelled' | 'error';
  callbackFailureAt?: number;
  settlementDelayMs?: number;
  duplicateFinalRecord?: boolean;
  legacy?: boolean;
  previousResults?: StepSubstepResult[];
}

async function mountFixture(
  page: Page,
  actions: Array<StepSubstepResult['action']>,
  options: FixtureOptions = {}
): Promise<TestableStep> {
  await page.setContent(`
    <main id="targets"></main>
    <output id="actions">[]</output>
    <output id="skips">[]</output>
    <output id="stale">0</output>
    <section id="section">
      <div id="root" data-testid="interactive-step-guided" data-test-step-kind="guided"
        data-test-step-id="guided" data-test-step-state="idle">
        <button id="start" data-testid="interactive-do-it-guided">Start</button>
      </div>
    </section>
  `);
  await page.evaluate(
    ({ actions, options }) => {
      const root = document.getElementById('root')!;
      const section = document.getElementById('section')!;
      const targets = document.getElementById('targets')!;
      const actionLog = document.getElementById('actions')!;
      const skipLog = document.getElementById('skips')!;
      const stale = document.getElementById('stale')!;
      let index = 0;
      let records: StepSubstepResult[] = [];
      root.setAttribute('data-test-substep-total', String(actions.length));
      if (options.timeoutMs !== undefined) {
        root.setAttribute('data-test-step-timeout', String(options.timeoutMs));
      }
      if (!options.legacy) {
        root.setAttribute('data-test-substep-results', JSON.stringify(options.previousResults ?? []));
      }

      function settle(status: StepSubstepResult['status']) {
        records = records.filter((record) => record.index !== index);
        records.push({ index, action: actions[index]!, status, durationMs: (index + 1) * 10 });
        if (!options.legacy) {
          root.setAttribute('data-test-substep-results', JSON.stringify(records));
        }
      }

      function finish(status: 'completed' | 'skipped', expectedIndex: number) {
        if (index !== expectedIndex) {
          stale.textContent = String(Number(stale.textContent) + 1);
          return;
        }
        settle(status);
        if (options.callbackFailureAt === index) {
          settle('error');
          root.setAttribute('data-test-step-state', 'error');
          section.remove();
          return;
        }
        if (options.completeEarlyAt === index) {
          section.remove();
          return;
        }
        index += 1;
        render();
      }

      function render() {
        if (!options.keepOldBoxes) {
          section.querySelectorAll('.interactive-comment-box').forEach((box) => box.remove());
        }
        targets.replaceChildren();
        while (options.runtimeSkips?.includes(index) && index < actions.length) {
          settle('skipped');
          index += 1;
        }
        if (index >= actions.length) {
          if (options.duplicateFinalRecord && records.length > 0 && !options.legacy) {
            root.setAttribute('data-test-substep-results', JSON.stringify([...records, records[records.length - 1]]));
          }
          root.setAttribute('data-test-step-state', 'completed');
          root.removeAttribute('data-test-substep-index');
          if (options.detachOnComplete) {
            section.remove();
          }
          return;
        }

        root.setAttribute('data-test-substep-index', String(index));
        root.setAttribute('data-test-form-state', 'pending');
        const skippable = options.skippable?.includes(index) ?? false;
        if (!options.legacy) {
          root.setAttribute('data-test-substep-skippable', String(skippable));
        }
        if (options.failureAt === index) {
          settle(options.failureStatus ?? 'error');
          root.setAttribute('data-test-step-state', options.failureStatus === 'cancelled' ? 'cancelled' : 'error');
          if (options.detachOnComplete) {
            section.remove();
          }
          return;
        }

        const action = actions[index]!;
        const expectedIndex = index;
        const box = document.createElement('div');
        box.className = 'interactive-comment-box';
        box.textContent = 'Follow this step';
        box.setAttribute('data-test-action', action);
        box.setAttribute('data-test-reftarget', `#target-${index}`);
        box.setAttribute('data-test-target-value', 'fixture value');
        if (!options.legacy) {
          box.setAttribute('data-test-substep-index', String(index));
          box.setAttribute('data-test-substep-skippable', String(skippable));
        }
        const complete = () => {
          const log: number[] = JSON.parse(actionLog.textContent ?? '[]');
          actionLog.textContent = JSON.stringify([...log, expectedIndex]);
          root.setAttribute('data-test-form-state', 'valid');
          if (options.settlementDelayMs) {
            setTimeout(() => finish('completed', expectedIndex), options.settlementDelayMs);
          } else {
            finish('completed', expectedIndex);
          }
        };
        if (action === 'noop') {
          const button = document.createElement('button');
          button.textContent = 'Continue';
          button.addEventListener('click', complete);
          box.appendChild(button);
        } else {
          const target = document.createElement(
            action === 'formfill' ? (options.invalidFormTarget === index ? 'div' : 'input') : 'button'
          );
          target.id = `target-${index}`;
          target.style.cssText = `display:block;padding:20px;margin-top:${30 + index * 20}px`;
          if (action !== 'formfill') {
            target.textContent = `Target ${index}`;
          } else if (options.invalidFormTarget === index) {
            target.textContent = 'Not a form input';
          }
          target.addEventListener(
            action === 'formfill' ? 'input' : action === 'hover' ? 'mouseenter' : 'click',
            complete
          );
          targets.appendChild(target);
        }
        if (skippable) {
          const skip = document.createElement('button');
          skip.textContent = 'Skip';
          skip.addEventListener('click', () => {
            const log: number[] = JSON.parse(skipLog.textContent ?? '[]');
            skipLog.textContent = JSON.stringify([...log, expectedIndex]);
            finish('skipped', expectedIndex);
          });
          box.appendChild(skip);
        }
        section.appendChild(box);
      }

      document.getElementById('start')!.addEventListener('click', () => {
        index = 0;
        records = [];
        if (!options.legacy) {
          root.setAttribute('data-test-substep-results', '[]');
        }
        root.setAttribute('data-test-step-state', 'executing');
        render();
      });
    },
    { actions, options }
  );
  const locator = page.getByTestId('interactive-step-guided');
  return {
    stepId: 'guided',
    stepKind: 'guided',
    index: 0,
    ...(await getStepDriver('guided').inspect(page, locator, 'guided')),
    locator,
  };
}

const describeBrowser = process.env.PATHFINDER_GUIDED_BROWSER_TESTS === '1' ? describe : describe.skip;

describeBrowser('guided driver with real Playwright DOM fixtures', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ channel: process.env.PATHFINDER_GUIDED_BROWSER_CHANNEL });
  });

  afterAll(async () => {
    await browser?.close();
  });

  beforeEach(async () => {
    page = await browser.newPage();
  });

  afterEach(async () => {
    await page?.close();
  });

  async function run(actions: Array<StepSubstepResult['action']>, options: FixtureOptions = {}) {
    const step = await mountFixture(page, actions, options);
    return executeGuidedStep({ page, step, timeout: getStepDriver('guided').timeout(step), verbose: false });
  }

  it.each(['button', 'highlight', 'hover', 'formfill', 'noop'] as const)(
    'executes the %s action from the DOM',
    async (action) => {
      const result = await run([action], { skippable: [0] });

      expect(result).toEqual({
        outcome: 'completed',
        substeps: [{ index: 0, action, status: 'completed', durationMs: 10 }],
      });
      expect(await page.locator('#actions').textContent()).toBe('[0]');
      expect(await page.locator('#skips').textContent()).toBe('[]');
    }
  );

  it.each([30000, 45000, 60000, undefined])('inspects the authored %s timeout in a real page', async (timeoutMs) => {
    const step = await mountFixture(page, ['noop', 'noop'], { timeoutMs });

    expect(step.substepTimeoutMs).toBe(timeoutMs ?? 120000);
    expect(getStepDriver('guided').timeout(step)).toBe(DEFAULT_STEP_TIMEOUT_MS + 2 * (timeoutMs ?? 120000));
  });

  it('consumes consecutive runtime skips before the first visible comment', async () => {
    const result = await run(['button', 'hover', 'noop'], { runtimeSkips: [0, 1] });

    expect(result.substeps).toEqual([
      { index: 0, action: 'button', status: 'skipped', durationMs: 10 },
      { index: 1, action: 'hover', status: 'skipped', durationMs: 20 },
      { index: 2, action: 'noop', status: 'completed', durationMs: 30 },
    ]);
    expect(await page.locator('#actions').textContent()).toBe('[2]');
  });

  it('captures an all-skipped run that detaches before Start returns', async () => {
    const result = await run(['button', 'hover', 'noop'], {
      runtimeSkips: [0, 1, 2],
      detachOnComplete: true,
      previousResults: [{ index: 9, action: 'formfill', status: 'error', durationMs: 1 }],
    });

    expect(result.substeps?.map(({ index, status }) => ({ index, status }))).toEqual([
      { index: 0, status: 'skipped' },
      { index: 1, status: 'skipped' },
      { index: 2, status: 'skipped' },
    ]);
    expect(await page.getByTestId('interactive-step-guided').count()).toBe(0);
    expect(await page.locator('#actions').textContent()).toBe('[]');
  });

  it('keeps the final settlement after its section detaches', async () => {
    const result = await run(['noop', 'button'], { detachOnComplete: true });

    expect(result.substeps).toHaveLength(2);
    expect(result.substeps?.[1]).toEqual({ index: 1, action: 'button', status: 'completed', durationMs: 20 });
    expect(await page.getByTestId('interactive-step-guided').count()).toBe(0);
  });

  it('keeps completeEarly evidence without inventing later results', async () => {
    const result = await run(['button', 'hover', 'formfill'], { completeEarlyAt: 0 });

    expect(result).toEqual({
      outcome: 'completed',
      substeps: [{ index: 0, action: 'button', status: 'completed', durationMs: 10 }],
    });
  });

  it.each(['timeout', 'cancelled', 'error'] as const)(
    'keeps earlier records when a later substep reports %s',
    async (status) => {
      const step = await mountFixture(page, ['noop', 'button', 'hover'], {
        failureAt: 1,
        failureStatus: status,
        detachOnComplete: true,
      });

      const result = await executeStep(page, step);

      expect(result.status).toBe('failed');
      expect(result.substeps).toEqual([
        { index: 0, action: 'noop', status: 'completed', durationMs: 10 },
        { index: 1, action: 'button', status, durationMs: 20 },
      ]);
    }
  );

  it('replaces a completed record when its callback fails before detachment', async () => {
    const step = await mountFixture(page, ['noop'], { callbackFailureAt: 0 });

    const result = await executeStep(page, step);

    expect(result.status).toBe('failed');
    expect(result.substeps).toEqual([{ index: 0, action: 'noop', status: 'error', durationMs: 10 }]);
  });

  it('ignores stale visible comment controls from earlier indexes', async () => {
    const result = await run(['noop', 'noop', 'noop'], { keepOldBoxes: true });

    expect(result.substeps).toHaveLength(3);
    expect(await page.locator('#actions').textContent()).toBe('[0,1,2]');
    expect(await page.locator('#stale').textContent()).toBe('0');
    expect(await page.locator('.interactive-comment-box').count()).toBe(3);
  });

  it('does not repeat actions or duplicate delayed settlement records', async () => {
    const result = await run(['button'], { settlementDelayMs: 1200, duplicateFinalRecord: true });

    expect(result.substeps).toEqual([{ index: 0, action: 'button', status: 'completed', durationMs: 10 }]);
    expect(await page.locator('#actions').textContent()).toBe('[0]');
  });

  it('tries an action before a prompt intentional Skip on recoverable failure', async () => {
    const startedAt = Date.now();
    const result = await run(['formfill', 'noop'], { invalidFormTarget: 0, skippable: [0], timeoutMs: 60000 });

    expect(Date.now() - startedAt).toBeLessThan(10000);
    expect(result.substeps?.[0]).toMatchObject({
      index: 0,
      action: 'formfill',
      status: 'skipped',
      error: expect.any(String),
    });
    expect(result.substeps?.[1]).toMatchObject({ index: 1, action: 'noop', status: 'completed' });
    expect(await page.locator('#skips').textContent()).toBe('[0]');
    expect(await page.locator('#actions').textContent()).toBe('[1]');
  });

  it('executes legacy markup without inferred substep records', async () => {
    const result = await run(['noop', 'button'], { legacy: true });

    expect(result).toEqual({ outcome: 'completed' });
    expect(await page.locator('#actions').textContent()).toBe('[0,1]');
  });

  it('uses the legacy Skip control after an optional action fails without inventing evidence', async () => {
    const result = await run(['formfill', 'noop'], { legacy: true, invalidFormTarget: 0, skippable: [0] });

    expect(result).toEqual({ outcome: 'completed' });
    expect(await page.locator('#skips').textContent()).toBe('[0]');
    expect(await page.locator('#actions').textContent()).toBe('[1]');
  });
});
