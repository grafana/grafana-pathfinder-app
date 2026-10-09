import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { testIds } from '../src/constants/testIds';
import type { Page, BrowserContext } from '@playwright/test';

const pluginPath = '/public/plugins/grafana-pathfinder-app/';
function assetsForModule(sourcePath: string) {
  const distPath = join(__dirname, '../dist');
  return (existsSync(distPath) ? readdirSync(distPath) : [])
    .filter((file) => file.endsWith('.js.map'))
    .filter((file) => {
      const map = JSON.parse(readFileSync(join(__dirname, '../dist', file), 'utf8')) as { sources: string[] };
      return map.sources.some((source) => source.includes(sourcePath));
    })
    .map((file) => file.replace(/\.map$/, ''));
}
const translationAssets = assetsForModule('@grafana/i18n/');
const kioskAssets = assetsForModule('/kiosk/KioskOverlay.tsx');

test.skip(translationAssets.length === 0, 'Requires a production build with source maps matching the running plugin');
test.setTimeout(60_000);
test.use({ viewport: { width: 1920, height: 1080 } });

async function settings(page: Page | BrowserContext, overrides: Record<string, unknown> = {}) {
  const config = { pathfinderEnabled: true, enableKioskMode: false, openPanelOnLaunch: false, ...overrides };
  await page.route('**/api/plugins/grafana-pathfinder-app/settings', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, jsonData: { ...body.jsonData, ...config } } });
  });
  await page.route('**/api/plugins/grafana-pathfinder-app/resources/pathfinder-settings', (route) =>
    route.fulfill({ json: { metadata: { name: 'default', resourceVersion: '1' }, spec: config } })
  );
}

function trackTranslations(page: Page) {
  const requests: string[] = [];
  const pending = new Set<string>();
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith(pluginPath) && pathname.endsWith('.js')) {
      pending.add(request.url());
    }
    if (translationAssets.some((asset) => pathname === `${pluginPath}${asset}`)) {
      requests.push(pathname);
    }
  });
  page.on('requestfinished', (request) => pending.delete(request.url()));
  page.on('requestfailed', (request) => pending.delete(request.url()));
  return { requests, pending };
}

for (const enableKioskMode of [false, true]) {
  test(`keeps translations unloaded until first open with kiosk enabled=${enableKioskMode}`, async ({ page }) => {
    await settings(page, { enableKioskMode });
    const { requests: translations, pending } = trackTranslations(page);
    await page.goto('/');
    await page.waitForFunction(
      () => window.__pathfinderPluginConfig !== undefined && window.__pathfinderExperiment !== undefined
    );
    await expect.poll(() => pending.size).toBe(0);
    await expect(page.getByTestId(testIds.docsPanel.container)).not.toBeVisible();
    expect(translations).toEqual([]);

    await page.getByRole('button', { name: 'Help', exact: true }).click();
    await expect(page.getByTestId(testIds.docsPanel.container)).toBeVisible({ timeout: 20_000 });
    expect(translations.length).toBeGreaterThan(0);
    const firstOpenRequests = translations.length;
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    await expect(page.getByTestId(testIds.docsPanel.container)).not.toBeVisible();
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    await expect(page.getByTestId(testIds.docsPanel.container)).toBeVisible();
    expect(translations).toHaveLength(firstOpenRequests);
  });
}

for (const [tab, selector] of [
  ['configuration', testIds.appConfig.form],
  ['recommendations-config', testIds.termsAndConditions.toggle],
  ['interactive-features', testIds.appConfig.interactiveFeatures.toggle],
]) {
  test(`loads the ${tab} settings page when learning is disabled`, async ({ page }) => {
    await settings(page, { pathfinderEnabled: false });
    await page.goto(`/plugins/grafana-pathfinder-app?page=${tab}`);
    await expect(page.getByTestId(selector!)).toBeVisible({ timeout: 20_000 });
  });
}

test('loads the disabled app page on demand', async ({ page }) => {
  await settings(page, { pathfinderEnabled: false });
  await page.goto('/a/grafana-pathfinder-app');
  await expect(page.getByText('Interactive learning is turned off for this organization.')).toBeVisible({
    timeout: 20_000,
  });
});

for (const panelMode of ['sidebar', 'floating', 'fullscreen']) {
  test(`opens a ${panelMode} deep link and restores it on refresh`, async ({ page }) => {
    await settings(page);
    const route =
      panelMode === 'fullscreen'
        ? '/a/grafana-pathfinder-app/fullscreen?doc=bundled:welcome-to-grafana'
        : `/?doc=bundled:welcome-to-grafana&panelMode=${panelMode}`;
    await page.goto(route);
    await expect(page.getByRole('heading', { name: 'Tour of Grafana', exact: true })).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Tour of Grafana', exact: true })).toBeVisible({ timeout: 20_000 });
  });
}

test('preserves configured auto-open', async ({ page }) => {
  await settings(page, { openPanelOnLaunch: true });
  await page.goto('/');
  await expect(page.getByTestId(testIds.docsPanel.container)).toBeVisible({ timeout: 20_000 });
});

test('pairs the controller with the live executor after loading on demand', async ({ page, context }) => {
  await settings(context, { enableTwoTabController: true });
  await page.goto('/dashboards?doc=bundled:welcome-to-grafana');
  await expect(page.getByTestId(testIds.docsPanel.openControllerTabButton)).toBeVisible({ timeout: 20_000 });
  // Grafana's home redirect can strip controller parameters before plugin registration.
  await page.evaluate(() => {
    const open = window.open.bind(window);
    window.open = (url, target, features) => {
      const controllerUrl = new URL(String(url), window.location.origin);
      controllerUrl.pathname = '/dashboards';
      return open(controllerUrl.href, target, features);
    };
  });
  const popup = context.waitForEvent('page');
  await page.getByTestId(testIds.docsPanel.openControllerTabButton).click();
  const controller = await popup;
  await expect(controller.getByTestId(testIds.guideReader.overlay)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(controller.getByTestId(testIds.guideReader.controllerStatus)).toContainText(
    'Connected to your Grafana tab',
    { timeout: 20_000 }
  );
  await controller.close();
});

test('fetches the kiosk catalog while the overlay chunk is still loading and reuses the result', async ({ page }) => {
  expect(kioskAssets.length).toBeGreaterThan(0);
  const catalogUrl = 'https://interactive-learning.grafana.net/kiosk-startup-test.json';
  await settings(page, { kioskRulesUrl: catalogUrl });
  let catalogRequests = 0;
  await page.route(catalogUrl, (route) => {
    catalogRequests++;
    return route.fulfill({
      json: {
        rules: [
          {
            title: 'Preloaded guide',
            url: 'bundled:welcome-to-grafana',
            description: 'Ready to open',
            type: 'interactive',
          },
        ],
      },
    });
  });
  let release!: () => void;
  const overlayReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/public/plugins/grafana-pathfinder-app/*.js*', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (kioskAssets.some((asset) => pathname === `${pluginPath}${asset}`)) {
      await overlayReady;
    }
    await route.continue();
  });
  try {
    await page.goto('/?pathfinderKiosk=1', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => catalogRequests, { timeout: 20_000 }).toBe(1);
    await expect(page.getByTestId(testIds.kioskMode.overlay)).not.toBeVisible();
    release();
    await expect(page.getByRole('button', { name: /Preloaded guide/ })).toBeVisible({ timeout: 20_000 });
    expect(catalogRequests).toBe(1);
  } finally {
    release();
  }
});

test('does not fetch a kiosk catalog when learning is disabled', async ({ page }) => {
  const catalogUrl = 'https://interactive-learning.grafana.net/disabled-kiosk-test.json';
  await settings(page, { pathfinderEnabled: false, kioskRulesUrl: catalogUrl });
  let requests = 0;
  await page.route(catalogUrl, (route) => {
    requests++;
    return route.abort();
  });
  const { pending } = trackTranslations(page);
  await page.goto('/?pathfinderKiosk=1');
  await page.waitForFunction(() => window.__pathfinderPluginConfig !== undefined);
  await expect.poll(() => pending.size).toBe(0);
  expect(requests).toBe(0);
  await expect(page.getByTestId(testIds.kioskMode.overlay)).not.toBeVisible();
});

test('places the Learn experiment beside toolbar Help despite page help icons', async ({ page }) => {
  await settings(page);
  await page.addInitScript(() => {
    localStorage.setItem('pathfinder.faro.local', 'true');
    let boot: unknown;
    Object.defineProperty(window, 'grafanaBootData', {
      configurable: true,
      get: () => boot,
      set: (value) => {
        value.settings.buildInfo.env = 'development';
        value.settings.namespace = 'stacks-123';
        value.settings.analytics = { ...value.settings.analytics, enabled: true };
        boot = value;
      },
    });
    document.addEventListener('DOMContentLoaded', () => {
      const button = document.createElement('button');
      button.setAttribute('aria-label', 'Page help');
      button.setAttribute('aria-expanded', 'false');
      const icon = document.createElement('span');
      icon.dataset.testid = 'icon-question-circle';
      button.append(icon);
      document.body.append(button);
    });
  });
  await page.route(/https:\/\/faro-collector-[^/]+\/collect\//, (route) =>
    route.fulfill({ status: 202, headers: { 'Access-Control-Allow-Origin': '*' } })
  );
  await page.goto('/dashboards?featureControl=true&pathfinderHelpPreview=learn');
  const toolbar = page.getByTestId('data-testid Nav toolbar');
  const learn = toolbar.getByTestId('help-button-learn');
  await expect(learn).toBeVisible({ timeout: 20_000 });
  await learn.click();
  await expect(page.getByTestId(testIds.docsPanel.container)).toBeVisible({ timeout: 20_000 });
});
