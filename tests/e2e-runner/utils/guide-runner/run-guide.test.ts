import type { Page } from '@playwright/test';

import { ensureDocsPanelOpen } from './bootstrap';
import { openLegacyE2EGuide, replacePreviousE2EGuide } from './milestone-replacement';
import { ensureGuidePanelOpen } from './panel-recovery';
import { runGuideOnPage, type RunGuideOnPageOptions } from './run-guide';
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
