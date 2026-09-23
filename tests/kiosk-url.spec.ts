import { test, expect } from './fixtures';
import genericCatalog from '../src/components/kiosk/default-kiosk.json';
import { testIds } from '../src/constants/testIds';

const defaultUrl = 'https://interactive-learning.grafana.net/kiosk-test-default.json';
const customUrl = 'https://interactive-learning.grafana.net/kiosk-test-custom.json';
const catalog = (title: string) => ({
  banner: `<h2>${title}</h2>`,
  rules: [
    { title: `${title} guide`, url: 'bundled:welcome-to-grafana', description: 'Learn Grafana', type: 'interactive' },
  ],
});

function kioskSearch(rulesUrl?: string): string {
  const params = new URLSearchParams({ pathfinderKiosk: '1', orgId: '1' });
  if (rulesUrl) {
    params.set('kioskRulesUrl', rulesUrl);
  }
  return `/?${params}`;
}

test.beforeEach(async ({ page }) => {
  const settings = { enableKioskMode: false, kioskRulesUrl: defaultUrl, openPanelOnLaunch: true };
  await page.route('**/api/plugins/grafana-pathfinder-app/settings', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, jsonData: { ...body.jsonData, ...settings } } });
  });
  await page.route('**/api/plugins/grafana-pathfinder-app/resources/pathfinder-settings', (route) =>
    route.fulfill({ json: { metadata: { name: 'default', resourceVersion: '1' }, spec: settings } })
  );
  await page.route(defaultUrl, (route) => route.fulfill({ json: catalog('Default kiosk') }));
  await page.route(customUrl, (route) => route.fulfill({ json: catalog('Custom kiosk') }));
});

test('opens the default with the kiosk setting off and preserves unrelated parameters on close', async ({ page }) => {
  await page.goto(kioskSearch());
  await expect(page.getByRole('heading', { name: 'Default kiosk', exact: true })).toBeVisible();
  await expect(page.getByTestId(testIds.docsPanel.container)).not.toBeVisible();
  await page.getByTestId(testIds.kioskMode.closeButton).click();
  await expect(page.getByTestId(testIds.kioskMode.overlay)).not.toBeVisible();
  expect(new URL(page.url()).searchParams.get('pathfinderKiosk')).toBeNull();
  expect(new URL(page.url()).searchParams.get('orgId')).toBe('1');
});

test('selects a custom kiosk, survives refresh, and switches through Grafana SPA navigation', async ({ page }) => {
  await page.goto(kioskSearch(customUrl));
  await expect(page.getByRole('heading', { name: 'Custom kiosk', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Custom kiosk', exact: true })).toBeVisible();
  await page.evaluate(async (search) => {
    const system = (
      window as unknown as {
        System: { import: (name: string) => Promise<{ locationService: { push: (url: string) => void } }> };
      }
    ).System;
    const { locationService } = await system.import('@grafana/runtime');
    locationService.push(search);
  }, kioskSearch());
  await expect(page.getByRole('heading', { name: 'Default kiosk', exact: true })).toBeVisible();
  await expect(page.getByTestId(testIds.kioskMode.overlay)).toHaveCount(1);
});

test('falls back to the configured default after a failed override', async ({ page }) => {
  await page.route(customUrl, (route) => route.fulfill({ status: 404, body: 'Missing' }));
  await page.goto(kioskSearch(customUrl));
  await expect(page.getByRole('heading', { name: 'Default kiosk', exact: true })).toBeVisible();
  await expect(page.getByTestId(testIds.kioskMode.warning)).toContainText('Showing the default kiosk');
});

test('rejects untrusted sources without fetching them', async ({ page }) => {
  let fetched = false;
  const untrusted = 'https://untrusted.example.com/kiosk.json';
  await page.route(untrusted, (route) => {
    fetched = true;
    return route.abort();
  });
  await page.goto(kioskSearch(untrusted));
  await expect(page.getByRole('heading', { name: 'Default kiosk', exact: true })).toBeVisible();
  expect(fetched).toBe(false);
});

test('blocks redirects before contacting an untrusted destination', async ({ page }) => {
  let redirected = false;
  const destination = 'https://untrusted.example.com/redirected.json';
  await page.route(destination, (route) => {
    redirected = true;
    return route.abort();
  });
  await page.route(customUrl, (route) => route.fulfill({ status: 302, headers: { location: destination }, body: '' }));
  await page.goto(kioskSearch(customUrl));
  await expect(page.getByRole('heading', { name: 'Default kiosk', exact: true })).toBeVisible();
  await expect(page.getByTestId(testIds.kioskMode.warning)).toBeVisible();
  expect(redirected).toBe(false);
});

test('launches a guide on the selected page in the same tab and instance', async ({ page, context }) => {
  await page.route(customUrl, (route) =>
    route.fulfill({
      json: {
        ...catalog('Custom kiosk'),
        rules: [
          {
            ...catalog('Custom kiosk').rules[0],
            page: '/dashboards?query=kiosk',
            targetUrl: 'https://play.grafana.org',
          },
        ],
      },
    })
  );
  await page.goto(kioskSearch(customUrl));
  const pagesBefore = context.pages().length;
  await page.getByTestId(testIds.kioskMode.tile(0)).click();
  await expect(page.getByTestId(testIds.kioskMode.overlay)).not.toBeVisible();
  await expect(page.getByTestId(testIds.docsPanel.container)).toBeVisible();
  await expect(page.getByTestId(testIds.docsPanel.container)).toContainText('Welcome to Grafana');
  expect(context.pages()).toHaveLength(pagesBefore);
  expect(new URL(page.url()).pathname).toBe('/dashboards');
  expect(new URL(page.url()).searchParams.get('query')).toBe('kiosk');
  expect(new URL(page.url()).hostname).toBe('localhost');
  expect(new URL(page.url()).searchParams.has('pathfinderKiosk')).toBe(false);
});

for (const theme of ['light', 'dark']) {
  test(`keeps the exit visible and keyboard accessible in the ${theme} theme`, async ({ page }) => {
    await page.route(customUrl, (route) =>
      route.fulfill({
        json: {
          ...catalog('Theme preview'),
          banner: '',
          rules: Array.from({ length: 30 }, (_, i) => ({
            ...catalog('Theme preview').rules[0],
            title: `Guide ${i}`,
            url: `bundled:welcome-to-grafana#${i}`,
          })),
        },
      })
    );
    await page.goto(`${kioskSearch(customUrl)}&theme=${theme}`);
    const overlay = page.getByTestId(testIds.kioskMode.overlay);
    const exit = page.getByRole('button', { name: 'Exit kiosk', exact: true });
    await expect(exit).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Learn Grafana' })).toBeVisible();
    await expect(page.getByTestId(testIds.kioskMode.tile(29))).toBeAttached();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByTestId(testIds.kioskMode.tile(29))).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(exit).toBeFocused();
    await overlay.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(exit).toBeInViewport();
    const background = await overlay.evaluate((element) => getComputedStyle(element).backgroundColor);
    const channels = background.match(/\d+/g)!.slice(0, 3).map(Number);
    expect(channels.every((channel) => (theme === 'light' ? channel > 230 : channel < 80))).toBe(true);
    await overlay.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({ path: `/tmp/pathfinder-kiosk-${theme}.png` });
    await page.keyboard.press('Escape');
    await expect(overlay).not.toBeVisible();
    expect(new URL(page.url()).searchParams.get('theme')).toBe(theme);
  });
}

for (const offline of [false, true]) {
  test(`shows the generic ${offline ? 'bundled' : 'CDN'} catalog when selected catalogs fail`, async ({ page }) => {
    await page.route(customUrl, (route) => route.fulfill({ status: 404, body: 'Missing' }));
    await page.route(defaultUrl, (route) => route.fulfill({ status: 404, body: 'Missing' }));
    await page.route('https://interactive-learning.grafana.net/guides/kiosk/default/rules.json', (route) =>
      offline ? route.abort() : route.fulfill({ json: genericCatalog })
    );
    await page.goto(kioskSearch(customUrl));
    await expect(page.getByRole('heading', { name: 'Learn Grafana', exact: true })).toBeVisible();
    for (const rule of genericCatalog.rules) {
      await expect(page.getByRole('button', { name: new RegExp(rule.title) })).toBeVisible();
    }
    await expect(page.getByTestId(testIds.kioskMode.warning)).toBeVisible();
    const pagesBefore = page.context().pages().length;
    await page.getByRole('button', { name: /Core Grafana concepts/ }).click();
    await expect(page.getByTestId(testIds.kioskMode.overlay)).not.toBeVisible();
    await expect(page.getByTestId(testIds.docsPanel.container)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/a/grafana-pathfinder-app');
    await expect(page.getByTestId(testIds.docsPanel.container)).toContainText('Core Grafana concepts');
    await expect(page.getByRole('button', { name: 'Next milestone', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Data sources Learn how/ })).toBeVisible();
    expect(new URL(page.url()).searchParams.has('pathfinderKiosk')).toBe(false);
    expect(page.context().pages()).toHaveLength(pagesBefore);
  });
}

test('opens an ordinary same-instance kiosk link without reloading Grafana', async ({ page }) => {
  await page.goto(kioskSearch());
  await expect(page.getByTestId(testIds.kioskMode.overlay)).toBeVisible();
  await page.getByRole('button', { name: 'Exit kiosk', exact: true }).click();
  await page.evaluate((href) => {
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.textContent = 'Open demo learning kiosk';
    anchor.id = 'kiosk-demo-navigation-marker';
    Object.assign(anchor.style, { position: 'fixed', top: '100px', left: '100px', zIndex: '10000' });
    document.body.appendChild(anchor);
  }, kioskSearch(customUrl));
  await page.getByRole('link', { name: 'Open demo learning kiosk' }).click();
  await expect(page.getByRole('heading', { name: 'Custom kiosk', exact: true })).toBeVisible();
  await expect(page.locator('#kiosk-demo-navigation-marker')).toBeAttached();
  expect(new URL(page.url()).searchParams.get('kioskRulesUrl')).toBe(customUrl);
});

test('does not replay a closed kiosk when Grafana updates dashboard query parameters', async ({ page }) => {
  await page.goto(kioskSearch());
  await expect(page.getByTestId(testIds.kioskMode.overlay)).toBeVisible();
  await page.getByRole('button', { name: 'Exit kiosk', exact: true }).click();
  const search = await page.evaluate(async () => {
    const system = (
      window as unknown as {
        System: {
          import: (name: string) => Promise<{
            locationService: {
              partial: (query: Record<string, string>, replace: boolean) => void;
              getLocation: () => { search: string };
            };
          }>;
        };
      }
    ).System;
    const { locationService } = await system.import('@grafana/runtime');
    locationService.partial({ from: 'now-30m' }, true);
    return locationService.getLocation().search;
  });
  expect(new URLSearchParams(search).has('pathfinderKiosk')).toBe(false);
  await expect(page.getByTestId(testIds.kioskMode.overlay)).not.toBeVisible();
});
