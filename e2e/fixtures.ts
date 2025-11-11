/**
 * Playwright fixtures for guide testing
 */

import { test as base, expect } from '@playwright/test';
import { Page } from '@playwright/test';
import pluginJson from '../src/plugin.json';

export interface GuideTestFixtures {
  page: Page;
  openPathfinderPanel: () => Promise<void>;
  loadGuide: (guideUrl: string) => Promise<void>;
  waitForGuideLoaded: () => Promise<void>;
}

export const test = base.extend<GuideTestFixtures>({
  page: async ({ page }, use) => {
    // Navigate to Grafana home
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await use(page);
  },

  openPathfinderPanel: async ({ page }, use) => {
    const openPanel = async () => {
      // Click the Help button to open Pathfinder sidebar
      const helpButton = page.locator('button[aria-label="Help"]');
      await helpButton.click();

      // Wait for panel to be visible
      const panelContainer = page.locator('[data-pathfinder-content="true"]');
      await expect(panelContainer).toBeVisible({ timeout: 10000 });
    };

    await use(openPanel);
  },

  loadGuide: async ({ page }, use) => {
    const load = async (guideUrl: string) => {
      // Dispatch the auto-launch-tutorial event that Pathfinder listens for
      await page.evaluate(
        ({ url, title }) => {
          const event = new CustomEvent('auto-launch-tutorial', {
            detail: {
              url,
              title: title || 'Test Guide',
              type: url.startsWith('bundled:') ? 'learning-journey' : 'docs-page',
            },
          });
          document.dispatchEvent(event);
        },
        { url: guideUrl, title: 'Test Guide' }
      );

      // Wait a bit for the guide to start loading
      await page.waitForTimeout(1000);
    };

    await use(load);
  },

  waitForGuideLoaded: async ({ page }, use) => {
    const wait = async () => {
      // Wait for guide content to be rendered
      // Look for interactive step elements or the guide container
      await page.waitForSelector('.interactive[data-targetaction]', { timeout: 30000 });
    };

    await use(wait);
  },
});

export { expect };

