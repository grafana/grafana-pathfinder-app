import { writeFileSync } from 'fs';

import { contentDigest, type TestResultsData } from '../../../../src/cli/e2e/e2e-reporter';
import { E2E_ENV } from '../../../../src/cli/e2e/e2e-runner-contract';
import type { E2EErrorCode } from '../../../../src/cli/e2e/schemas/e2e-report.schema';
import type { AbortReason, AllStepsResult, StepTestResult } from './types';

function writeAbortFile(data: { message: string; abortReason?: AbortReason; errorCode?: E2EErrorCode }): void {
  const abortFilePath = process.env[E2E_ENV.ABORT_FILE_PATH];
  if (abortFilePath) {
    writeFileSync(abortFilePath, JSON.stringify(data), 'utf-8');
  }
}

export function publishGuideResult(input: {
  results: StepTestResult[];
  guide: { id: string; title: string; path: string };
  targetUrl: string;
  startingLocation: string;
  timestamp: string;
  allStepsResult: AllStepsResult;
  guideContent: string;
  outcome: NonNullable<TestResultsData['outcome']>;
}): void {
  const data: TestResultsData = {
    guide: {
      ...input.guide,
      targetUrl: input.targetUrl,
      startingLocation: input.startingLocation,
      contentDigest: contentDigest(input.guideContent),
    },
    timestamp: input.timestamp,
    startedAt: input.timestamp,
    endedAt: new Date().toISOString(),
    outcome: input.outcome,
    errorCode:
      input.allStepsResult.errorCode ??
      input.allStepsResult.abortReason ??
      (input.outcome === 'failed' ? 'UNKNOWN' : undefined),
    errorMessage: input.allStepsResult.abortMessage,
    results: input.results.map((result) => ({
      stepId: result.stepId,
      status: result.status,
      durationMs: result.durationMs,
      currentUrl: result.currentUrl,
      consoleErrors: result.consoleErrors,
      error: result.error,
      errorCode: result.errorCode,
      skipReason: result.skipReason,
      skippable: result.skippable,
      classification: result.classification,
      artifacts: result.artifacts,
    })),
    aborted: input.allStepsResult.aborted,
    abortReason: input.allStepsResult.abortReason,
    abortMessage: input.allStepsResult.abortMessage,
  };

  const resultsFilePath = process.env[E2E_ENV.RESULTS_FILE_PATH];
  if (resultsFilePath) {
    writeFileSync(resultsFilePath, JSON.stringify(data), 'utf-8');
  }
  if (input.allStepsResult.abortReason === 'AUTH_EXPIRED') {
    writeAbortFile({
      abortReason: 'AUTH_EXPIRED',
      message: input.allStepsResult.abortMessage ?? 'Session expired mid-test',
    });
  } else if (input.allStepsResult.errorCode && input.outcome !== 'passed') {
    writeAbortFile({
      errorCode: input.allStepsResult.errorCode,
      message: input.allStepsResult.abortMessage ?? 'The guide stopped before completion.',
    });
  }
}
