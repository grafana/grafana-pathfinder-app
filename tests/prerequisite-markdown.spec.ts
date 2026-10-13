import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures';
import { testIds } from '../src/constants/testIds';
import pluginJson from '../src/plugin.json';
import { StorageKeys } from '../src/lib/storage-keys';

const CDN_BASE_URL = 'https://interactive-learning.grafana.net/packages/';
const DESTINATION_ORIGIN = 'https://prerequisite-ui.test';
const PLAIN_LABEL =
  '[Literal prerequisite](https://prerequisite-ui.test/literal) **must stay literal** <strong>too</strong>';

interface FixturePackage {
  id: string;
  type: 'guide' | 'path';
  title: string;
  description: string;
  prerequisites: Array<{ id: string; label: string; format?: 'markdown' }>;
  milestones?: string[];
  blocks: Array<Record<string, unknown>>;
  targeting?: Record<string, unknown>;
}

const pathFixture: FixturePackage = {
  id: 'e2e-markdown-path',
  type: 'path',
  title: 'E2E Markdown path',
  description: 'A path whose cover displays restricted Markdown prerequisites.',
  milestones: ['e2e-markdown-member'],
  prerequisites: [
    { id: 'path-docs', label: `[Open path docs](${DESTINATION_ORIGIN}/path)`, format: 'markdown' },
    { id: 'path-literal', label: PLAIN_LABEL },
  ],
  blocks: [{ type: 'markdown', content: 'Path cover body.' }],
};

const memberFixture: FixturePackage = {
  id: 'e2e-markdown-member',
  type: 'guide',
  title: 'E2E Markdown member',
  description: 'A member guide with its own prerequisite declaration.',
  prerequisites: [
    { id: 'member-docs', label: `[Open member docs](${DESTINATION_ORIGIN}/member)`, format: 'markdown' },
    { id: 'member-literal', label: PLAIN_LABEL },
  ],
  blocks: [
    { type: 'markdown', content: 'Member guide body.' },
    {
      type: 'interactive',
      action: 'highlight',
      reftarget: "[data-testid='data-testid Command palette trigger']",
      content: 'Member interactive step.',
    },
  ],
};

const standaloneFixture: FixturePackage = {
  id: 'e2e-markdown-standalone',
  type: 'guide',
  title: 'E2E Markdown standalone',
  description: 'A standalone guide with valid prerequisites.',
  prerequisites: [
    { id: 'standalone-docs', label: `[Open standalone docs](${DESTINATION_ORIGIN}/standalone)`, format: 'markdown' },
    { id: 'standalone-literal', label: PLAIN_LABEL },
  ],
  blocks: [{ type: 'markdown', content: 'Standalone guide body.' }],
};

const summaryFixture: FixturePackage = {
  id: 'e2e-markdown-summary',
  type: 'path',
  title: 'E2E Markdown summary',
  description: 'A recommendation with restricted Markdown prerequisites.',
  milestones: ['e2e-markdown-member'],
  targeting: { match: { urlPrefix: '/dashboards' } },
  prerequisites: [
    { id: 'summary-docs', label: `[Open summary docs](${DESTINATION_ORIGIN}/summary)`, format: 'markdown' },
    { id: 'summary-literal', label: PLAIN_LABEL },
  ],
  blocks: [{ type: 'markdown', content: 'Summary guide body.' }],
};

const packageFixtures = [pathFixture, memberFixture, standaloneFixture, summaryFixture];

function manifest(fixture: FixturePackage): Record<string, unknown> {
  return {
    id: fixture.id,
    type: fixture.type,
    repository: 'e2e-markdown-fixtures',
    description: fixture.description,
    prerequisites: fixture.prerequisites,
    ...(fixture.milestones ? { milestones: fixture.milestones } : {}),
  };
}

function content(fixture: FixturePackage): Record<string, unknown> {
  return {
    schemaVersion: '1.0.0',
    id: fixture.id,
    title: fixture.title,
    blocks: fixture.blocks,
  };
}

async function stubPrerequisitePackages(page: Page): Promise<void> {
  const packageRecommendationsUrl = `/api/plugins/${pluginJson.id}/resources/package-recommendations`;
  const byId = new Map(packageFixtures.map((fixture) => [fixture.id, fixture]));

  await page.route(`**${packageRecommendationsUrl}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        baseUrl: CDN_BASE_URL,
        packages: packageFixtures.map((fixture) => ({
          id: fixture.id,
          path: `${fixture.id}/`,
          title: fixture.title,
          description: fixture.description,
          type: fixture.type,
          ...(fixture.targeting ? { targeting: fixture.targeting } : {}),
          manifest: manifest(fixture),
        })),
      }),
    });
  });

  await page.route(`${CDN_BASE_URL}**`, async (route) => {
    const segments = new URL(route.request().url()).pathname.split('/').filter(Boolean);
    const file = segments.at(-1);
    const id = segments.at(-2);
    const fixture = id ? byId.get(id) : undefined;
    const body =
      fixture &&
      (file === 'manifest.json' ? manifest(fixture) : file === 'content.json' ? content(fixture) : undefined);

    await route.fulfill({
      status: body ? 200 : 404,
      contentType: 'application/json',
      headers: body ? { 'access-control-allow-origin': '*' } : undefined,
      body: JSON.stringify(body ?? { error: 'not a fixture file' }),
    });
  });

  await page.context().route(`${DESTINATION_ORIGIN}/**`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Mock prerequisite destination</h1>' });
  });
}

async function clearPathfinderStorage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index);
      if (key?.startsWith('grafana-pathfinder')) {
        localStorage.removeItem(key);
      }
    }
  });
}

async function queuedCompletionCount(page: Page): Promise<number> {
  return page.evaluate((prefix) => {
    let count = 0;
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix) && key.includes(':item:')) {
        count++;
      }
    }
    return count;
  }, StorageKeys.COMPLETION_WRITE_QUEUE_PREFIX);
}

async function expectLiteralPrerequisite(container: Locator): Promise<void> {
  const literal = container.getByText(PLAIN_LABEL, { exact: true });
  await expect(literal).toBeVisible();
  await expect(literal.locator('a, strong')).toHaveCount(0);
}

async function expectSecurePopup(page: Page, container: Locator, name: string, destination: string): Promise<void> {
  const link = container.getByRole('link', { name });
  await expect(link).toHaveAttribute('href', destination);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');

  const originalUrl = page.url();
  const popupPromise = page.waitForEvent('popup');
  await link.click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  await expect(popup.getByRole('heading', { name: 'Mock prerequisite destination' })).toBeVisible();
  expect(popup.url()).toBe(destination);
  expect(page.url()).toBe(originalUrl);
  await expect(page.getByTestId(testIds.docsPanel.container)).toBeVisible();
  await popup.close();
}

async function launchPackage(page: Page, fixture: FixturePackage, asPath = false): Promise<void> {
  const params = new URLSearchParams({ doc: `${CDN_BASE_URL}${fixture.id}/content.json` });
  if (asPath) {
    params.set('type', 'learning-journey');
  }
  await page.goto(`/?${params.toString()}`);
  await expect(page.getByTestId(testIds.docsPanel.container)).toBeVisible({ timeout: 30_000 });
}

test.describe('restricted Markdown prerequisites', () => {
  test('opens the expanded recommendation Summary HTTPS prerequisite in a secure popup while default syntax remains literal', async ({
    page,
  }) => {
    await clearPathfinderStorage(page);
    await stubPrerequisitePackages(page);
    await page.goto('/dashboards');

    const helpButton = page.locator('button[aria-label="Help"]');
    await helpButton.click();

    const card = page
      .getByTestId(/context-panel-recommendation-card-/)
      .filter({ has: page.getByText(summaryFixture.title, { exact: true }) });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.getByRole('button', { name: 'Summary' }).click();

    await expectLiteralPrerequisite(card);
    await expectSecurePopup(page, card, 'Open summary docs', `${DESTINATION_ORIGIN}/summary`);
    expect(await queuedCompletionCount(page)).toBe(0);
  });

  test('opens path-cover and member-guide HTTPS prerequisites in popups without replacing the path or queuing completion', async ({
    page,
  }) => {
    await clearPathfinderStorage(page);
    await stubPrerequisitePackages(page);
    await launchPackage(page, pathFixture, true);

    const cover = page.getByTestId(testIds.docsPanel.content);
    await expect(page.getByTestId(testIds.learningPaths.tableOfContents)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1, name: pathFixture.title })).toHaveCount(1);
    await expectLiteralPrerequisite(cover);
    await expectSecurePopup(page, cover, 'Open path docs', `${DESTINATION_ORIGIN}/path`);
    expect(await queuedCompletionCount(page)).toBe(0);

    await page.getByTestId(testIds.docsPanel.nextMilestoneButton).click();
    const memberStep = page.locator('[data-test-step-kind]').first();
    await expect(memberStep).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1, name: memberFixture.title })).toHaveCount(1);

    const memberLink = page.getByRole('link', { name: 'Open member docs' });
    await expectLiteralPrerequisite(cover);
    await expectSecurePopup(page, cover, 'Open member docs', `${DESTINATION_ORIGIN}/member`);
    expect(
      await memberLink.evaluate((link) => {
        const step = document.querySelector('[data-test-step-kind]');
        return step !== null && Boolean(link.compareDocumentPosition(step) & Node.DOCUMENT_POSITION_FOLLOWING);
      })
    ).toBe(true);
    expect(await queuedCompletionCount(page)).toBe(0);
  });

  test('keeps one native title for a standalone guide with valid prerequisites', async ({ page }) => {
    await clearPathfinderStorage(page);
    await stubPrerequisitePackages(page);
    await launchPackage(page, standaloneFixture);

    const guide = page.getByTestId(testIds.docsPanel.content);
    await expect(page.getByRole('heading', { level: 1, name: standaloneFixture.title })).toHaveCount(1);
    await expectLiteralPrerequisite(guide);
    expect(await queuedCompletionCount(page)).toBe(0);
  });
});
