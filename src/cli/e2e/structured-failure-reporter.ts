import type { Reporter, TestError, TestResult } from '@playwright/test/reporter';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { basename } from 'path';

import { E2E_ENV } from './e2e-runner-contract';
import { contentDigest, createMinimalResultsData, type TestResultsData } from './e2e-reporter';

export const PLAYWRIGHT_EARLY_FAILURE_MESSAGE = 'Playwright failed before it wrote final guide results.';

function readCurrentResults(resultsFilePath: string): unknown {
  if (!existsSync(resultsFilePath)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(resultsFilePath, 'utf-8')) as unknown;
  } catch {
    return undefined;
  }
}

export function isStructuredFailureFallback(results: unknown): results is TestResultsData {
  if (typeof results !== 'object' || results === null) {
    return false;
  }

  const candidate = results as Partial<TestResultsData>;
  return (
    typeof candidate.guide?.id === 'string' &&
    typeof candidate.guide.title === 'string' &&
    typeof candidate.guide.path === 'string' &&
    typeof candidate.timestamp === 'string' &&
    candidate.outcome === 'infrastructure_error' &&
    candidate.errorCode === 'UNKNOWN' &&
    candidate.errorMessage === PLAYWRIGHT_EARLY_FAILURE_MESSAGE &&
    candidate.abortMessage === PLAYWRIGHT_EARLY_FAILURE_MESSAGE &&
    candidate.aborted === true &&
    candidate.abortReason === undefined &&
    Array.isArray(candidate.results) &&
    candidate.results.length === 0
  );
}

function canWriteStructuredFailure(resultsFilePath: string): boolean {
  if (!existsSync(resultsFilePath)) {
    return true;
  }
  return isStructuredFailureFallback(readCurrentResults(resultsFilePath));
}

function guideMetadata(): TestResultsData['guide'] {
  const guidePath = process.env[E2E_ENV.GUIDE_JSON_PATH] ?? 'unknown';
  const pathId = basename(guidePath).replace(/\.json$/, '') || 'unknown';
  let id = pathId;
  let title = pathId;
  let guideContent: string | undefined;

  try {
    guideContent = readFileSync(guidePath, 'utf-8');
    const guide = JSON.parse(guideContent) as { id?: unknown; title?: unknown };
    if (typeof guide.id === 'string' && guide.id) {
      id = guide.id;
    }
    if (typeof guide.title === 'string' && guide.title) {
      title = guide.title;
    }
  } catch {
    guideContent = undefined;
  }

  return {
    id,
    title,
    path: guidePath,
    targetUrl: process.env[E2E_ENV.GRAFANA_URL] ?? 'http://localhost:3000',
    startingLocation: process.env[E2E_ENV.STARTING_LOCATION] ?? '/',
    ...(guideContent ? { contentDigest: contentDigest(guideContent) } : {}),
  };
}
export class StructuredFailureReporter implements Reporter {
  onBegin(): void {
    this.writeStructuredFailure();
  }

  onTestEnd(_test: unknown, result: TestResult): void {
    if (result.status === 'failed' || result.status === 'timedOut' || result.status === 'interrupted') {
      this.writeStructuredFailure();
    }
  }

  onError(_error: TestError): void {
    this.writeStructuredFailure();
  }

  private writeStructuredFailure(): void {
    const resultsFilePath = process.env[E2E_ENV.RESULTS_FILE_PATH];
    if (!resultsFilePath || !canWriteStructuredFailure(resultsFilePath)) {
      return;
    }

    const results = createMinimalResultsData({
      guide: guideMetadata(),
      outcome: 'infrastructure_error',
      errorCode: 'UNKNOWN',
      errorMessage: PLAYWRIGHT_EARLY_FAILURE_MESSAGE,
    });

    try {
      writeFileSync(resultsFilePath, JSON.stringify(results), 'utf-8');
    } catch {
      return;
    }
  }
}

export default StructuredFailureReporter;
