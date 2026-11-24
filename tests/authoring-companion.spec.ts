import { test, expect } from './fixtures';
import { StorageKeys } from '../src/lib/storage-keys';

const guideUrl = 'https://interactive-learning.grafana.net/packages/authoring-companion-test/content.json';

test('a floating instructional guide can drive the docked editor without replacing its workspace', async ({ page }) => {
  await page.route(guideUrl, (route) =>
    route.fulfill({
      json: {
        id: 'authoring-companion-test',
        title: 'Authoring instructions',
        blocks: [
          {
            id: 'name-guide',
            type: 'interactive',
            action: 'formfill',
            reftarget: 'input[aria-label="Guide title"]',
            targetvalue: 'A guide created with instructions',
            requirements: ['exists-reftarget'],
            content: 'Name your guide in the editor.',
          },
        ],
      },
    })
  );
  await page.route(guideUrl.replace('content.json', 'manifest.json'), (route) =>
    route.fulfill({
      json: {
        id: 'authoring-companion-test',
        title: 'Authoring instructions',
        type: 'guide',
        schemaVersion: '1.1.0',
        description: 'An authoring companion regression fixture.',
        author: { name: 'Test' },
        repository: 'interactive-tutorials',
      },
    })
  );
  await page.goto(`/a/grafana-pathfinder-app?doc=${encodeURIComponent(guideUrl)}`);
  await expect(page.getByText('Name your guide in the editor.', { exact: true })).toBeVisible();
  const previousMode = await page.evaluate((key) => localStorage.getItem(key), StorageKeys.PANEL_MODE);
  await page.getByRole('button', { name: 'More options', exact: true }).click();
  await page.getByText('Open beside guide editor', { exact: true }).click();
  const floating = page.getByRole('dialog', { name: 'Interactive learning floating panel', exact: true });
  const title = page.getByLabel('Guide title', { exact: true });
  await expect(floating).toBeVisible();
  await expect(title).toBeVisible();
  await floating.getByRole('button', { name: 'Do it', exact: true }).click();
  await expect(title).toHaveValue('A guide created with instructions');
  expect(await page.evaluate((key) => localStorage.getItem(key), StorageKeys.PANEL_MODE)).toBe(previousMode);
  await floating.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(floating).toHaveCount(0);
  await expect(title).toHaveValue('A guide created with instructions');
});
