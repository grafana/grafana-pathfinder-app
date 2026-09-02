import type { Page } from '@playwright/test';

import { testIds } from '../../../../src/constants/testIds';
import { contentDigest, type TestResultsData } from '../../../../src/cli/e2e/e2e-reporter';
import { printDetailedSummary, printDiscoveryResults, printHeader, printStepResult } from '../console-reporter';
import { discoverStepsFromDOM } from './discovery';
import { calculateGuideTimeout, executeAllSteps, settleWithin, summarizeResults } from './execution';
import { countInteractiveBlocks } from './static-analysis';
import { createBrowserTerminationMonitor, type BrowserTerminationMonitor } from './termination-monitor';
import type { AllStepsResult, StepTestResult } from './types';
import type { SessionValidationResult } from '../../auth/grafana-auth';
import { ensureDocsPanelOpen } from './bootstrap';
import { ensureGuidePanelOpen } from './panel-recovery';
import { openLegacyE2EGuide, replacePreviousE2EGuide } from './milestone-replacement';

const GUIDE_LOAD_TIMEOUT_MS = 15_000;
const HELP_READY_TIMEOUT_MS = 30_000;
const STEP_SELECTOR = '[data-testid^="interactive-step-"]';

export interface PageGuide {
  id: string;
  title: string;
  path: string;
  content: string;
}

export interface RunGuideOnPageOptions {
  targetUrl: string;
  startingLocation: string;
  navigateToStartingLocation: boolean;
  replacePreviousGuide: boolean;
  previousGuideHadInteractiveSteps: boolean;
  previousGuideTabId?: string;
  onPreviousGuideCleared?: () => void;
  onGuideOpened?: (tabId: string) => void;
  allowReloadRecovery: boolean;
  verbose: boolean;
  artifactsDir?: string;
  alwaysScreenshot: boolean;
  sessionValidator?: (page: Page) => Promise<SessionValidationResult>;
  terminationMonitor?: BrowserTerminationMonitor;
  onTimeoutCalculated?: (timeoutMs: number) => void;
}

export function parsePageGuide(path: string, content: string, plannedId?: string): PageGuide {
  const parsed = JSON.parse(content) as { id?: unknown; title?: unknown };
  const fallbackId =
    path
      .split('/')
      .pop()
      ?.replace(/\.json$/, '') ?? 'unknown';
  return {
    id: plannedId ?? (typeof parsed.id === 'string' && parsed.id ? parsed.id : fallbackId),
    title: typeof parsed.title === 'string' && parsed.title ? parsed.title : 'E2E Test Guide',
    path,
    content,
  };
}

async function loadGuide(page: Page, guide: PageGuide, options: RunGuideOnPageOptions): Promise<void> {
  if (options.navigateToStartingLocation) {
    await page.goto(options.startingLocation, { waitUntil: 'domcontentloaded', timeout: HELP_READY_TIMEOUT_MS });
  }
  await page.locator('button[aria-label="Help"]').waitFor({ state: 'visible', timeout: HELP_READY_TIMEOUT_MS });
  if (options.replacePreviousGuide) {
    await ensureDocsPanelOpen(page);
    await replacePreviousE2EGuide(page, options.previousGuideHadInteractiveSteps, options.previousGuideTabId);
    options.onPreviousGuideCleared?.();
  }
  await ensureGuidePanelOpen(page, guide.content, options.allowReloadRecovery);
  const tabId = await openLegacyE2EGuide(page, guide.title);
  options.onGuideOpened?.(tabId);
  await page.getByTestId(testIds.docsPanel.loadingState).waitFor({ state: 'hidden', timeout: GUIDE_LOAD_TIMEOUT_MS });
}

function toResultsData(
  guide: PageGuide,
  targetUrl: string,
  startingLocation: string,
  timestamp: string,
  allStepsResult: AllStepsResult,
  outcome: TestResultsData['outcome']
): TestResultsData {
  return {
    guide: {
      id: guide.id,
      title: guide.title,
      path: guide.path,
      targetUrl,
      startingLocation,
      contentDigest: contentDigest(guide.content),
    },
    timestamp,
    startedAt: timestamp,
    endedAt: new Date().toISOString(),
    outcome,
    errorCode: allStepsResult.abortReason ?? (outcome === 'passed' ? undefined : 'UNKNOWN'),
    errorMessage: allStepsResult.abortMessage,
    results: allStepsResult.results.map((result) => ({
      stepId: result.stepId,
      status: result.status,
      durationMs: result.durationMs,
      currentUrl: result.currentUrl,
      consoleErrors: result.consoleErrors,
      error: result.error,
      skipReason: result.skipReason,
      skippable: result.skippable,
      classification: result.classification,
      artifacts: result.artifacts,
    })),
    aborted: allStepsResult.aborted,
    abortReason: allStepsResult.abortReason,
    abortMessage: allStepsResult.abortMessage,
  };
}

async function executeGuideSteps(
  page: Page,
  guide: PageGuide,
  options: RunGuideOnPageOptions,
  timestamp: string,
  monitor: BrowserTerminationMonitor
): Promise<TestResultsData> {
  const firstStep = page.locator(STEP_SELECTOR).first();
  await firstStep.waitFor({ state: 'visible', timeout: GUIDE_LOAD_TIMEOUT_MS });
  const discovery = await discoverStepsFromDOM(page);
  const guideTimeout = calculateGuideTimeout(discovery.steps);
  options.onTimeoutCalculated?.(guideTimeout);
  if (discovery.totalSteps === 0) {
    throw new Error(`Guide ${guide.id} contains interactive blocks but rendered no interactive steps`);
  }

  printHeader(guide.title);
  printDiscoveryResults(
    discovery.totalSteps,
    discovery.preCompletedCount,
    discovery.noDoItButtonCount,
    discovery.durationMs
  );

  const completedResults: StepTestResult[] = [];
  const execution = executeAllSteps(page, discovery.steps, {
    verbose: options.verbose,
    stopOnMandatoryFailure: true,
    sessionCheckInterval: 5,
    sessionValidator: options.sessionValidator,
    artifactsDir: options.artifactsDir,
    alwaysScreenshot: options.alwaysScreenshot,
    onDeadline: monitor.expectPageClose,
    onStepComplete: (result) => {
      completedResults.push(result);
      printStepResult(result);
    },
  });
  const winner = await Promise.race([
    execution.then((result) => ({ kind: 'completed' as const, result })),
    monitor.termination.then(({ message }) => ({ kind: 'terminated' as const, message })),
  ]);

  if (winner.kind === 'terminated') {
    const resultsAtTermination = [...completedResults];
    monitor.expectPageClose();
    if (!page.isClosed()) {
      await settleWithin(page.close({ runBeforeUnload: false }), 1_000);
    }
    const drained = await settleWithin(execution, 1_000);
    const terminationResult: AllStepsResult = {
      results: drained.status === 'fulfilled' ? drained.value.results : resultsAtTermination,
      aborted: true,
      abortMessage: winner.message,
      infrastructureError: true,
    };
    return toResultsData(
      guide,
      options.targetUrl,
      options.startingLocation,
      timestamp,
      terminationResult,
      'infrastructure_error'
    );
  }

  const executionResult = winner.result;
  const summary = summarizeResults(executionResult.results);
  printDetailedSummary(executionResult.results, executionResult, options.verbose);
  const outcome = executionResult.infrastructureError
    ? 'infrastructure_error'
    : executionResult.abortReason === 'AUTH_EXPIRED'
      ? 'aborted'
      : executionResult.abortReason === 'MANDATORY_FAILURE' || !summary.success
        ? 'failed'
        : 'passed';
  return toResultsData(guide, options.targetUrl, options.startingLocation, timestamp, executionResult, outcome);
}

export async function runGuideOnPage(
  page: Page,
  guide: PageGuide,
  options: RunGuideOnPageOptions
): Promise<TestResultsData> {
  const timestamp = new Date().toISOString();
  await loadGuide(page, guide, options);

  if (countInteractiveBlocks(JSON.parse(guide.content)) === 0) {
    printHeader(guide.title);
    console.log('   ⊘ No interactive steps — guide is read-only content (0 steps, pass)');
    return toResultsData(
      guide,
      options.targetUrl,
      options.startingLocation,
      timestamp,
      { results: [], aborted: false },
      'passed'
    );
  }

  const monitor = options.terminationMonitor ?? createBrowserTerminationMonitor(page);
  try {
    return await executeGuideSteps(page, guide, options, timestamp, monitor);
  } finally {
    if (!options.terminationMonitor) {
      monitor.dispose();
    }
  }
}
