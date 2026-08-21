/** @jest-environment node */

import type { TestError, TestResult } from '@playwright/test/reporter';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { generateReport, type TestResultsData } from './e2e-reporter';
import { E2ETestReportSchema } from './schemas/e2e-report.schema';
import { PLAYWRIGHT_EARLY_FAILURE_MESSAGE, StructuredFailureReporter } from './structured-failure-reporter';

function failedResult(error: TestError): TestResult {
  return {
    status: 'failed',
    errors: [error],
  } as TestResult;
}

describe('StructuredFailureReporter', () => {
  let tempDir: string;
  let guidePath: string;
  let resultsFilePath: string;
  let originalGuidePath: string | undefined;
  let originalResultsFilePath: string | undefined;
  let originalGrafanaUrl: string | undefined;
  let originalStartingLocation: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pathfinder-structured-failure-'));
    guidePath = join(tempDir, 'guide.json');
    resultsFilePath = join(tempDir, 'results.json');
    writeFileSync(guidePath, JSON.stringify({ id: 'test-guide', title: 'Test guide' }), 'utf-8');

    originalGuidePath = process.env.GUIDE_JSON_PATH;
    originalResultsFilePath = process.env.RESULTS_FILE_PATH;
    originalGrafanaUrl = process.env.GRAFANA_URL;
    originalStartingLocation = process.env.STARTING_LOCATION;
    process.env.GUIDE_JSON_PATH = guidePath;
    process.env.RESULTS_FILE_PATH = resultsFilePath;
    process.env.GRAFANA_URL = 'http://localhost:3000';
    process.env.STARTING_LOCATION = '/explore';
  });

  afterEach(() => {
    restoreEnv('GUIDE_JSON_PATH', originalGuidePath);
    restoreEnv('RESULTS_FILE_PATH', originalResultsFilePath);
    restoreEnv('GRAFANA_URL', originalGrafanaUrl);
    restoreEnv('STARTING_LOCATION', originalStartingLocation);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes a schema-valid result for a preflight failure', () => {
    const reporter = new StructuredFailureReporter();
    reporter.onBegin();
    reporter.onTestEnd(undefined, failedResult({ message: 'Pre-flight plugin check failed: plugin is not installed' }));

    const data = readResults(resultsFilePath);
    expect(data).toMatchObject({
      outcome: 'infrastructure_error',
      errorCode: 'UNKNOWN',
      errorMessage: PLAYWRIGHT_EARLY_FAILURE_MESSAGE,
      guide: {
        id: 'test-guide',
        title: 'Test guide',
        targetUrl: 'http://localhost:3000',
        startingLocation: '/explore',
      },
    });
    expect(E2ETestReportSchema.parse(generateReport(data))).toMatchObject({
      schemaVersion: '1.0.0',
      outcome: 'infrastructure_error',
      errorCode: 'UNKNOWN',
    });
  });

  it('records a known Playwright assertion before step-result persistence', () => {
    const reporter = new StructuredFailureReporter();
    reporter.onBegin();
    reporter.onTestEnd(undefined, failedResult({ message: 'expect(locator).toBeVisible() failed' }));

    expect(readResults(resultsFilePath)).toMatchObject({
      errorCode: 'UNKNOWN',
      errorMessage: PLAYWRIGHT_EARLY_FAILURE_MESSAGE,
    });
  });

  it('does not persist secrets from Playwright error fields', () => {
    const reporter = new StructuredFailureReporter();
    const secrets = ['message-secret', 'stack-secret', 'value-secret', 'basic-secret'];
    reporter.onBegin();
    reporter.onError({
      message: 'Authorization: Bearer message-secret',
      stack: 'Cookie: grafana_session=stack-secret',
      value: 'E2E_GRAFANA_TOKEN=value-secret Authorization: Basic basic-secret',
    });

    const serialized = readFileSync(resultsFilePath, 'utf-8');
    expect(serialized).toContain(PLAYWRIGHT_EARLY_FAILURE_MESSAGE);
    for (const secret of secrets) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('preserves an AUTH_EXPIRED result', () => {
    const reporter = new StructuredFailureReporter();
    reporter.onBegin();
    writeResults(resultsFilePath, {
      ...baseResults(),
      outcome: 'aborted',
      errorCode: 'AUTH_EXPIRED',
      errorMessage: 'Session expired mid-test',
      aborted: true,
      abortReason: 'AUTH_EXPIRED',
      abortMessage: 'Session expired mid-test',
    });

    reporter.onTestEnd(undefined, failedResult({ message: 'AUTH_EXPIRED: Session expired mid-test' }));

    expect(readResults(resultsFilePath)).toMatchObject({
      outcome: 'aborted',
      errorCode: 'AUTH_EXPIRED',
      abortReason: 'AUTH_EXPIRED',
    });
  });

  it('preserves an ordinary mandatory guide-step failure', () => {
    const reporter = new StructuredFailureReporter();
    reporter.onBegin();
    writeResults(resultsFilePath, {
      ...baseResults(),
      outcome: 'failed',
      errorCode: 'MANDATORY_FAILURE',
      errorMessage: 'Mandatory step query-editor failed',
      aborted: true,
      abortReason: 'MANDATORY_FAILURE',
      abortMessage: 'Mandatory step query-editor failed',
      results: [
        {
          stepId: 'query-editor',
          status: 'failed',
          durationMs: 25,
          currentUrl: 'http://localhost:3000/explore',
          consoleErrors: [],
          error: 'Expected the query editor to be visible',
          skippable: false,
          classification: 'unknown',
        },
      ],
    });

    reporter.onTestEnd(undefined, failedResult({ message: 'expect(received).toBe(true)' }));

    expect(readResults(resultsFilePath)).toMatchObject({
      outcome: 'failed',
      errorCode: 'MANDATORY_FAILURE',
      abortReason: 'MANDATORY_FAILURE',
      results: [{ status: 'failed', classification: 'unknown' }],
    });
  });

  it('keeps final successful results after they overwrite the initial fallback', () => {
    const reporter = new StructuredFailureReporter();
    reporter.onBegin();
    expect(readResults(resultsFilePath)).toMatchObject({
      errorCode: 'UNKNOWN',
      errorMessage: PLAYWRIGHT_EARLY_FAILURE_MESSAGE,
    });

    writeResults(resultsFilePath, baseResults());
    reporter.onTestEnd(undefined, { status: 'passed', errors: [] } as unknown as TestResult);

    const data = readResults(resultsFilePath);
    expect(data).toMatchObject({
      outcome: 'passed',
      aborted: false,
      results: [{ stepId: 'step-1', status: 'passed' }],
    });
    expect(data.errorCode).toBeUndefined();
  });
});

function baseResults(): TestResultsData {
  return {
    guide: {
      id: 'test-guide',
      title: 'Test guide',
      path: 'guide.json',
      targetUrl: 'http://localhost:3000',
      startingLocation: '/explore',
    },
    timestamp: '2026-08-21T04:25:05.000Z',
    startedAt: '2026-08-21T04:25:05.000Z',
    endedAt: '2026-08-21T04:25:06.000Z',
    outcome: 'passed',
    results: [
      {
        stepId: 'step-1',
        status: 'passed',
        durationMs: 1000,
        currentUrl: 'http://localhost:3000/explore',
        consoleErrors: [],
        skippable: false,
      },
    ],
    aborted: false,
  };
}

function readResults(path: string): TestResultsData {
  return JSON.parse(readFileSync(path, 'utf-8')) as TestResultsData;
}

function writeResults(path: string, data: TestResultsData): void {
  writeFileSync(path, JSON.stringify(data), 'utf-8');
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
