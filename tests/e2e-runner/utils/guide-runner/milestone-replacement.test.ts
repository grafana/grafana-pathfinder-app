import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { ElementHandle, Page } from '@playwright/test';
import { testIds } from '../../../../src/constants/testIds';
import { StorageKeys } from '../../../../src/lib/storage-keys';

import { dismissBadgeCelebrations } from './badge-celebrations';
import { E2E_GUIDE_URL, openLegacyE2EGuide, replacePreviousE2EGuide } from './milestone-replacement';

jest.mock('./badge-celebrations', () => ({
  dismissBadgeCelebrations: jest.fn().mockResolvedValue(undefined),
}));

interface FakeStepHandle extends Pick<ElementHandle<HTMLElement>, 'evaluate' | 'dispose'> {
  connected: boolean;
}

function stepHandle(): FakeStepHandle {
  const handle: FakeStepHandle = {
    connected: true,
    evaluate: jest.fn((callback: (element: { isConnected: boolean }) => boolean) =>
      Promise.resolve(callback({ isConnected: handle.connected }))
    ) as never,
    dispose: jest.fn().mockResolvedValue(undefined),
  };
  return handle;
}

interface ReplacementHarnessOptions {
  resetControlCount: number;
  resetControlCountBeforeWait?: number;
  resetSteps?: FakeStepHandle[];
  closeSteps?: FakeStepHandle[];
}

function replacementHarness(options: ReplacementHarnessOptions) {
  const operations: string[] = [];
  const resetSteps = options.resetSteps ?? [];
  const closeSteps = options.closeSteps ?? [];
  const handleQueues = [resetSteps, closeSteps];
  let resetControlCount = options.resetControlCountBeforeWait ?? options.resetControlCount;
  const resetButton = {
    count: jest.fn().mockImplementation(() => Promise.resolve(resetControlCount)),
    waitFor: jest.fn().mockImplementation(async () => {
      resetControlCount = options.resetControlCount;
      if (resetControlCount === 0) {
        const error = new Error('The Reset guide control did not become visible');
        error.name = 'TimeoutError';
        throw error;
      }
    }),
    click: jest.fn().mockImplementation(async () => {
      operations.push('reset');
      resetSteps.forEach((step) => {
        step.connected = false;
      });
      window.dispatchEvent(
        new CustomEvent('interactive-progress-cleared', {
          detail: { contentKey: E2E_GUIDE_URL },
        })
      );
    }),
  };
  const closeButton = {
    click: jest.fn().mockImplementation(async () => {
      operations.push('close');
      [...resetSteps, ...closeSteps].forEach((step) => {
        step.connected = false;
      });
      (window as Window & { __DocsPluginActiveTabUrl?: string }).__DocsPluginActiveTabUrl = '';
    }),
  };
  const tabButton = {
    count: jest.fn().mockResolvedValue(1),
    click: jest.fn().mockImplementation(async () => {
      operations.push('activate');
      (window as Window & { __DocsPluginActiveTabId?: string }).__DocsPluginActiveTabId = 'tab-1';
      (window as Window & { __DocsPluginActiveTabUrl?: string }).__DocsPluginActiveTabUrl = E2E_GUIDE_URL;
    }),
  };
  const page = {
    evaluate: jest.fn().mockImplementation((callback, argument) => Promise.resolve(callback(argument))),
    waitForFunction: jest.fn().mockImplementation((callback, argument) => {
      if (!callback(argument)) {
        return Promise.reject(new Error('Condition not met'));
      }
      return Promise.resolve(undefined);
    }),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    locator: jest.fn().mockReturnValue({
      elementHandles: jest.fn().mockImplementation(() => Promise.resolve(handleQueues.shift() ?? [])),
    }),
    getByRole: jest.fn().mockReturnValue(resetButton),
    getByTestId: jest.fn().mockImplementation((id: string) => {
      return id === testIds.docsPanel.tab('tab-1') ? tabButton : closeButton;
    }),
    reload: jest.fn(),
  } as unknown as Page;
  (window as Window & { __DocsPluginActiveTabId?: string }).__DocsPluginActiveTabId = 'tab-1';
  (window as Window & { __DocsPluginActiveTabUrl?: string }).__DocsPluginActiveTabUrl = E2E_GUIDE_URL;
  return { page, operations, resetButton, closeButton, tabButton };
}

function waitForOpenedGuide(): Promise<{ url: string; title: string }> {
  return new Promise((resolve) => {
    document.addEventListener(
      'pathfinder-auto-open-docs',
      (event) => {
        const detail = (event as CustomEvent<{ url: string; title: string }>).detail;
        (window as Window & { __DocsPluginActiveTabId?: string }).__DocsPluginActiveTabId = 'opened-tab';
        (window as Window & { __DocsPluginActiveTabUrl?: string }).__DocsPluginActiveTabUrl = detail.url;
        resolve(detail);
      },
      { once: true }
    );
  });
}

afterEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  delete (window as Window & { __DocsPluginActiveTabId?: string }).__DocsPluginActiveTabId;
  delete (window as Window & { __DocsPluginActiveTabUrl?: string }).__DocsPluginActiveTabUrl;
});

it('waits for reset synchronization before closing and detaches both step generations', async () => {
  const resetStep = stepHandle();
  const closeStep = stepHandle();
  const harness = replacementHarness({
    resetControlCount: 1,
    resetSteps: [resetStep],
    closeSteps: [closeStep],
  });

  await replacePreviousE2EGuide(harness.page, true);

  expect(harness.operations).toEqual(['reset', 'close']);
  expect(resetStep.dispose).toHaveBeenCalledTimes(1);
  expect(closeStep.dispose).toHaveBeenCalledTimes(1);
  expect(harness.page.reload).not.toHaveBeenCalled();
  expect(dismissBadgeCelebrations).toHaveBeenCalledWith(harness.page);
});

it('waits for an interactive restored tab to render its Reset guide control', async () => {
  const harness = replacementHarness({
    resetControlCount: 1,
    resetControlCountBeforeWait: 0,
  });

  await replacePreviousE2EGuide(harness.page, true, 'tab-1');

  expect(harness.resetButton.waitFor).toHaveBeenCalledWith({ state: 'visible', timeout: 15_000 });
  expect(harness.operations).toEqual(['reset', 'close']);
});

it('closes a zero-step guide directly when no Reset guide control exists', async () => {
  const harness = replacementHarness({ resetControlCount: 0, closeSteps: [] });
  await replacePreviousE2EGuide(harness.page, false);

  expect(harness.resetButton.waitFor).not.toHaveBeenCalled();
  expect(harness.resetButton.click).not.toHaveBeenCalled();
  expect(harness.closeButton.click).toHaveBeenCalledTimes(1);
});

it('fails when an interactive guide has no Reset guide control', async () => {
  const harness = replacementHarness({ resetControlCount: 0 });
  await expect(replacePreviousE2EGuide(harness.page, true)).rejects.toMatchObject({ name: 'TimeoutError' });

  expect(harness.closeButton.click).not.toHaveBeenCalled();
});

it('opens a later guide when the prior milestone failed before tab activation', async () => {
  const harness = replacementHarness({ resetControlCount: 0 });
  delete (window as Window & { __DocsPluginActiveTabId?: string }).__DocsPluginActiveTabId;
  delete (window as Window & { __DocsPluginActiveTabUrl?: string }).__DocsPluginActiveTabUrl;
  const progressKeys = [
    `${StorageKeys.INTERACTIVE_STEPS_PREFIX}${E2E_GUIDE_URL}-section-1`,
    `${StorageKeys.SECTION_COLLAPSE_PREFIX}${E2E_GUIDE_URL}-section-1`,
    `${StorageKeys.SECTION_ACKNOWLEDGED_PREFIX}${E2E_GUIDE_URL}-section-1`,
    `${StorageKeys.SECTION_DONE_PREFIX}${E2E_GUIDE_URL}-section-1`,
  ];
  progressKeys.forEach((key) => localStorage.setItem(key, JSON.stringify(['step-1'])));
  localStorage.setItem(StorageKeys.INTERACTIVE_COMPLETION, JSON.stringify({ [E2E_GUIDE_URL]: 100, other: 50 }));
  const opened = waitForOpenedGuide();
  await replacePreviousE2EGuide(harness.page, true);
  await openLegacyE2EGuide(harness.page, 'Later milestone');

  await expect(opened).resolves.toEqual({ url: E2E_GUIDE_URL, title: 'Later milestone' });
  expect(progressKeys.every((key) => localStorage.getItem(key) === null)).toBe(true);
  expect(JSON.parse(localStorage.getItem(StorageKeys.INTERACTIVE_COMPLETION) ?? '{}')).toEqual({ other: 50 });
  expect(harness.operations).toEqual([]);
  expect(dismissBadgeCelebrations).not.toHaveBeenCalled();
});

it('reactivates and resets a prior E2E guide after browser globals reset', async () => {
  const harness = replacementHarness({ resetControlCount: 1 });
  delete (window as Window & { __DocsPluginActiveTabId?: string }).__DocsPluginActiveTabId;
  delete (window as Window & { __DocsPluginActiveTabUrl?: string }).__DocsPluginActiveTabUrl;

  await replacePreviousE2EGuide(harness.page, true, 'tab-1');

  expect(harness.operations).toEqual(['activate', 'reset', 'close']);
  expect(harness.tabButton.click).toHaveBeenCalledTimes(1);
});

it('opens only the exact legacy E2E URL', async () => {
  const page = {
    evaluate: jest.fn().mockImplementation((callback, argument) => Promise.resolve(callback(argument))),
    waitForFunction: jest.fn().mockImplementation((callback, argument) => {
      if (!callback(argument)) {
        return Promise.reject(new Error('Condition not met'));
      }
      return Promise.resolve(undefined);
    }),
  } as unknown as Page;
  const opened = waitForOpenedGuide();

  await expect(openLegacyE2EGuide(page, 'Milestone')).resolves.toBe('opened-tab');

  await expect(opened).resolves.toEqual({ url: 'bundled:e2e-test', title: 'Milestone' });
});

it('has no unique URL helper or docs-retrieval import in the runner', () => {
  const projectRoot = join(__dirname, '../../../..');
  const runnerSource = readFileSync(join(__dirname, 'run-guide.ts'), 'utf-8');

  expect(existsSync(join(projectRoot, 'src/lib/e2e-guide-url.ts'))).toBe(false);
  expect(runnerSource).not.toContain('src/docs-retrieval');
  expect(runnerSource).not.toContain('bundled:e2e-test/');
});
