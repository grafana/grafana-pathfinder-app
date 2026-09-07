import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { test, expect } from '../fixtures';
import { E2E_ENV, isEnvFlagEnabled } from '../../src/cli/e2e/e2e-runner-contract';
import type { TestResultsData } from '../../src/cli/e2e/e2e-reporter';
import { installScopedBearerTokenRoute } from './auth/scoped-bearer-token';
import { GUIDE_INITIAL_TIMEOUT_MS } from './utils/guide-runner';
import { parsePageGuide, runGuideOnPage } from './utils/guide-runner/run-guide';
import { createRunnerSessionValidator, runRunnerPreflight } from './utils/runner-preflight';

function writeResultsFile(results: TestResultsData): void {
  const resultsFilePath = process.env[E2E_ENV.RESULTS_FILE_PATH];
  if (resultsFilePath) {
    writeFileSync(resultsFilePath, JSON.stringify(results), 'utf-8');
  }
}

function writeAbortFile(message: string): void {
  const abortFilePath = process.env[E2E_ENV.ABORT_FILE_PATH];
  if (abortFilePath) {
    writeFileSync(abortFilePath, JSON.stringify({ abortReason: 'AUTH_EXPIRED', message }), 'utf-8');
  }
}

function writeTracePathFile(outputDir: string): void {
  const tracePathFile = process.env[E2E_ENV.TRACE_OUTPUT_FILE];
  if (tracePathFile && isEnvFlagEnabled(process.env[E2E_ENV.TRACE])) {
    writeFileSync(tracePathFile, join(outputDir, 'trace.zip'), 'utf-8');
  }
}

test.describe('Guide runner', () => {
  test('loads and displays guide from JSON', async ({ page }, testInfo) => {
    test.setTimeout(GUIDE_INITIAL_TIMEOUT_MS);
    writeTracePathFile(testInfo.outputDir);

    const guidePath = process.env[E2E_ENV.GUIDE_JSON_PATH];
    if (!guidePath) {
      throw new Error(`${E2E_ENV.GUIDE_JSON_PATH} environment variable is required`);
    }
    const targetUrl = process.env[E2E_ENV.GRAFANA_URL] ?? 'http://localhost:3000';
    const startingLocation = process.env[E2E_ENV.STARTING_LOCATION] ?? '/';
    const bearerToken = process.env[E2E_ENV.GRAFANA_TOKEN];
    const verbose = isEnvFlagEnabled(process.env[E2E_ENV.VERBOSE]);
    if (bearerToken) {
      await installScopedBearerTokenRoute(page, targetUrl, bearerToken);
    }
    await runRunnerPreflight(page, targetUrl, bearerToken, verbose);

    const guide = parsePageGuide(guidePath, readFileSync(guidePath, 'utf-8'));
    const results = await runGuideOnPage(page, guide, {
      targetUrl,
      startingLocation,
      navigateToStartingLocation: true,
      replacePreviousGuide: false,
      allowReloadRecovery: true,
      verbose,
      artifactsDir: process.env[E2E_ENV.ARTIFACTS_DIR],
      alwaysScreenshot: isEnvFlagEnabled(process.env[E2E_ENV.ALWAYS_SCREENSHOT]),
      sessionValidator: createRunnerSessionValidator(targetUrl, bearerToken),
      onTimeoutCalculated: (timeoutMs) => test.setTimeout(timeoutMs),
    });
    writeResultsFile(results);

    if (results.abortReason === 'AUTH_EXPIRED') {
      writeAbortFile(results.abortMessage ?? 'Session expired mid-test');
    }
    if (results.outcome === 'infrastructure_error') {
      throw new Error(`RUNNER_TERMINATED: ${results.errorMessage}`);
    }
    expect(results.outcome).toBe('passed');
  });
});
