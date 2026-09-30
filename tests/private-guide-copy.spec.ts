import { test, expect } from './fixtures';
import { testIds } from '../src/constants/testIds';
import { StorageKeys } from '../src/lib/storage-keys';
import originalGuide from '../src/bundled-interactives/welcome-to-grafana/content.json';

test('copies a public guide, protects the draft and publishes a separate private resource', async ({
  page,
}, testInfo) => {
  const resources: Array<{
    metadata: { name: string };
    spec: { id: string; title: string; status: string; blocks: unknown[] };
  }> = [];
  const writes: string[] = [];

  // This local Grafana has no App Platform service; exercise the real editor against its API contract.
  await page.addInitScript(() => {
    let bootData: typeof window.grafanaBootData;
    Object.defineProperty(window, 'grafanaBootData', {
      configurable: true,
      get: () => bootData,
      set: (value: typeof window.grafanaBootData) => {
        value.settings.featureToggles['aggregation.pathfinderbackend-ext-grafana-app.enabled'] = true;
        bootData = value;
      },
    });
  });
  await page.route('**/api/plugins/grafana-pathfinder-app/resources/pathfinder-settings', (route) =>
    route.fulfill({ json: { metadata: { name: 'default', resourceVersion: '1' }, spec: {} } })
  );
  await page.route(
    '**/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/*/interactiveguides**',
    async (route) => {
      const request = route.request();
      if (request.method() === 'GET') {
        await route.fulfill({ json: { items: resources } });
        return;
      }
      const resource = request.postDataJSON();
      writes.push(request.method());
      const existing = resources.findIndex((entry) => entry.metadata.name === resource.metadata.name);
      if (existing < 0) {
        resources.push(resource);
      } else {
        resources[existing] = resource;
      }
      await route.fulfill({ json: resource });
    }
  );

  await page.goto('/a/grafana-pathfinder-app/fullscreen?doc=bundled%3Awelcome-to-grafana');
  await expect(page.getByRole('heading', { name: 'Tour of Grafana', exact: true })).toBeVisible();
  await page.getByTestId(testIds.fullScreenMode.exitButton).click();
  await expect(page.getByTestId(testIds.docsPanel.container)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tour of Grafana', exact: true })).toBeVisible();
  const openCopy = async () => {
    await page.getByRole('button', { name: 'More options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Edit as private guide', exact: true }).click();
  };
  await openCopy();
  const title = page.getByLabel('Guide title', { exact: true });
  await expect(title).toHaveValue('Welcome to Grafana (copy)');
  await expect(page.getByRole('radio', { name: 'Edit', exact: true })).toBeChecked();
  await title.fill('Our company guide');
  expect(writes).toEqual([]);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible();
  expect(resources).toHaveLength(1);
  expect(resources[0]!.spec.id).not.toBe(originalGuide.id);
  expect(resources[0]!.spec.blocks).toEqual(originalGuide.blocks);
  expect(resources[0]!.spec.status).toBe('draft');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Update', exact: true })).toBeVisible();
  expect(resources[0]!.spec.status).toBe('published');
  expect(writes).toEqual(['POST', 'PUT']);

  const switchToTab = async (name: string) => {
    const visibleTab = page
      .getByTestId(testIds.docsPanel.tabList)
      .getByRole('button', { name: new RegExp(`Close ${name}$`) })
      .filter({ has: page.getByText(name, { exact: true }) });
    const overflowButton = page.getByTestId(testIds.docsPanel.tabOverflowButton);
    await expect(visibleTab.or(overflowButton).first()).toBeVisible();
    if (await visibleTab.isVisible()) {
      await visibleTab.click();
    } else {
      await overflowButton.click();
      await page.getByRole('menuitem', { name: `Switch to ${name}`, exact: true }).click();
    }
  };
  await switchToTab('Welcome to Grafana');
  await openCopy();
  await expect(page.getByText('Replace editor draft?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('Replace editor draft?', { exact: true })).toBeHidden();
  await switchToTab('Our company guide');
  await expect(title).toHaveValue('Our company guide');
  await switchToTab('Welcome to Grafana');
  await openCopy();
  await page.getByRole('button', { name: 'Replace draft', exact: true }).click();
  await expect(title).toHaveValue('Welcome to Grafana (copy)');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).guide.id, StorageKeys.BLOCK_EDITOR_STATE))
    .not.toBe(resources[0]!.spec.id);
  expect(writes).toEqual(['POST', 'PUT']);
  expect(resources[0]!.spec.title).toBe('Our company guide');

  await title.fill('Copy after handoff');
  await page.getByTestId(testIds.blockEditor.moreActionsButton).click();
  await page.getByRole('menuitem', { name: 'Open editor in full screen', exact: true }).click();
  await expect(title).toHaveValue('Copy after handoff');
  await page.screenshot({ path: testInfo.outputPath('private-guide-copy.png') });
  await page.getByTestId(testIds.fullScreenMode.exitButton).click();
  await expect(title).toHaveValue('Copy after handoff');
  await page.getByTestId(testIds.blockEditor.moreActionsButton).click();
  await page.getByRole('menuitem', { name: 'Pop out editor', exact: true }).click();
  await expect(title).toHaveValue('Copy after handoff');
  await page.reload();
  await expect(title).toHaveValue('Copy after handoff');
});
