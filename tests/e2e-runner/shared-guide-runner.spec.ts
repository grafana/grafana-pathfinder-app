import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

import { test } from '../fixtures';
import { contentDigest, createMinimalResultsData, type TestResultsData } from '../../src/cli/e2e/e2e-reporter';
import {
  E2E_ENV,
  isEnvFlagEnabled,
  parseE2EChainInput,
  type E2EChainGuide,
} from '../../src/cli/e2e/e2e-runner-contract';
import { installScopedBearerTokenRoute } from './auth/scoped-bearer-token';
import { createBrowserTerminationMonitor } from './utils/guide-runner';
import { countInteractiveBlocks, estimateGuideTimeoutFromContent } from './utils/guide-runner/static-analysis';
import { parsePageGuide, runGuideOnPage } from './utils/guide-runner/run-guide';
import { createRunnerSessionValidator, RunnerPreflightError, runRunnerPreflight } from './utils/runner-preflight';
import { runSharedGuideChain } from './utils/shared-chain';

const chainInputPath = process.env[E2E_ENV.CHAIN_INPUT_PATH];
if (!chainInputPath) {
  throw new Error(`${E2E_ENV.CHAIN_INPUT_PATH} environment variable is required`);
}
const chainInput = parseE2EChainInput(JSON.parse(readFileSync(chainInputPath, 'utf-8')));

function writeAtomicResults(results: TestResultsData[]): void {
  const resultPath = process.env[E2E_ENV.CHAIN_RESULTS_FILE_PATH];
  if (!resultPath) {
    throw new Error(`${E2E_ENV.CHAIN_RESULTS_FILE_PATH} environment variable is required`);
  }
  mkdirSync(dirname(resultPath), { recursive: true });
  const pendingPath = `${resultPath}.${process.pid}.tmp`;
  writeFileSync(pendingPath, JSON.stringify(results), 'utf-8');
  renameSync(pendingPath, resultPath);
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

function setupFailureResult(guide: E2EChainGuide, authFailure: boolean, message: string): TestResultsData {
  return createMinimalResultsData({
    guide: {
      id: guide.id,
      title: parsePageGuide(guide.path, guide.content).title,
      path: guide.path,
      targetUrl: chainInput.targetUrl,
      contentDigest: contentDigest(guide.content),
    },
    outcome: authFailure ? 'aborted' : 'infrastructure_error',
    errorCode: authFailure ? 'AUTH_EXPIRED' : 'REPORT_MISSING',
    errorMessage: message,
    ...(authFailure ? { abortReason: 'AUTH_EXPIRED' as const } : {}),
  });
}

test.describe('Shared guide runner', () => {
  test('runs all milestones in one browser session', async ({ page }, testInfo) => {
    test.setTimeout(
      chainInput.guides.reduce((total, guide) => total + estimateGuideTimeoutFromContent(guide.content), 0)
    );
    writeTracePathFile(testInfo.outputDir);

    const bearerToken = process.env[E2E_ENV.GRAFANA_TOKEN];
    const { verbose, artifactsDir, alwaysScreenshot } = chainInput.options;
    const sessionValidator = createRunnerSessionValidator(chainInput.targetUrl, bearerToken);
    if (bearerToken) {
      await installScopedBearerTokenRoute(page, chainInput.targetUrl, bearerToken);
    }

    try {
      await runRunnerPreflight(page, chainInput.targetUrl, bearerToken, verbose);
    } catch (error) {
      const authFailure = error instanceof RunnerPreflightError && error.failureKind === 'auth_expired';
      const message = error instanceof Error ? error.message : 'Runner pre-flight failed';
      const results = chainInput.guides.map((guide) => setupFailureResult(guide, authFailure, message));
      writeAtomicResults(results);
      if (authFailure) {
        writeAbortFile(message);
      }
      throw error;
    }

    const terminationMonitor = createBrowserTerminationMonitor(page);
    try {
      const outcome = await runSharedGuideChain(chainInput, {
        currentUrl: () => page.url(),
        browserSessionEnded: () => terminationMonitor.isTerminated() || page.isClosed(),
        runGuide: (guide, index, transition) =>
          test.step(guide.id, async () => {
            const session = await sessionValidator(page);
            if (!session.valid) {
              return setupFailureResult(guide, session.failureKind === 'auth_expired', session.error);
            }
            const milestoneArtifactsDir = artifactsDir
              ? join(artifactsDir, `milestone-${String(index + 1).padStart(3, '0')}-${guide.id}`)
              : undefined;
            return runGuideOnPage(page, parsePageGuide(guide.path, guide.content, guide.id), {
              targetUrl: chainInput.targetUrl,
              startingLocation: transition.startingLocation,
              navigateToStartingLocation: transition.navigateToStartingLocation,
              replacePreviousGuide: index > 0,
              previousGuideHadInteractiveSteps:
                index > 0 && countInteractiveBlocks(JSON.parse(chainInput.guides[index - 1]!.content)) > 0,
              allowReloadRecovery: index === 0,
              verbose,
              artifactsDir: milestoneArtifactsDir,
              alwaysScreenshot,
              sessionValidator,
              terminationMonitor,
            });
          }),
        onPrerequisiteSkipped: (guide, failedPrerequisite) =>
          test.step(guide.id, async () => {
            console.log(`   ⊘ Skipped: prerequisite "${failedPrerequisite}" did not pass`);
          }),
        publish: writeAtomicResults,
      });

      if (outcome.authExpired) {
        const message =
          outcome.results.find((result) => result.errorCode === 'AUTH_EXPIRED')?.errorMessage ??
          'Session expired during the shared run';
        writeAbortFile(message);
      }
      const failed = outcome.results.filter((result) => result.outcome !== 'passed' && result.outcome !== 'skipped');
      if (failed.length > 0) {
        throw new Error(`Shared guide run failed: ${failed.map((result) => result.guide.id).join(', ')}`);
      }
    } finally {
      terminationMonitor.dispose();
    }
  });
});
