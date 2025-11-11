/**
 * Generic Playwright test for running guide tests
 * 
 * This test can be used with any guide by setting the GUIDE_URL environment variable.
 * It provides Playwright test framework integration with built-in reporting and CI/CD support.
 * 
 * Usage:
 *   GUIDE_URL=bundled:welcome-to-grafana npx playwright test e2e/guides/guide.spec.ts
 *   GUIDE_URL=./path/to/guide.html npx playwright test e2e/guides/guide.spec.ts
 * 
 * Note: This is optional. The CLI approach (npx grafana-pathfinder-app test-guide) 
 * does not require spec files and is simpler for most use cases.
 */

import { test, expect } from '../fixtures';
import { runGuideTest } from '../guide-runner';
import { TestConfig } from '../types';

test('run guide test', async ({ page, baseURL }) => {
  const guideUrl = process.env.GUIDE_URL || 'bundled:welcome-to-grafana';
  const grafanaUrl = process.env.GRAFANA_URL || baseURL || 'http://localhost:3000';
  const outputDir = process.env.TEST_OUTPUT_DIR || './test-results';

  const config: TestConfig = {
    guideUrl,
    grafanaUrl,
    outputDir,
    startStack: false,
    timeout: 30000,
  };

  const report = await runGuideTest(config);

  // Assertions
  expect(report.summary.totalSteps).toBeGreaterThan(0);
  expect(report.guide.id).toBeTruthy();

  // Test should fail if any steps failed
  if (report.summary.failed > 0) {
    console.error(`Test failed: ${report.summary.failed} steps failed`);
    // Print failed steps for debugging
    report.steps
      .filter((s) => s.status === 'failed')
      .forEach((step) => {
        console.error(`Step ${step.index} failed:`, step.error?.message);
      });
  }

  expect(report.summary.failed).toBe(0);
});

