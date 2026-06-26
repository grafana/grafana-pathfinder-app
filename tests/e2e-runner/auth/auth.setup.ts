/**
 * Ephemeral auth setup for the e2e guide runner.
 *
 * Mirrors `@grafana/plugin-e2e`'s form login (`POST /login`) but writes the
 * resulting storage state to the per-guide `AUTH_STATE_FILE` the CLI chose,
 * instead of plugin-e2e's username-derived `playwright/.auth/${user}.json`.
 * Writing to a disposable per-guide path is what gives each guide its own
 * isolated session with no reuse across guides.
 *
 * Used only in form-login mode. Provisioned cloud runs use token mode and skip
 * this auth project.
 */

import { test as setup } from '@playwright/test';

import { E2E_ENV } from '../../../src/cli/e2e/e2e-runner-contract';

setup('authenticate', async ({ request }) => {
  const grafanaUrl = process.env[E2E_ENV.GRAFANA_URL] ?? 'http://localhost:3000';
  const user = process.env[E2E_ENV.GRAFANA_USER] ?? 'admin';
  const password = process.env[E2E_ENV.GRAFANA_PASSWORD] ?? 'admin';
  const authStateFile = process.env[E2E_ENV.AUTH_STATE_FILE];

  if (!authStateFile) {
    throw new Error(`${E2E_ENV.AUTH_STATE_FILE} environment variable is required`);
  }

  const loginUrl = new URL('/login', grafanaUrl).toString();
  const response = await request.post(loginUrl, { data: { user, password } });

  if (!response.ok()) {
    throw new Error(`Login to ${grafanaUrl} as "${user}" failed: HTTP ${response.status()} ${response.statusText()}`);
  }

  await request.storageState({ path: authStateFile });
});
