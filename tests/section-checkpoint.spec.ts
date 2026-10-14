import { test, expect } from './fixtures';
import { testIds } from '../src/constants/testIds';
import { StorageKeys } from '../src/lib/storage-keys';
import { TIMEOUTS } from './constants';
import { openDocsPanel } from './helpers/completion.helpers';

const QUERY_ROW_TOGGLE = "[data-testid='data-testid Query editor row'] button[aria-label$='query row']";

const guide = {
  id: 'section-checkpoint-e2e',
  title: 'Section checkpoint e2e',
  blocks: [
    {
      type: 'section',
      id: 'cp-row',
      title: 'Inspect the query',
      autoCollapse: false,
      checkpoint: {
        checks: [{ requirement: 'on-page:/explore' }, { target: QUERY_ROW_TOGGLE, state: 'expanded' }],
      },
      blocks: [
        {
          type: 'interactive',
          action: 'highlight',
          reftarget: "[data-testid='data-testid Query editor row']",
          content: 'This is your query.',
        },
      ],
    },
    {
      type: 'section',
      id: 'cp-later',
      title: 'Later',
      autoCollapse: false,
      checkpoint: {
        checks: [{ target: '#pathfinder-e2e-never-present', state: 'visible' }],
        manualRecovery: 'Open the missing panel, then check again.',
      },
      blocks: [
        { type: 'interactive', action: 'highlight', reftarget: '#pathfinder-e2e-later-target', content: 'Later.' },
      ],
    },
  ],
};

test.describe.configure({ timeout: 120_000 });

test('pauses on drift, restores in place, and only nags the section the learner is on', async ({ page }) => {
  const datasource = await (await page.request.get('/api/datasources/name/gdev-testdata')).json();
  const panes = {
    cp: {
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
          detail: { url: 'bundled:e2e-test', title: 'Section checkpoint e2e' },
        })
      );
    },
    [StorageKeys.E2E_TEST_GUIDE, JSON.stringify(guide)]
  );
  const recheck = () => page.evaluate(() => window.dispatchEvent(new Event('focus')));

  const current = page.getByTestId(testIds.interactive.section('section-cp-row'));
  const later = page.getByTestId(testIds.interactive.section('section-cp-later'));
  const toggle = page.locator(QUERY_ROW_TOGGLE);
  await expect(current.getByRole('button', { name: 'Do it' })).toBeEnabled({ timeout: TIMEOUTS.UI_READY });
  await expect(current).not.toHaveClass(/checkpoint-paused/);
  await expect(later).not.toHaveClass(/checkpoint-paused/);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await recheck();
  await expect(current).toHaveClass(/checkpoint-paused/);
  await current.getByRole('button', { name: 'Restore' }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(current).not.toHaveClass(/checkpoint-paused/);
  await expect(current.getByRole('button', { name: 'Do it' })).toBeEnabled();

  await current.getByRole('button', { name: 'Do it' }).click();
  await expect(current).toHaveClass(/completed/, { timeout: TIMEOUTS.UI_READY });

  await expect(later).toHaveClass(/checkpoint-paused/, { timeout: TIMEOUTS.UI_READY });
  await expect(later.getByRole('button', { name: 'Check again' })).toBeVisible();
  await expect(later).toContainText('Open the missing panel, then check again.');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await recheck();
  await expect(later).toHaveClass(/checkpoint-paused/);
  await expect(current).not.toHaveClass(/checkpoint-paused/);
  await expect(current.getByRole('button', { name: 'Restore' })).toHaveCount(0);
});
