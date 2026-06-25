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
import { join } from 'node:path';

import { E2E_ENV, isEnvFlagEnabled } from '../../src/cli/e2e/e2e-runner-contract';

// Resolve paths relative to project root (two levels up from this file)
const projectRoot = join(__dirname, '..', '..');

// Per-guide auth state: the CLI points AUTH_STATE_FILE at a disposable temp file
// the auth setup writes to. Falls back to the default admin state for direct
// (non-CLI) local runs.
const storageState = process.env[E2E_ENV.AUTH_STATE_FILE] || join(projectRoot, 'playwright/.auth/admin.json');

// Service-account token auth (Grafana Cloud): authenticate every browser request
// with a Bearer header rather than a form-login session. This is the method that
// works against grafana.com-SSO Cloud stacks, where POST /login is unavailable.
// When a token is present the form-login `auth` project is skipped (there is no
// session cookie to establish) and no storageState is loaded.
const serviceAccountToken = process.env[E2E_ENV.GRAFANA_TOKEN];
const useToken = Boolean(serviceAccountToken);

const authProject = { name: 'auth', testMatch: /auth\/auth\.setup\.ts$/ };

export default defineConfig<PluginOptions>({
  // Test directory is the e2e-runner folder
  testDir: __dirname,
  // Only match *.spec.ts files
  testMatch: '**/*.spec.ts',
  // NO testIgnore - we want to run these tests
  fullyParallel: false, // Sequential execution for guide tests
  forbidOnly: !!process.env.CI,
  retries: 0, // No retries - failures should be investigated
  reporter: isEnvFlagEnabled(process.env[E2E_ENV.VERBOSE]) ? 'list' : 'line',
  use: {
    baseURL: process.env[E2E_ENV.GRAFANA_URL] || 'http://localhost:3000',
    trace: isEnvFlagEnabled(process.env[E2E_ENV.TRACE]) ? 'on' : 'off',
  },
  projects: [
    // 1. Form-login auth project: logs in and stores session state at
    //    AUTH_STATE_FILE (our own setup, not plugin-e2e's). Skipped in token mode
    //    because Bearer auth needs no session cookie.
    ...(useToken ? [] : [authProject]),
    // 2. Run tests in Google Chrome. In token mode every request carries the
    //    Bearer header; otherwise the test starts from the form-login session.
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(useToken ? { extraHTTPHeaders: { Authorization: `Bearer ${serviceAccountToken}` } } : { storageState }),
      },
      ...(useToken ? {} : { dependencies: ['auth'] }),
    },
  ],
});
