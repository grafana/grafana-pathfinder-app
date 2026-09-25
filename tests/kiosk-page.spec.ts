import { test, expect } from './fixtures';
import demo from '../docs/examples/kiosk/dem.json';
import { testIds } from '../src/constants/testIds';
import { StorageKeys } from '../src/lib/storage-keys';

const catalogUrl = 'https://interactive-learning.grafana.net/kiosk-page-test.json';
const guideUrl = 'https://interactive-learning.grafana.net/kiosk-input-demo/content.json';
const responseId = 'kiosk-input-demo-content.json';
const guide = {
  id: 'kiosk-input-demo',
  title: 'DEM input handoff',
  blocks: [
    {
      type: 'input',
      inputType: 'text',
      format: 'http-origin',
      variableName: 'appUrl',
      prompt: 'Your website',
      required: true,
    },
    { type: 'markdown', content: 'Your saved origin is **{{appUrl}}**.' },
    {
      type: 'section',
      id: 'setup',
      title: 'Use your website',
      requirements: ['var-appUrl:*'],
      blocks: [
        {
          type: 'interactive',
          action: 'formfill',
          reftarget: '#kiosk-sm-target',
          targetvalue: '{{appUrl}}',
          content: 'Fill the request target.',
          requirements: ['exists-reftarget'],
        },
        {
          type: 'interactive',
          action: 'formfill',
          reftarget: '#kiosk-feo-origin',
          targetvalue: '{{appUrl}}',
          content: 'Fill the allowed origin.',
          requirements: ['exists-reftarget'],
        },
      ],
    },
  ],
};
const catalog = { ...demo, rules: demo.rules.map((rule) => ({ ...rule, url: guideUrl, page: '/dashboards' })) };

async function installFixtures(page: import('@playwright/test').Page) {
  const settings = { enableKioskMode: false, kioskRulesUrl: catalogUrl, openPanelOnLaunch: false };
  await page.route('**/api/plugins/grafana-pathfinder-app/settings', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, jsonData: { ...body.jsonData, ...settings } } });
  });
  await page.route('**/api/plugins/grafana-pathfinder-app/resources/pathfinder-settings', (route) =>
    route.fulfill({ json: { metadata: { name: 'default', resourceVersion: '1' }, spec: settings } })
  );
  await page.route(catalogUrl, (route) => route.fulfill({ json: catalog }));
  await page.route(guideUrl, (route) => route.fulfill({ json: guide }));
}

for (const theme of ['light', 'dark']) {
  test(`DEM layout, validation and keyboard controls in ${theme}`, async ({ page }, testInfo) => {
    await installFixtures(page);
    await page.goto(`/?pathfinderKiosk=1&kioskRulesUrl=${encodeURIComponent(catalogUrl)}&theme=${theme}`);
    await expect(page.getByRole('heading', { name: 'See how real users experience your app' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to Grafana' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Your website')).toBeFocused();
    await page.getByLabel('Your website').fill('https://example.com/private?token=secret');
    await page.getByLabel('Your website').press('Enter');
    await expect(page.getByRole('alert')).toContainText('without a path');
    await page.getByLabel('Your website').fill('https://example.com');
    await page.screenshot({ path: testInfo.outputPath(`dem-${theme}.png`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: 'Start guided setup' })).toBeVisible();
    expect(
      await page
        .getByTestId(testIds.kioskMode.overlay)
        .evaluate((element) => element.scrollWidth <= element.clientWidth)
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`dem-${theme}-mobile.png`), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Kiosk mode' })).not.toBeVisible();
  });
}

test('saves once, opens the validated guide and reuses the origin in both form fields after reload', async ({
  page,
  context,
}, testInfo) => {
  await installFixtures(page);
  let guideFetches = 0;
  await page.route(guideUrl, (route) => {
    guideFetches++;
    return route.fulfill({ json: guide });
  });
  await page.goto(`/?pathfinderKiosk=1&kioskRulesUrl=${encodeURIComponent(catalogUrl)}`);
  await page.getByLabel('Your website').fill('https://EXAMPLE.com/');
  const before = context.pages().length;
  await page.getByRole('button', { name: 'Start guided setup' }).click();
  const panel = page.getByTestId(testIds.docsPanel.container);
  await expect(panel).toContainText('DEM input handoff');
  await expect(panel.getByTestId(testIds.interactive.inputField('appUrl'))).toHaveValue('https://example.com');
  expect(guideFetches).toBe(1);
  expect(context.pages()).toHaveLength(before);
  expect(page.url()).not.toContain('example.com');
  const saved = await page.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key) ?? '{}')[id], {
    key: StorageKeys.GUIDE_RESPONSES,
    id: responseId,
  });
  expect(saved).toEqual({ appUrl: 'https://example.com' });
  await page.reload();
  await expect(panel.getByTestId(testIds.interactive.inputField('appUrl'))).toHaveValue('https://example.com');
  await page.evaluate(() => {
    const container = document.createElement('div');
    container.style.cssText =
      'position:fixed;top:140px;left:120px;z-index:1000;background:white;color:black;padding:16px';
    for (const [id, name] of [
      ['kiosk-sm-target', 'Request target'],
      ['kiosk-feo-origin', 'Allowed origin'],
    ]) {
      const label = document.createElement('label');
      label.textContent = name!;
      const input = document.createElement('input');
      input.id = id!;
      label.append(input);
      container.append(label);
    }
    document.body.append(container);
  });
  await panel.getByRole('button', { name: 'Do it', exact: true }).first().click();
  await expect(page.locator('#kiosk-sm-target')).toHaveValue('https://example.com');
  const buttons = panel.getByRole('button', { name: 'Do it', exact: true });
  await buttons.last().click();
  await expect(page.locator('#kiosk-feo-origin')).toHaveValue('https://example.com');
  await page.screenshot({ path: testInfo.outputPath('handoff.png'), fullPage: true });
});

test('copy action reports success and failure without running the command', async ({ page, context }) => {
  await installFixtures(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route(catalogUrl, (route) =>
    route.fulfill({
      json: { ...catalog, page: { ...catalog.page, blocks: [{ type: 'command', command: 'echo kiosk-demo' }] } },
    })
  );
  await page.goto(`/?pathfinderKiosk=1&kioskRulesUrl=${encodeURIComponent(catalogUrl)}`);
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.getByTestId(testIds.kioskMode.overlay).getByRole('status')).toContainText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('echo kiosk-demo');
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new Error('Denied');
    };
  });
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.getByTestId(testIds.kioskMode.overlay).getByRole('status')).toContainText('Could not copy');
});

test('Escape dismisses an open data source picker before closing kiosk and preserves the draft', async ({ page }) => {
  await installFixtures(page);
  const form = catalog.page.blocks.find((block) => block.type === 'launch-form')!;
  await page.route(catalogUrl, (route) =>
    route.fulfill({
      json: {
        ...catalog,
        page: {
          ...catalog.page,
          blocks: [
            {
              ...form,
              inputs: [
                ...('inputs' in form ? form.inputs : []),
                {
                  inputType: 'datasource',
                  variableName: 'datasource',
                  prompt: 'Data source',
                  datasourceFilter: 'testdata',
                  required: true,
                },
              ],
            },
          ],
        },
      },
    })
  );
  await page.goto(`/?pathfinderKiosk=1&kioskRulesUrl=${encodeURIComponent(catalogUrl)}`);
  await page.getByLabel('Your website').fill('https://example.com');
  const picker = page.getByRole('combobox');
  await picker.click();
  await expect(page.getByRole('option', { name: 'gdev-testdata' })).toBeVisible();
  await picker.press('Escape');
  await expect(page.getByRole('listbox')).not.toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Kiosk mode' })).toBeVisible();
  await expect(page.getByLabel('Your website')).toHaveValue('https://example.com');
  await expect(picker).toBeFocused();
  await picker.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Kiosk mode' })).not.toBeVisible();
});

test('destination authoring errors show a visitor-friendly message and retain the draft', async ({ page }) => {
  await installFixtures(page);
  await page.route(guideUrl, (route) =>
    route.fulfill({
      json: {
        ...guide,
        blocks: guide.blocks.map((block) =>
          block.type === 'input' ? { ...block, variableName: 'differentInput' } : block
        ),
      },
    })
  );
  await page.goto(`/?pathfinderKiosk=1&kioskRulesUrl=${encodeURIComponent(catalogUrl)}`);
  await page.getByLabel('Your website').fill('https://example.com');
  await page.getByRole('button', { name: 'Start guided setup' }).click();
  await expect(page.getByRole('alert')).toContainText('Could not open this guide. Please try again later.');
  await expect(page.getByRole('alert')).not.toContainText('compatible input');
  await expect(page.getByLabel('Your website')).toHaveValue('https://example.com');
});
