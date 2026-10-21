import { test, expect } from './fixtures';
import { testIds } from '../src/constants/testIds';
import { StorageKeys } from '../src/lib/storage-keys';
import { TIMEOUTS } from './constants';
import { openDocsPanel } from './helpers/completion.helpers';

const QUERY_ROW_TOGGLE = "button[aria-label$='query row']";
const SCENARIO_PICKER = "[aria-label='Test Data Query scenario select container']";

const openRow = {
  type: 'interactive',
  action: 'highlight',
  reftarget: QUERY_ROW_TOGGLE,
  targetstate: 'aria-expanded:true',
};

const rowStep = {
  type: 'interactive',
  action: 'hover',
  reftarget: SCENARIO_PICKER,
  requirements: ['exists-reftarget'],
};

const guide = {
  id: 'section-recovery-e2e',
  title: 'Section recovery e2e',
  blocks: [
    {
      type: 'section',
      id: 'recover-row',
      title: 'Open the query',
      autoCollapse: false,
      blocks: [
        { ...openRow, content: 'Open the query row.' },
        { ...rowStep, content: 'Look at the scenario.' },
      ],
    },
    {
      type: 'section',
      id: 'one-way',
      title: 'Run the query',
      autoCollapse: false,
      blocks: [
        { ...openRow, content: 'Keep the query row open.' },
        { type: 'interactive', action: 'button', reftarget: "button[aria-label='Run query']", content: 'Run it.' },
        { ...rowStep, content: 'Look at the scenario again.' },
      ],
    },
    {
      type: 'section',
      id: 'unreached',
      title: 'Later',
      autoCollapse: false,
      blocks: [{ ...rowStep, requirements: ['exists-reftarget', 'on-page:/explore'], content: 'Later.' }],
    },
  ],
};

const CONFIRMATION_WINDOW_MS = 1500;
const ARM_MS = 250;

test.describe.configure({ timeout: 120_000 });

test('restores state the section set up, and only where recovery can help', async ({ page }) => {
  const datasource = await (await page.request.get('/api/datasources/name/gdev-testdata')).json();
  const panes = {
    recovery: {
      datasource: datasource.uid,
      queries: [{ refId: 'A', datasource: { type: datasource.type, uid: datasource.uid } }],
      range: { from: 'now-1h', to: 'now' },
    },
  };
  await page.goto(`/explore?schemaVersion=1&panes=${encodeURIComponent(JSON.stringify(panes))}`);
  await openDocsPanel(page);
  await page.evaluate(
    ([key, content]) => {
      localStorage.setItem(key, content);
      document.dispatchEvent(
        new CustomEvent('pathfinder-auto-open-docs', {
          detail: { url: 'bundled:e2e-test', title: 'Section recovery e2e' },
        })
      );
    },
    [StorageKeys.E2E_TEST_GUIDE, JSON.stringify(guide)]
  );
  const recheck = () => page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const arm = async () => {
    await recheck();
    await page.waitForTimeout(ARM_MS);
  };
  const outlastConfirmation = async () => {
    await recheck();
    await page.waitForTimeout(CONFIRMATION_WINDOW_MS);
    await recheck();
  };
  const pushLocation = (url: string) =>
    page.evaluate(async (target) => {
      const system = (
        window as unknown as {
          System: { import: (name: string) => Promise<{ locationService: { push: (url: string) => void } }> };
        }
      ).System;
      const { locationService } = await system.import('@grafana/runtime');
      locationService.push(target);
    }, url);
  const toggle = page.locator(QUERY_ROW_TOGGLE);
  const recover = page.getByTestId(testIds.interactive.section('section-recover-row'));
  const oneWay = page.getByTestId(testIds.interactive.section('section-one-way'));
  const unreached = page.getByTestId(testIds.interactive.section('section-unreached'));
  const doIt = (section: typeof recover, index: number) => section.getByRole('button', { name: 'Do it' }).nth(index);
  const stepOf = (section: typeof recover, index: number) =>
    section.locator('[data-testid^="interactive-step-section-"]').nth(index);
  const doItOf = (step: typeof recover) => step.getByRole('button', { name: 'Do it' });
  const doneMark = (step: typeof recover) => step.locator('[data-testid^="interactive-step-completed-"]');

  await expect(doIt(recover, 0)).toBeEnabled({ timeout: TIMEOUTS.UI_READY });
  await doIt(recover, 0).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(doIt(recover, 0)).toBeEnabled();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await recheck();
  await expect(recover).toHaveClass(/recovery-paused/);
  await recover.getByRole('button', { name: 'Restore' }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(recover).not.toHaveClass(/recovery-paused/);
  await expect(doIt(recover, 0)).toBeEnabled();
  await doIt(recover, 0).click();
  await expect(recover).toHaveClass(/completed/, { timeout: TIMEOUTS.UI_READY });

  const keepOpen = stepOf(oneWay, 0);
  await expect(doneMark(keepOpen).or(doItOf(keepOpen))).toBeVisible({ timeout: TIMEOUTS.UI_READY });
  if (!(await doneMark(keepOpen).isVisible())) {
    await doItOf(keepOpen).click();
  }
  await expect(doneMark(keepOpen)).toBeVisible({ timeout: TIMEOUTS.UI_READY });
  await expect(doItOf(stepOf(oneWay, 1))).toBeEnabled({ timeout: TIMEOUTS.UI_READY });
  await doItOf(stepOf(oneWay, 1)).click();
  await expect(doneMark(stepOf(oneWay, 1))).toBeVisible({ timeout: TIMEOUTS.UI_READY });
  await expect(doItOf(stepOf(oneWay, 2))).toBeEnabled({ timeout: TIMEOUTS.UI_READY });
  await arm();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await outlastConfirmation();
  await expect(oneWay.getByRole('button', { name: 'Restore' })).toHaveCount(0);
  await expect(oneWay).not.toHaveClass(/recovery-paused/);
  await expect(recover).not.toHaveClass(/recovery-paused/);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await arm();
  const explore = new URL(page.url());
  await pushLocation('/dashboards');
  await outlastConfirmation();
  await expect(oneWay).toHaveClass(/recovery-paused/);
  await expect(unreached).not.toHaveClass(/recovery-paused/);
  await oneWay.getByRole('button', { name: 'Restore' }).click();
  await expect(oneWay).not.toHaveClass(/recovery-paused/, { timeout: TIMEOUTS.UI_READY });
  const restored = new URL(page.url());
  expect(restored.pathname).toBe(explore.pathname);
  expect(restored.searchParams.get('panes')).toBe(explore.searchParams.get('panes'));
  await expect(doItOf(stepOf(oneWay, 2))).toBeEnabled();
});
