import { AppConfigPage, AppPage, test as base } from '@grafana/plugin-e2e';
import pluginJson from '../src/plugin.json';

type AppTestFixture = {
  appConfigPage: AppConfigPage;
  gotoPage: (path?: string) => Promise<AppPage>;
};

export const test = base.extend<AppTestFixture>({
  page: async ({ page }, use) => {
    // Grafana 13+ shows a "What's new" modal on first login that blocks pointer
    // events via a portal overlay. Register a handler so Playwright automatically
    // dismisses it whenever it intercepts an action.
    await page.addLocatorHandler(page.getByLabel("What's new in Grafana"), async () => {
      await page.getByLabel("What's new in Grafana").getByLabel('Close').click();
    });
    await use(page);
  },
  appConfigPage: async ({ gotoAppConfigPage }, use) => {
    const configPage = await gotoAppConfigPage({
      pluginId: pluginJson.id,
    });
    await use(configPage);
  },
  gotoPage: async ({ gotoAppPage }, use) => {
    await use((path) =>
      gotoAppPage({
        path,
        pluginId: pluginJson.id,
      })
    );
  },
});

export { expect } from '@grafana/plugin-e2e';
