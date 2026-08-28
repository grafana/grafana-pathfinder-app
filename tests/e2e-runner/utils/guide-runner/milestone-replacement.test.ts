import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { ElementHandle, Page } from '@playwright/test';

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
  resetSteps?: FakeStepHandle[];
  closeSteps?: FakeStepHandle[];
}

function replacementHarness(options: ReplacementHarnessOptions) {
  const operations: string[] = [];
  const resetSteps = options.resetSteps ?? [];
  const closeSteps = options.closeSteps ?? [];
  const handleQueues = [resetSteps, closeSteps];
  const resetButton = {
    count: jest.fn().mockResolvedValue(options.resetControlCount),
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
    getByTestId: jest.fn().mockReturnValue(closeButton),
    reload: jest.fn(),
  } as unknown as Page;
  (window as Window & { __DocsPluginActiveTabId?: string }).__DocsPluginActiveTabId = 'tab-1';
  (window as Window & { __DocsPluginActiveTabUrl?: string }).__DocsPluginActiveTabUrl = E2E_GUIDE_URL;
  return { page, operations, resetButton, closeButton };
}

afterEach(() => {
  jest.clearAllMocks();
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

it('closes a zero-step guide directly when no Reset guide control exists', async () => {
  const harness = replacementHarness({ resetControlCount: 0, closeSteps: [] });

  await replacePreviousE2EGuide(harness.page, false);

  expect(harness.resetButton.click).not.toHaveBeenCalled();
  expect(harness.closeButton.click).toHaveBeenCalledTimes(1);
});

it('fails when an interactive guide has no Reset guide control', async () => {
  const harness = replacementHarness({ resetControlCount: 0 });

  await expect(replacePreviousE2EGuide(harness.page, true)).rejects.toThrow('no Reset guide control');

  expect(harness.closeButton.click).not.toHaveBeenCalled();
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
  const opened = new Promise<{ url: string; title: string }>((resolve) => {
    document.addEventListener(
      'pathfinder-auto-open-docs',
      (event) => {
        const detail = (event as CustomEvent<{ url: string; title: string }>).detail;
        (window as Window & { __DocsPluginActiveTabUrl?: string }).__DocsPluginActiveTabUrl = detail.url;
        resolve(detail);
      },
      { once: true }
    );
  });

  await openLegacyE2EGuide(page, 'Milestone');

  await expect(opened).resolves.toEqual({ url: 'bundled:e2e-test', title: 'Milestone' });
});

it('has no unique URL helper or docs-retrieval import in the runner', () => {
  const projectRoot = join(__dirname, '../../../..');
  const runnerSource = readFileSync(join(__dirname, 'run-guide.ts'), 'utf-8');

  expect(existsSync(join(projectRoot, 'src/lib/e2e-guide-url.ts'))).toBe(false);
  expect(runnerSource).not.toContain('src/docs-retrieval');
  expect(runnerSource).not.toContain('bundled:e2e-test/');
});
