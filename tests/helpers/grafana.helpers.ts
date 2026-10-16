import type { Page } from '@playwright/test';

export async function waitForGrafanaReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__pathfinderPluginConfig !== undefined);
  await page.getByRole('button', { name: 'Help', exact: true }).waitFor({ state: 'visible' });
}
