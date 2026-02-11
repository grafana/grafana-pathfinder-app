/**
 * Playwright config for E2E Runner
 *
 * This is a separate config for the e2e-runner tests which are invoked
 * by the pathfinder-cli e2e command, not the standard CI test suite.
 *
 * The main playwright.config.ts excludes e2e-runner tests (testIgnore),
 * so we need this dedicated config to run them.
 */

import type { PluginOptions } from '@grafana/plugin-e2e';
import { defineConfig, devices } from '@playwright/test';
import { dirname, join } from 'node:path';

const pluginE2eAuth = `${dirname(require.resolve('@grafana/plugin-e2e'))}/auth`;

// Resolve paths relative to project root (two levels up from this file)
const projectRoot = join(__dirname, '..', '..');

export default defineConfig<PluginOptions>({
  // Test directory is the e2e-runner folder
  testDir: __dirname,
  // Only match *.spec.ts files
  testMatch: '**/*.spec.ts',
  // NO testIgnore - we want to run these tests
  fullyParallel: false, // Sequential execution for guide tests
  forbidOnly: !!process.env.CI,
  retries: 0, // No retries - failures should be investigated
  reporter: process.env.E2E_VERBOSE === 'true' ? 'list' : 'line',
  use: {
    baseURL: process.env.GRAFANA_URL || 'http://localhost:3000',
    trace: process.env.E2E_TRACE === 'true' ? 'on' : 'off',
  },
  projects: [
    // 1. Login to Grafana and store the cookie on disk for use in other tests.
    {
      name: 'auth',
      testDir: pluginE2eAuth,
      testMatch: [/.*\.js/],
    },
    // 2. Run tests in Google Chrome. Every test will start authenticated as admin user.
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: join(projectRoot, 'playwright/.auth/admin.json'),
      },
      dependencies: ['auth'],
    },
  ],
});
