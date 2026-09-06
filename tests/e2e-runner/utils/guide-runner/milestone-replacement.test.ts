import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { ElementHandle, Page } from '@playwright/test';
import { testIds } from '../../../../src/constants/testIds';
import { StorageKeys } from '../../../../src/lib/storage-keys';

import { dismissBadgeCelebrations } from './badge-celebrations';
import { E2E_GUIDE_URL, openLegacyE2EGuide, replacePreviousE2EGuide } from './milestone-replacement';
import { FatalTransitionError } from './transition-error';

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

const E2E_STORAGE_KEYS = {
  steps: `${StorageKeys.INTERACTIVE_STEPS_PREFIX}${E2E_GUIDE_URL}-section-1`,
  collapse: `${StorageKeys.SECTION_COLLAPSE_PREFIX}${E2E_GUIDE_URL}-section-1`,
  acknowledged: `${StorageKeys.SECTION_ACKNOWLEDGED_PREFIX}${E2E_GUIDE_URL}-section-1`,
  done: `${StorageKeys.SECTION_DONE_PREFIX}${E2E_GUIDE_URL}-section-1`,
};

function clearMatchingE2EStorage(): void {
  Object.values(E2E_STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
  const completion = JSON.parse(localStorage.getItem(StorageKeys.INTERACTIVE_COMPLETION) ?? '{}') as Record<
    string,
    number
  >;
  delete completion[E2E_GUIDE_URL];
  localStorage.setItem(StorageKeys.INTERACTIVE_COMPLETION, JSON.stringify(completion));
}

function seedStoredCompletion(): void {
  localStorage.setItem(E2E_STORAGE_KEYS.steps, JSON.stringify(['step-1']));
  localStorage.setItem(StorageKeys.INTERACTIVE_COMPLETION, JSON.stringify({ [E2E_GUIDE_URL]: 100, other: 50 }));
}

function seedNoCompletionResidue(): void {
  localStorage.setItem(E2E_STORAGE_KEYS.steps, JSON.stringify([]));
  localStorage.setItem(E2E_STORAGE_KEYS.collapse, 'true');
  localStorage.setItem(E2E_STORAGE_KEYS.acknowledged, 'true');
  localStorage.setItem(E2E_STORAGE_KEYS.done, 'true');
  localStorage.setItem(StorageKeys.INTERACTIVE_COMPLETION, JSON.stringify({ [E2E_GUIDE_URL]: 0, other: 50 }));
}

function expectMatchingStorageEmpty(): void {
  expect(Object.values(E2E_STORAGE_KEYS).every((key) => localStorage.getItem(key) === null)).toBe(true);
  expect(JSON.parse(localStorage.getItem(StorageKeys.INTERACTIVE_COMPLETION) ?? '{}')).toEqual({ other: 50 });
}

interface ReplacementHarnessOptions {
  resetControlCount: number;
  resetControlCountBeforeWait?: number;
  resetSteps?: FakeStepHandle[];
  closeSteps?: FakeStepHandle[];
  resetClearsStorage?: boolean;
  resetRecreatesResidue?: boolean;
  closeError?: Error;
  closeDetachesSteps?: boolean;
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
      if (options.resetClearsStorage !== false) {
        clearMatchingE2EStorage();
      }
      window.dispatchEvent(
        new CustomEvent('interactive-progress-cleared', {
          detail: { contentKey: E2E_GUIDE_URL },
        })
      );
      if (options.resetRecreatesResidue) {
        seedNoCompletionResidue();
      }
    }),
  };
  const closeButton = {
    click: jest.fn().mockImplementation(async () => {
      if (options.closeError) {
        throw options.closeError;
      }
      operations.push('close');
      if (options.closeDetachesSteps !== false) {
        [...resetSteps, ...closeSteps].forEach((step) => {
          step.connected = false;
        });
      }
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
  jest.restoreAllMocks();
  localStorage.clear();
  delete (window as Window & { __DocsPluginActiveTabId?: string }).__DocsPluginActiveTabId;
  delete (window as Window & { __DocsPluginActiveTabUrl?: string }).__DocsPluginActiveTabUrl;
});

it('waits for reset synchronization before closing and detaches both step generations', async () => {
  seedStoredCompletion();
  const resetStep = stepHandle();
  const closeStep = stepHandle();
  const harness = replacementHarness({
    resetControlCount: 1,
    resetSteps: [resetStep],
    closeSteps: [closeStep],
  });

  await replacePreviousE2EGuide(harness.page);

  expect(harness.operations).toEqual(['reset', 'close']);
  expectMatchingStorageEmpty();
  expect(resetStep.dispose).toHaveBeenCalledTimes(1);
  expect(closeStep.dispose).toHaveBeenCalledTimes(1);
  expect(harness.page.reload).not.toHaveBeenCalled();
  expect(dismissBadgeCelebrations).toHaveBeenCalledWith(harness.page);
});

it('waits for an interactive restored tab to render its Reset guide control', async () => {
  seedStoredCompletion();
  const harness = replacementHarness({
    resetControlCount: 1,
    resetControlCountBeforeWait: 0,
  });

  await replacePreviousE2EGuide(harness.page, 'tab-1');

  expect(harness.resetButton.waitFor).toHaveBeenCalledWith({ state: 'visible', timeout: 15_000 });
  expect(harness.operations).toEqual(['reset', 'close']);
});

it('clears no-completion residue and closes without requiring Reset guide', async () => {
  seedNoCompletionResidue();
  const harness = replacementHarness({ resetControlCount: 0, closeSteps: [] });
  await replacePreviousE2EGuide(harness.page);

  expect(harness.resetButton.waitFor).not.toHaveBeenCalled();
  expect(harness.resetButton.click).not.toHaveBeenCalled();
  expect(harness.closeButton.click).toHaveBeenCalledTimes(1);
  expectMatchingStorageEmpty();
});

it('fails fatally when stored completion has no Reset guide control', async () => {
  seedStoredCompletion();
  const harness = replacementHarness({ resetControlCount: 0 });
  const replacement = replacePreviousE2EGuide(harness.page);

  await expect(replacement).rejects.toBeInstanceOf(FatalTransitionError);
  await expect(replacement).rejects.toMatchObject({ kind: 'reset-ambiguous' });

  expect(harness.closeButton.click).not.toHaveBeenCalled();
  expect(localStorage.getItem(E2E_STORAGE_KEYS.steps)).not.toBeNull();
});

it('fails fatally when legacy reset leaves stored completion after tab close', async () => {
  seedStoredCompletion();
  const harness = replacementHarness({ resetControlCount: 1, resetClearsStorage: false });
  const replacement = replacePreviousE2EGuide(harness.page);

  await expect(replacement).rejects.toBeInstanceOf(FatalTransitionError);
  await expect(replacement).rejects.toMatchObject({ kind: 'reset-ambiguous' });

  expect(harness.operations).toEqual(['reset', 'close']);
  expect(harness.closeButton.click).toHaveBeenCalledTimes(1);
  expect(harness.page.waitForTimeout).not.toHaveBeenCalled();
});

it('accepts and clears safe residue recreated after reset acknowledgment', async () => {
  seedStoredCompletion();
  const harness = replacementHarness({ resetControlCount: 1, resetRecreatesResidue: true });

  await replacePreviousE2EGuide(harness.page);

  expect(harness.operations).toEqual(['reset', 'close']);
  expect(harness.page.waitForTimeout).toHaveBeenCalledTimes(19);
  expectMatchingStorageEmpty();
});

it('ignores and preserves a hybrid-storage timestamp companion after legacy reset', async () => {
  seedStoredCompletion();
  const timestampKey = `${E2E_STORAGE_KEYS.steps}__timestamp`;
  localStorage.setItem(timestampKey, '1757060000000');
  const harness = replacementHarness({ resetControlCount: 1 });

  await replacePreviousE2EGuide(harness.page);

  expect(harness.operations).toEqual(['reset', 'close']);
  expectMatchingStorageEmpty();
  expect(localStorage.getItem(timestampKey)).toBe('1757060000000');
});

it('preserves malformed shared completion data and requires the reset path', async () => {
  const malformedCompletion = '{"other-guide":50';
  const unrelatedStepKey = `${StorageKeys.INTERACTIVE_STEPS_PREFIX}bundled:other-guide-section-1`;
  localStorage.setItem(StorageKeys.INTERACTIVE_COMPLETION, malformedCompletion);
  localStorage.setItem(unrelatedStepKey, JSON.stringify(['other-step']));
  const harness = replacementHarness({ resetControlCount: 0 });

  await expect(replacePreviousE2EGuide(harness.page)).rejects.toMatchObject({
    name: 'FatalTransitionError',
    kind: 'reset-ambiguous',
  });

  expect(harness.resetButton.waitFor).toHaveBeenCalledTimes(1);
  expect(harness.resetButton.click).not.toHaveBeenCalled();
  expect(localStorage.getItem(StorageKeys.INTERACTIVE_COMPLETION)).toBe(malformedCompletion);
  expect(localStorage.getItem(unrelatedStepKey)).toBe(JSON.stringify(['other-step']));
  expect(harness.closeButton.click).not.toHaveBeenCalled();
});

it('opens a later guide when the prior milestone failed before tab activation', async () => {
  seedNoCompletionResidue();
  const harness = replacementHarness({ resetControlCount: 0 });
  delete (window as Window & { __DocsPluginActiveTabId?: string }).__DocsPluginActiveTabId;
  delete (window as Window & { __DocsPluginActiveTabUrl?: string }).__DocsPluginActiveTabUrl;
  const opened = waitForOpenedGuide();
  await replacePreviousE2EGuide(harness.page);
  await openLegacyE2EGuide(harness.page, 'Later milestone');

  await expect(opened).resolves.toEqual({ url: E2E_GUIDE_URL, title: 'Later milestone' });
  expectMatchingStorageEmpty();
  expect(harness.operations).toEqual([]);
  expect(dismissBadgeCelebrations).not.toHaveBeenCalled();
});

it('clears stored completion when the prior milestone failed before tab activation', async () => {
  seedStoredCompletion();
  const harness = replacementHarness({ resetControlCount: 0 });
  delete (window as Window & { __DocsPluginActiveTabId?: string }).__DocsPluginActiveTabId;
  delete (window as Window & { __DocsPluginActiveTabUrl?: string }).__DocsPluginActiveTabUrl;
  await replacePreviousE2EGuide(harness.page);

  expectMatchingStorageEmpty();
  expect(harness.operations).toEqual([]);
  expect(dismissBadgeCelebrations).not.toHaveBeenCalled();
});

it('repairs malformed shared completion when no prior tab opened', async () => {
  const malformedCompletion = '{"other-guide":50';
  const unrelatedStepKey = `${StorageKeys.INTERACTIVE_STEPS_PREFIX}bundled:other-guide-section-1`;
  localStorage.setItem(StorageKeys.INTERACTIVE_COMPLETION, malformedCompletion);
  localStorage.setItem(unrelatedStepKey, JSON.stringify(['other-step']));
  const harness = replacementHarness({ resetControlCount: 0 });
  delete (window as Window & { __DocsPluginActiveTabId?: string }).__DocsPluginActiveTabId;
  delete (window as Window & { __DocsPluginActiveTabUrl?: string }).__DocsPluginActiveTabUrl;

  await replacePreviousE2EGuide(harness.page);

  expect(localStorage.getItem(StorageKeys.INTERACTIVE_COMPLETION)).toBeNull();
  expect(localStorage.getItem(unrelatedStepKey)).toBe(JSON.stringify(['other-step']));
  expect(harness.operations).toEqual([]);
  expect(dismissBadgeCelebrations).not.toHaveBeenCalled();
});

it('reactivates and resets a prior E2E guide after browser globals reset', async () => {
  seedStoredCompletion();
  const harness = replacementHarness({ resetControlCount: 1 });
  delete (window as Window & { __DocsPluginActiveTabId?: string }).__DocsPluginActiveTabId;
  delete (window as Window & { __DocsPluginActiveTabUrl?: string }).__DocsPluginActiveTabUrl;

  await replacePreviousE2EGuide(harness.page, 'tab-1');

  expect(harness.operations).toEqual(['activate', 'reset', 'close']);
  expect(harness.tabButton.click).toHaveBeenCalledTimes(1);
});

it('fails fatally when the previous tab cannot close', async () => {
  const harness = replacementHarness({
    resetControlCount: 0,
    closeError: new Error('Close button was detached'),
  });

  await expect(replacePreviousE2EGuide(harness.page)).rejects.toMatchObject({
    name: 'FatalTransitionError',
    kind: 'tab-close-failed',
  });
});

it('fails fatally when previous guide steps remain attached', async () => {
  let now = 0;
  jest.spyOn(Date, 'now').mockImplementation(() => {
    now += 16_000;
    return now;
  });
  const harness = replacementHarness({
    resetControlCount: 0,
    closeSteps: [stepHandle()],
    closeDetachesSteps: false,
  });

  await expect(replacePreviousE2EGuide(harness.page)).rejects.toMatchObject({
    name: 'FatalTransitionError',
    kind: 'step-detach-failed',
  });
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

it('recovers a known E2E tab identity at the open wait boundary', async () => {
  const page = {
    evaluate: jest.fn().mockImplementation((callback, argument) => Promise.resolve(callback(argument))),
    waitForFunction: jest.fn().mockRejectedValue(new Error('Open wait timed out')),
  } as unknown as Page;
  const opened = waitForOpenedGuide();

  await expect(openLegacyE2EGuide(page, 'Milestone')).resolves.toBe('opened-tab');

  await expect(opened).resolves.toEqual({ url: E2E_GUIDE_URL, title: 'Milestone' });
});

it('has no unique URL helper or docs-retrieval import in the runner', () => {
  const projectRoot = join(__dirname, '../../../..');
  const runnerSource = readFileSync(join(__dirname, 'run-guide.ts'), 'utf-8');

  expect(existsSync(join(projectRoot, 'src/lib/e2e-guide-url.ts'))).toBe(false);
  expect(runnerSource).not.toContain('src/docs-retrieval');
  expect(runnerSource).not.toContain('bundled:e2e-test/');
});
