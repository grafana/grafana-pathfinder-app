import type { Page } from '@playwright/test';

import { ensureDocsPanelOpen } from './bootstrap';
import { STEP_ROOT_SELECTOR } from './constants';
import { discoverStepsFromDOM, withExecutedCoverage } from './discovery';
import { calculateGuideTimeout, executeAllSteps, summarizeResults } from './execution';
import { openLegacyE2EGuide, replacePreviousE2EGuide } from './milestone-replacement';
import { ensureGuidePanelOpen } from './panel-recovery';
import { runGuideOnPage, type RunGuideOnPageOptions } from './run-guide';
import { countInteractiveBlocks } from './static-analysis';
import { createBrowserTerminationMonitor } from './termination-monitor';
import type { AllStepsResult, StepCoverage, TestableStep } from './types';
jest.mock('../console-reporter', () => ({
  printDetailedSummary: jest.fn(),
  printDiscoveryResults: jest.fn(),
  printHeader: jest.fn(),
  printStepResult: jest.fn(),
}));

jest.mock('./bootstrap', () => ({
  ensureDocsPanelOpen: jest.fn(),
}));
jest.mock('./discovery', () => ({
  discoverStepsFromDOM: jest.fn(),
  withExecutedCoverage: jest.fn((coverage: StepCoverage, results: AllStepsResult['results']) => ({
    ...coverage,
    executed: results.filter((result) => result.status !== 'not_reached').length,
  })),
}));
jest.mock('./execution', () => ({
  calculateGuideTimeout: jest.fn(),
  executeAllSteps: jest.fn(),
  settleWithin: jest.fn(),
  summarizeResults: jest.fn(),
}));
jest.mock('./milestone-replacement', () => ({
  openLegacyE2EGuide: jest.fn(),
  replacePreviousE2EGuide: jest.fn(),
}));
jest.mock('./panel-recovery', () => ({
  ensureGuidePanelOpen: jest.fn(),
}));
jest.mock('./static-analysis', () => ({
  countInteractiveBlocks: jest.fn().mockReturnValue(0),
}));
jest.mock('./termination-monitor', () => ({
  createBrowserTerminationMonitor: jest.fn(),
}));

const ensureDocsPanelOpenMock = ensureDocsPanelOpen as jest.MockedFunction<typeof ensureDocsPanelOpen>;
const ensureGuidePanelOpenMock = ensureGuidePanelOpen as jest.MockedFunction<typeof ensureGuidePanelOpen>;
const openLegacyE2EGuideMock = openLegacyE2EGuide as jest.MockedFunction<typeof openLegacyE2EGuide>;
const replacePreviousE2EGuideMock = replacePreviousE2EGuide as jest.MockedFunction<typeof replacePreviousE2EGuide>;
const discoverStepsFromDOMMock = discoverStepsFromDOM as jest.MockedFunction<typeof discoverStepsFromDOM>;
const withExecutedCoverageMock = withExecutedCoverage as jest.MockedFunction<typeof withExecutedCoverage>;
const calculateGuideTimeoutMock = calculateGuideTimeout as jest.MockedFunction<typeof calculateGuideTimeout>;
const executeAllStepsMock = executeAllSteps as jest.MockedFunction<typeof executeAllSteps>;
const summarizeResultsMock = summarizeResults as jest.MockedFunction<typeof summarizeResults>;
const countInteractiveBlocksMock = countInteractiveBlocks as jest.MockedFunction<typeof countInteractiveBlocks>;
const createBrowserTerminationMonitorMock = createBrowserTerminationMonitor as jest.MockedFunction<
  typeof createBrowserTerminationMonitor
>;

function page(events: string[]): Page {
  return {
    goto: jest.fn().mockImplementation(async () => {
      events.push('navigate');
    }),
    getByTestId: jest.fn().mockReturnValue({
      waitFor: jest.fn().mockImplementation(async () => {
        events.push('content-ready');
      }),
    }),
    locator: jest.fn().mockReturnValue({
      filter: jest.fn().mockReturnValue({
        first: jest.fn().mockReturnValue({
          waitFor: jest.fn().mockResolvedValue(undefined),
        }),
      }),
    }),
  } as unknown as Page;
}

function options(events: string[]): RunGuideOnPageOptions {
  return {
    targetUrl: 'http://localhost:3000',
    startingLocation: '/later',
    navigateToStartingLocation: true,
    replacePreviousGuide: true,
    previousGuideTabId: 'old-tab',
    onPreviousGuideCleared: () => {
      events.push('previous-cleared');
    },
    onGuideOpened: (tabId) => {
      events.push(`opened:${tabId}`);
    },
    allowReloadRecovery: false,
    verbose: false,
    artifactsDir: undefined,
    alwaysScreenshot: false,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  countInteractiveBlocksMock.mockReturnValue(0);
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('clears the recorded previous tab before navigation and guide loading', async () => {
  const events: string[] = [];
  const currentPage = page(events);
  ensureDocsPanelOpenMock.mockImplementation(async () => {
    events.push('panel-restored');
    return {} as never;
  });
  replacePreviousE2EGuideMock.mockImplementation(async () => {
    events.push('previous-replaced');
  });
  ensureGuidePanelOpenMock.mockImplementation(async () => {
    events.push('guide-injected');
  });
  openLegacyE2EGuideMock.mockImplementation(async () => {
    events.push('guide-opened');
    return 'new-tab';
  });

  const result = await runGuideOnPage(
    currentPage,
    {
      id: 'later',
      title: 'Later guide',
      path: '/later/content.json',
      content: '{"id":"later","title":"Later guide","blocks":[]}',
    },
    options(events)
  );

  expect(replacePreviousE2EGuideMock).toHaveBeenCalledWith(currentPage, 'old-tab');
  expect(ensureGuidePanelOpenMock).toHaveBeenCalledWith(
    currentPage,
    '{"id":"later","title":"Later guide","blocks":[]}',
    false,
    30_000
  );
  expect(events).toEqual([
    'panel-restored',
    'previous-replaced',
    'previous-cleared',
    'navigate',
    'guide-injected',
    'guide-opened',
    'opened:new-tab',
    'content-ready',
  ]);
  expect(result.outcome).toBe('passed');
});

it('keeps a pre-tab guide-load failure recoverable after previous state is cleared', async () => {
  const events: string[] = [];
  const currentPage = page(events);
  const loadError = new Error('The guide panel did not open');
  ensureDocsPanelOpenMock.mockResolvedValue({} as never);
  replacePreviousE2EGuideMock.mockResolvedValue(undefined);
  ensureGuidePanelOpenMock.mockRejectedValue(loadError);

  await expect(
    runGuideOnPage(
      currentPage,
      {
        id: 'later',
        title: 'Later guide',
        path: '/later/content.json',
        content: '{"id":"later","title":"Later guide","blocks":[]}',
      },
      options(events)
    )
  ).rejects.toBe(loadError);

  expect(openLegacyE2EGuideMock).not.toHaveBeenCalled();
});

it('keeps a content-load failure recoverable after the new guide tab becomes active', async () => {
  const events: string[] = [];
  const loadError = new Error('Guide loading timed out');
  const currentPage = {
    ...page(events),
    getByTestId: jest.fn().mockReturnValue({
      waitFor: jest.fn().mockRejectedValue(loadError),
    }),
  } as unknown as Page;
  ensureDocsPanelOpenMock.mockResolvedValue({} as never);
  replacePreviousE2EGuideMock.mockResolvedValue(undefined);
  ensureGuidePanelOpenMock.mockResolvedValue(undefined);
  openLegacyE2EGuideMock.mockResolvedValue('new-tab');

  await expect(
    runGuideOnPage(
      currentPage,
      {
        id: 'later',
        title: 'Later guide',
        path: '/later/content.json',
        content: '{"id":"later","title":"Later guide","blocks":[]}',
      },
      options(events)
    )
  ).rejects.toBe(loadError);
  expect(events).toContain('opened:new-tab');
});

function supportedStep(): TestableStep {
  return {
    stepKind: 'plain',
    stepId: 'plain-1',
    index: 0,
    skippable: false,
    hasDoItButton: true,
    hasShowMeButton: false,
    isPreCompleted: false,
    actionCount: 0,
    locator: {} as TestableStep['locator'],
  };
}

function setupInteractiveRun(steps: TestableStep[], coverage: StepCoverage, result: AllStepsResult): void {
  countInteractiveBlocksMock.mockReturnValue(coverage.rendered);
  discoverStepsFromDOMMock.mockResolvedValue({
    steps,
    totalSteps: steps.length,
    preCompletedCount: 0,
    noDoItButtonCount: 0,
    durationMs: 10,
    coverage,
  });
  calculateGuideTimeoutMock.mockReturnValue(1_000);
  executeAllStepsMock.mockResolvedValue(result);
  summarizeResultsMock.mockReturnValue({
    total: result.results.length,
    passed: result.results.filter(({ status }) => status === 'passed').length,
    failed: 0,
    skipped: 0,
    notReached: 0,
    mandatoryFailed: 0,
    skippableFailed: 0,
    success: true,
    totalDurationMs: 10,
  });
  createBrowserTerminationMonitorMock.mockReturnValue({
    termination: new Promise<never>(() => undefined),
    isTerminated: jest.fn().mockReturnValue(false),
    expectPageClose: jest.fn(),
    dispose: jest.fn(),
  });
  ensureDocsPanelOpenMock.mockResolvedValue({} as never);
  replacePreviousE2EGuideMock.mockResolvedValue(undefined);
  ensureGuidePanelOpenMock.mockResolvedValue(undefined);
  openLegacyE2EGuideMock.mockResolvedValue('new-tab');
}

it('reports mixed supported and unsupported tracked roots', async () => {
  const events: string[] = [];
  const currentPage = page(events);
  const step = supportedStep();
  const coverage: StepCoverage = {
    contractSource: 'current',
    rendered: 2,
    supported: 1,
    executed: 0,
    unsupported: 1,
    unsupportedSteps: [{ stepKind: 'quiz', stepId: 'quiz-1' }],
  };
  setupInteractiveRun([step], coverage, {
    results: [
      {
        stepId: step.stepId,
        stepKind: step.stepKind,
        status: 'passed',
        durationMs: 10,
        currentUrl: '/',
        consoleErrors: [],
        skippable: false,
      },
    ],
    aborted: false,
  });

  const result = await runGuideOnPage(
    currentPage,
    {
      id: 'mixed',
      title: 'Mixed guide',
      path: '/mixed/content.json',
      content: '{"id":"mixed","blocks":[{"type":"interactive"}]}',
    },
    options(events)
  );

  expect(result.outcome).toBe('passed');
  expect(result.results[0]).toMatchObject({ stepId: 'plain-1', stepKind: 'plain' });
  expect(result.coverage).toEqual({ ...coverage, executed: 1 });
  expect(withExecutedCoverageMock).toHaveBeenCalledWith(coverage, expect.any(Array));
  expect(currentPage.locator).toHaveBeenCalledWith(STEP_ROOT_SELECTOR);
  const stepRoots = (currentPage.locator as jest.Mock).mock.results[0].value as { filter: jest.Mock };
  expect(stepRoots.filter).toHaveBeenCalledWith({ visible: true });
});

it('reports an unsupported-only guide without changing its outcome', async () => {
  const events: string[] = [];
  const coverage: StepCoverage = {
    contractSource: 'current',
    rendered: 1,
    supported: 0,
    executed: 0,
    unsupported: 1,
    unsupportedSteps: [{ stepKind: 'terminal', stepId: 'terminal-1' }],
  };
  setupInteractiveRun([], coverage, { results: [], aborted: false });

  const result = await runGuideOnPage(
    page(events),
    {
      id: 'unsupported',
      title: 'Unsupported guide',
      path: '/unsupported/content.json',
      content: '{"id":"unsupported","blocks":[{"type":"interactive"}]}',
    },
    options(events)
  );

  expect(result.outcome).toBe('passed');
  expect(result.results).toEqual([]);
  expect(result.coverage).toEqual(coverage);
});
