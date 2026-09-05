import type { Page } from '@playwright/test';

import { StorageKeys } from '../../../../src/lib/storage-keys';
import { ensureDocsPanelOpen } from './bootstrap';

async function injectGuide(page: Page, content: string): Promise<void> {
  await page.evaluate(
    ({ key, json }) => {
      localStorage.setItem(key, json);
    },
    { key: StorageKeys.E2E_TEST_GUIDE, json: content }
  );
}

export async function ensureGuidePanelOpen(page: Page, content: string, allowReloadRecovery: boolean): Promise<void> {
  await injectGuide(page, content);
  if (!allowReloadRecovery) {
    await ensureDocsPanelOpen(page);
    return;
  }
  await ensureDocsPanelOpen(page, {
    beforeRetry: async () => {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 10_000 });
      await page.locator('button[aria-label="Help"]').waitFor({ state: 'visible', timeout: 10_000 });
      await injectGuide(page, content);
    },
  });
}
