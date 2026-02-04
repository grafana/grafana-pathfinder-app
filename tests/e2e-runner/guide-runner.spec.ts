/**
 * Guide Runner E2E Spec
 *
 * This test is spawned by the CLI e2e command to verify that a guide
 * loads correctly in the docs panel. The guide JSON is passed via
 * environment variable GUIDE_JSON_PATH.
 *
 * Pre-flight checks (auth validation, plugin installation) run before
 * guide loading to fail fast with clear error messages.
 *
 * Step discovery uses DOM-based iteration to find all interactive steps
 * and capture their metadata (completion state, button availability, etc.).
 *
 * @see src/cli/commands/e2e.ts for the CLI that spawns this test
 * @see tests/e2e-runner/utils/preflight.ts for pre-flight check utilities
 * @see tests/e2e-runner/utils/guide-test-runner.ts for step discovery utilities
 */

import { readFileSync } from 'fs';

import { test, expect } from '../fixtures';
import { testIds } from '../../src/components/testIds';
import {
  runPlaywrightPreflightChecks,
  formatPreflightResults,
} from './utils/preflight';
import {
  discoverStepsFromDOM,
  logDiscoveryResults,
  executeAllSteps,
  logExecutionSummary,
  summarizeResults,
} from './utils/guide-test-runner';

/**
 * Storage key for E2E test guide injection.
 * Must match StorageKeys.E2E_TEST_GUIDE in src/lib/user-storage.ts
 */
const E2E_TEST_GUIDE_KEY = 'grafana-pathfinder-app-e2e-test-guide';

test.describe('Guide Runner', () => {
  test('loads and displays guide from JSON', async ({ page }) => {
    // Read guide JSON from environment variable path
    const guidePath = process.env.GUIDE_JSON_PATH;
    const grafanaUrl = process.env.GRAFANA_URL ?? 'http://localhost:3000';
    const isVerbose = process.env.E2E_VERBOSE === 'true';

    if (!guidePath) {
      throw new Error('GUIDE_JSON_PATH environment variable is required');
    }

    const guideJson = readFileSync(guidePath, 'utf-8');
    const guide = JSON.parse(guideJson) as { title?: string };
    const guideTitle = guide.title ?? 'E2E Test Guide';

    // ============================================
    // Pre-flight checks: auth and plugin validation
    // ============================================
    console.log('🔍 Running Playwright pre-flight checks...');

    const preflightResult = await runPlaywrightPreflightChecks(page, grafanaUrl);

    // Log pre-flight results
    const formattedPreflight = formatPreflightResults(preflightResult, isVerbose);
    if (formattedPreflight) {
      console.log(formattedPreflight);
    }

    if (!preflightResult.success) {
      // Determine which check failed for error reporting
      const failedCheck = preflightResult.checks.find((c) => !c.passed);
      const checkName = failedCheck?.name ?? 'unknown';

      if (checkName === 'auth-valid') {
        throw new Error(`Pre-flight auth check failed: ${preflightResult.abortReason}`);
      } else if (checkName === 'plugin-installed') {
        throw new Error(`Pre-flight plugin check failed: ${preflightResult.abortReason}`);
      } else {
        throw new Error(`Pre-flight check failed: ${preflightResult.abortReason}`);
      }
    }

    console.log(`   ✓ Auth valid [${preflightResult.checks[0]?.durationMs ?? 0}ms]`);
    console.log(`   ✓ Plugin installed [${preflightResult.checks[1]?.durationMs ?? 0}ms]`);
    console.log(`   Pre-flight total: ${preflightResult.totalDurationMs}ms`);

    // ============================================
    // Guide loading and verification
    // ============================================
    console.log('\n📚 Loading guide...');

    // Navigate to Grafana home (pre-flight may have left us on a different page)
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
    console.log(`\n✅ Guide "${guideTitle}" loaded successfully`);
    console.log(`   - Panel visible: true`);
    console.log(`   - Interactive step found: true`);
    console.log(`   - Tab with title found: ${tabCount > 0}`);

    // ============================================
    // Step discovery: DOM-based step enumeration
    // ============================================
    console.log('\n🔍 Discovering steps from DOM...');

    const discoveryResult = await discoverStepsFromDOM(page);

    // Log discovery results
    logDiscoveryResults(discoveryResult, isVerbose);

    // Verify step discovery found steps
    expect(discoveryResult.totalSteps).toBeGreaterThan(0);

    // Log step metadata for debugging
    console.log(`\n📊 Step Discovery Summary:`);
    console.log(`   - Total steps discovered: ${discoveryResult.totalSteps}`);
    console.log(`   - Pre-completed steps: ${discoveryResult.preCompletedCount}`);
    console.log(`   - Steps without "Do it" button: ${discoveryResult.noDoItButtonCount}`);
    console.log(`   - Discovery duration: ${discoveryResult.durationMs}ms`);

    // Steps should be in document order (indices should match)
    for (let i = 0; i < discoveryResult.steps.length; i++) {
      expect(discoveryResult.steps[i].index).toBe(i);
    }

    console.log(`\n✅ Step discovery completed successfully`);

    // ============================================
    // Step execution: Execute all discovered steps
    // ============================================
    console.log('\n🚀 Executing steps...');

    const executionResults = await executeAllSteps(page, discoveryResult.steps, {
      verbose: isVerbose,
      stopOnMandatoryFailure: true, // Happy path: stop on first failure
    });

    // Log execution summary
    logExecutionSummary(executionResults);

    // Get summary for assertions
    const summary = summarizeResults(executionResults);

    // Verify no failures occurred
    // Note: This is the happy path - we expect all steps to pass or be skipped
    expect(summary.failed).toBe(0);

    console.log(`\n✅ Guide execution completed: ${summary.passed} passed, ${summary.skipped} skipped`);
  });
});
