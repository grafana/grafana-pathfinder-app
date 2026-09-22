import { test, expect } from './fixtures';
import { testIds } from '../src/constants/testIds';
import { StorageKeys } from '../src/lib/storage-keys';
import originalGuide from '../src/bundled-interactives/welcome-to-grafana/content.json';

test('customizes the full guide with Assistant before reviewing and saving a private copy', async ({
  page,
}, testInfo) => {
  const prompts: Array<{
    guide: typeof originalGuide;
    customization: { audience: string; outcome: string; environment: string };
  }> = [];
  await page.exposeFunction('captureCustomization', (prompt: string) => prompts.push(JSON.parse(prompt)));
  await page.addInitScript(() => {
    window.__grafanaAssistantInlineFactory__ = async () => ({
      sendPrompt: async (options: { prompt: string; onComplete: (text: string) => void }) => {
        await window.captureCustomization(options.prompt);
        const input = JSON.parse(options.prompt);
        options.onComplete(
          JSON.stringify({
            ...input.guide,
            title: 'Our team guide',
            blocks: [...input.guide.blocks, { type: 'markdown', content: 'Follow our team conventions.' }],
          })
        );
      },
      cancel: () => {},
      dispose: () => {},
    });
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
  const writes: unknown[] = [];
  await page.route(
    '**/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/*/interactiveguides**',
    async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: { items: writes.slice(-1) } });
      } else {
        const resource = route.request().postDataJSON();
        writes.push(resource);
        await route.fulfill({ json: resource });
      }
    }
  );
  await page.goto('/a/grafana-pathfinder-app/fullscreen?doc=bundled%3Awelcome-to-grafana');
  const hasAssistant = await page.evaluate(() =>
    Boolean(window.grafanaBootData.settings.apps['grafana-assistant-app'])
  );
  test.skip(!hasAssistant, 'Grafana Assistant is not installed in this image');
  await expect(page.getByRole('heading', { name: 'Tour of Grafana', exact: true })).toBeVisible();
  await page.getByTestId(testIds.fullScreenMode.exitButton).click();
  await page.getByRole('button', { name: 'More options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Customize with Assistant', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Who is this guide for?').fill('Application developers');
  await page.getByLabel('What should they learn or do?').fill('Navigate Grafana using our team conventions');
  await page.getByLabel('What should reflect your environment?').fill('Keep the navigation steps');
  expect(prompts).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath('customize-guide-modal.png') });
  await page.getByRole('button', { name: 'Customize and open editor', exact: true }).click();
  await expect(page.getByLabel('Guide title', { exact: true })).toHaveValue('Our team guide');
  await expect(page.getByRole('radio', { name: 'Edit', exact: true })).toBeChecked();
  expect(prompts).toHaveLength(1);
  expect(prompts[0]!.guide.blocks).toEqual(originalGuide.blocks);
  expect(prompts[0]!.guide.id).not.toBe(originalGuide.id);
  expect(prompts[0]!.customization.audience).toBe('Application developers');
  expect(writes).toHaveLength(0);
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), StorageKeys.BLOCK_EDITOR_STATE);
  expect(stored.guide.blocks.at(-1).content).toBe('Follow our team conventions.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Update', exact: true })).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[1]).toMatchObject({ spec: { id: prompts[0]!.guide.id, title: 'Our team guide', status: 'published' } });
});
