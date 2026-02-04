/**
 * Guide Runner E2E Spec
 *
 * This test is spawned by the CLI e2e command to verify that a guide
 * loads correctly in the docs panel. The guide JSON is passed via
 * environment variable GUIDE_JSON_PATH.
 *
 * @see src/cli/commands/e2e.ts for the CLI that spawns this test
 */

import { readFileSync } from 'fs';

import { test, expect } from '../fixtures';
import { testIds } from '../../src/components/testIds';

/**
 * Storage key for E2E test guide injection.
 * Must match StorageKeys.E2E_TEST_GUIDE in src/lib/user-storage.ts
 */
const E2E_TEST_GUIDE_KEY = 'grafana-pathfinder-app-e2e-test-guide';

test('loads and displays guide from JSON', async ({ page }) => {
  // Read guide JSON from environment variable path
  const guidePath = process.env.GUIDE_JSON_PATH;

  if (!guidePath) {
    throw new Error('GUIDE_JSON_PATH environment variable is required');
  }

  const guideJson = readFileSync(guidePath, 'utf-8');
  const guide = JSON.parse(guideJson) as { title?: string };
  const guideTitle = guide.title ?? 'E2E Test Guide';

  // Navigate to Grafana
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Inject guide into localStorage
  await page.evaluate(
    ({ key, json }) => {
      localStorage.setItem(key, json);
    },
    { key: E2E_TEST_GUIDE_KEY, json: guideJson }
  );

  // Open guide via custom event
  // The event dispatcher opens a tab with bundled:e2e-test which loads from localStorage
  await page.evaluate(
    ({ title }) => {
      document.dispatchEvent(
        new CustomEvent('pathfinder-auto-open-docs', {
          detail: { url: 'bundled:e2e-test', title },
        })
      );
    },
    { title: guideTitle }
  );

  // Verify panel opens and shows guide content
  const panel = page.getByTestId(testIds.docsPanel.container);
  await expect(panel).toBeVisible({ timeout: 10000 });

  // Verify guide content loaded (first step visible indicates interactive content rendered)
  // Use a more general selector since step IDs vary by guide
  const firstStep = page.locator('[data-testid^="interactive-step-"]').first();
  await expect(firstStep).toBeVisible({ timeout: 15000 });

  // Optionally verify the title appears in the tab or content
  // The tab title should contain the guide title
  const tabWithTitle = page.locator(`[data-testid^="docs-panel-tab-"]`).filter({ hasText: guideTitle });
  const tabCount = await tabWithTitle.count();

  // Log success details
  console.log(`✅ Guide "${guideTitle}" loaded successfully`);
  console.log(`   - Panel visible: true`);
  console.log(`   - Interactive step found: true`);
  console.log(`   - Tab with title found: ${tabCount > 0}`);
});
