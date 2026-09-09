import type { ElementHandle, Page } from '@playwright/test';

import { testIds } from '../../../../src/constants/testIds';
import { StorageEvents } from '../../../../src/lib/event-names';
import { StorageKeys } from '../../../../src/lib/storage-keys';
import { dismissBadgeCelebrations } from './badge-celebrations';
import { STEP_ROOT_SELECTOR } from './constants';
import { FatalTransitionError, type FatalTransitionKind } from './transition-error';

export const E2E_GUIDE_URL = 'bundled:e2e-test';
const REPLACEMENT_TIMEOUT_MS = 15_000;
const RESET_POSTCONDITION_ATTEMPTS = 5;
const RESET_POSTCONDITION_POLL_MS = 250;
const HYBRID_STORAGE_TIMESTAMP_SUFFIX = '__timestamp';
// Add a version only after this runner implements that version's control contract.
const SUPPORTED_PATHFINDER_E2E_CONTROL_VERSIONS: readonly number[] = [1];

type StepHandle = ElementHandle<HTMLElement | SVGElement>;
type WrappedTransitionKind = Exclude<FatalTransitionKind, 'badge-obstruction' | 'step-detach-failed'>;

interface E2EProgressStorageState {
  hasStoredCompletion: boolean;
  hasMatchingStorage: boolean;
}

async function activeGuideTab(page: Page): Promise<{ id: string; url: string }> {
  return page.evaluate(() => {
    const runtimeWindow = window as Window & {
      __DocsPluginActiveTabId?: unknown;
      __DocsPluginActiveTabUrl?: unknown;
    };
    return {
      id: typeof runtimeWindow.__DocsPluginActiveTabId === 'string' ? runtimeWindow.__DocsPluginActiveTabId : '',
      url: typeof runtimeWindow.__DocsPluginActiveTabUrl === 'string' ? runtimeWindow.__DocsPluginActiveTabUrl : '',
    };
  });
}

async function inspectE2EProgressStorage(page: Page): Promise<E2EProgressStorageState> {
  return page.evaluate(
    ({ contentKey, keys, timestampSuffix }) => {
      const stepsPrefix = `${keys.stepsPrefix}${contentKey}-`;
      const matchingPrefixes = [
        stepsPrefix,
        `${keys.collapsePrefix}${contentKey}-`,
        `${keys.acknowledgedPrefix}${contentKey}-`,
        `${keys.donePrefix}${contentKey}-`,
      ];
      let hasStoredCompletion = false;
      let hasMatchingStorage = false;

      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (!key || key.endsWith(timestampSuffix) || !matchingPrefixes.some((prefix) => key.startsWith(prefix))) {
          continue;
        }
        hasMatchingStorage = true;
        if (!key.startsWith(stepsPrefix)) {
          continue;
        }
        const value = localStorage.getItem(key);
        try {
          const completedIds = value ? JSON.parse(value) : [];
          if (Array.isArray(completedIds) && completedIds.length === 0) {
            continue;
          }
        } catch {
          // A malformed step value is ambiguous and requires the mounted reset path.
        }
        hasStoredCompletion = true;
      }

      const completionValue = localStorage.getItem(keys.completion);
      if (completionValue) {
        try {
          const completion = JSON.parse(completionValue);
          if (
            completion &&
            typeof completion === 'object' &&
            !Array.isArray(completion) &&
            Object.prototype.hasOwnProperty.call(completion, contentKey)
          ) {
            hasMatchingStorage = true;
          }
        } catch {
          hasMatchingStorage = true;
          hasStoredCompletion = true;
        }
      }

      return { hasStoredCompletion, hasMatchingStorage };
    },
    {
      contentKey: E2E_GUIDE_URL,
      keys: {
        stepsPrefix: StorageKeys.INTERACTIVE_STEPS_PREFIX,
        collapsePrefix: StorageKeys.SECTION_COLLAPSE_PREFIX,
        acknowledgedPrefix: StorageKeys.SECTION_ACKNOWLEDGED_PREFIX,
        donePrefix: StorageKeys.SECTION_DONE_PREFIX,
        completion: StorageKeys.INTERACTIVE_COMPLETION,
      },
      timestampSuffix: HYBRID_STORAGE_TIMESTAMP_SUFFIX,
    }
  );
}

async function requireStoredCompletionStaysAbsent(page: Page): Promise<void> {
  for (let attempt = 1; attempt <= RESET_POSTCONDITION_ATTEMPTS; attempt++) {
    const storage = await inspectE2EProgressStorage(page);
    if (storage.hasStoredCompletion) {
      throw new FatalTransitionError(
        'reset-ambiguous',
        'The previous E2E guide still has stored completion after acknowledged reset and tab close'
      );
    }
    if (attempt < RESET_POSTCONDITION_ATTEMPTS) {
      await page.waitForTimeout(RESET_POSTCONDITION_POLL_MS);
    }
  }
}

async function resetWithE2ECapability(page: Page): Promise<boolean> {
  const result = await page.evaluate(
    async ({ supportedVersions, timeoutMs }) => {
      const control = (
        window as Window & {
          __pathfinderE2E?: {
            version?: unknown;
            resetActiveGuide?: unknown;
          };
        }
      ).__pathfinderE2E;
      if (!control) {
        return { status: 'unavailable' } as const;
      }
      if (typeof control.version !== 'number' || !supportedVersions.includes(control.version)) {
        return { status: 'unsupported', version: String(control.version) } as const;
      }
      if (typeof control.resetActiveGuide !== 'function') {
        return { status: 'rejected', message: 'resetActiveGuide is not callable' } as const;
      }
      let timeout: number | undefined;
      try {
        return await Promise.race([
          (async () => {
            try {
              await control.resetActiveGuide();
              return { status: 'reset' } as const;
            } catch (error) {
              return {
                status: 'rejected',
                message: error instanceof Error ? error.message : String(error),
              } as const;
            }
          })(),
          new Promise<{ status: 'timed_out' }>((resolve) => {
            timeout = window.setTimeout(() => resolve({ status: 'timed_out' }), timeoutMs);
          }),
        ]);
      } finally {
        if (timeout !== undefined) {
          window.clearTimeout(timeout);
        }
      }
    },
    {
      supportedVersions: SUPPORTED_PATHFINDER_E2E_CONTROL_VERSIONS,
      timeoutMs: REPLACEMENT_TIMEOUT_MS,
    }
  );

  if (result.status === 'unavailable') {
    return false;
  }
  if (result.status === 'unsupported') {
    throw new FatalTransitionError(
      'reset-ambiguous',
      `The Pathfinder E2E reset control has unsupported version ${result.version}`
    );
  }
  if (result.status === 'rejected') {
    throw new FatalTransitionError(
      'reset-ambiguous',
      `The Pathfinder E2E reset control rejected reset: ${result.message}`
    );
  }
  if (result.status === 'timed_out') {
    throw new FatalTransitionError(
      'reset-ambiguous',
      `The Pathfinder E2E reset control did not complete within ${REPLACEMENT_TIMEOUT_MS}ms`
    );
  }
  return true;
}

async function requireEmptyE2EProgressStorage(page: Page): Promise<void> {
  const storage = await inspectE2EProgressStorage(page);
  if (storage.hasMatchingStorage) {
    throw new FatalTransitionError(
      'reset-ambiguous',
      'The previous E2E guide still has matching progress storage after reset'
    );
  }
}

async function clearNoCompletionResidue(page: Page): Promise<void> {
  await page.evaluate(
    ({ contentKey, keys }) => {
      const prefixes = [keys.stepsPrefix, keys.collapsePrefix, keys.acknowledgedPrefix, keys.donePrefix].map(
        (prefix) => `${prefix}${contentKey}-`
      );
      const keysToRemove: string[] = [];
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (key && prefixes.some((prefix) => key.startsWith(prefix))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));

      const completionValue = localStorage.getItem(keys.completion);
      if (completionValue) {
        try {
          const completion = JSON.parse(completionValue);
          if (completion && typeof completion === 'object' && !Array.isArray(completion)) {
            delete completion[contentKey];
            localStorage.setItem(keys.completion, JSON.stringify(completion));
          }
        } catch {
          localStorage.removeItem(keys.completion);
        }
      }
    },
    {
      contentKey: E2E_GUIDE_URL,
      keys: {
        stepsPrefix: StorageKeys.INTERACTIVE_STEPS_PREFIX,
        collapsePrefix: StorageKeys.SECTION_COLLAPSE_PREFIX,
        acknowledgedPrefix: StorageKeys.SECTION_ACKNOWLEDGED_PREFIX,
        donePrefix: StorageKeys.SECTION_DONE_PREFIX,
        completion: StorageKeys.INTERACTIVE_COMPLETION,
      },
    }
  );
}

async function activateE2EGuideTab(page: Page, tabId: string): Promise<void> {
  const tab = page.getByTestId(testIds.docsPanel.tab(tabId));
  const overflow = page.getByTestId(testIds.docsPanel.tabOverflowButton);
  if ((await tab.count()) === 0) {
    await Promise.race([
      page.waitForFunction(
        ({ expectedId, expectedUrl }) => {
          const runtimeWindow = window as Window & {
            __DocsPluginActiveTabId?: string;
            __DocsPluginActiveTabUrl?: string;
          };
          return (
            runtimeWindow.__DocsPluginActiveTabId === expectedId &&
            runtimeWindow.__DocsPluginActiveTabUrl === expectedUrl
          );
        },
        { expectedId: tabId, expectedUrl: E2E_GUIDE_URL },
        { timeout: REPLACEMENT_TIMEOUT_MS }
      ),
      tab.waitFor({ state: 'visible', timeout: REPLACEMENT_TIMEOUT_MS }),
      overflow.waitFor({ state: 'visible', timeout: REPLACEMENT_TIMEOUT_MS }),
    ]);
    const restoredActive = await activeGuideTab(page);
    if (restoredActive.id === tabId && restoredActive.url === E2E_GUIDE_URL) {
      return;
    }
  }
  if ((await tab.count()) > 0) {
    await tab.click({ timeout: REPLACEMENT_TIMEOUT_MS });
  } else {
    if ((await overflow.count()) === 0) {
      throw new Error('The previous E2E guide tab is not available');
    }
    await overflow.click({ timeout: REPLACEMENT_TIMEOUT_MS });
    await page.getByTestId(testIds.docsPanel.tabDropdownItem(tabId)).click({ timeout: REPLACEMENT_TIMEOUT_MS });
  }
  await page.waitForFunction(
    ({ expectedId, expectedUrl }) => {
      const runtimeWindow = window as Window & {
        __DocsPluginActiveTabId?: string;
        __DocsPluginActiveTabUrl?: string;
      };
      return (
        runtimeWindow.__DocsPluginActiveTabId === expectedId && runtimeWindow.__DocsPluginActiveTabUrl === expectedUrl
      );
    },
    { expectedId: tabId, expectedUrl: E2E_GUIDE_URL },
    { timeout: REPLACEMENT_TIMEOUT_MS }
  );
}

async function currentStepHandles(page: Page): Promise<StepHandle[]> {
  return page.locator(STEP_ROOT_SELECTOR).elementHandles();
}
function transitionFailure(kind: WrappedTransitionKind, message: string, error: unknown): FatalTransitionError {
  if (error instanceof FatalTransitionError) {
    return new FatalTransitionError(error.kind, `${message}: ${error.message}`);
  }
  const reason = error instanceof Error ? error.message : String(error);
  return new FatalTransitionError(kind, `${message}: ${reason}`);
}

async function disposeStepHandles(handles: StepHandle[]): Promise<void> {
  await Promise.all(handles.map((step) => step.dispose().catch(() => undefined)));
}

export async function waitForStepHandlesToDetach(page: Page, handles: StepHandle[]): Promise<void> {
  const deadline = Date.now() + REPLACEMENT_TIMEOUT_MS;
  try {
    while (Date.now() < deadline) {
      const connected = await Promise.all(
        handles.map((step) => step.evaluate((element) => element.isConnected).catch(() => false))
      );
      if (connected.every((value) => !value)) {
        return;
      }
      await page.waitForTimeout(50);
    }
    throw new FatalTransitionError('step-detach-failed', 'Prior E2E guide steps did not detach before replacement');
  } finally {
    await Promise.all(handles.map((step) => step.dispose().catch(() => undefined)));
  }
}

async function armProgressResetProbe(page: Page): Promise<void> {
  await page.evaluate(
    ({ eventName }) => {
      const runtimeWindow = window as Window & {
        __pathfinderE2EResetProbe?: { contentKey: string; listener: EventListener };
      };
      const listener: EventListener = (event) => {
        const customEvent = event as CustomEvent<{ contentKey?: unknown }>;
        const contentKey = customEvent.detail?.contentKey;
        if (typeof contentKey === 'string' && runtimeWindow.__pathfinderE2EResetProbe) {
          runtimeWindow.__pathfinderE2EResetProbe.contentKey = contentKey;
        }
      };
      runtimeWindow.__pathfinderE2EResetProbe = { contentKey: '', listener };
      window.addEventListener(eventName, listener);
    },
    { eventName: StorageEvents.InteractiveProgressCleared }
  );
}

async function clearProgressResetProbe(page: Page): Promise<void> {
  await page
    .evaluate(
      ({ eventName }) => {
        const runtimeWindow = window as Window & {
          __pathfinderE2EResetProbe?: { contentKey: string; listener: EventListener };
        };
        const probe = runtimeWindow.__pathfinderE2EResetProbe;
        if (probe) {
          window.removeEventListener(eventName, probe.listener);
          delete runtimeWindow.__pathfinderE2EResetProbe;
        }
      },
      { eventName: StorageEvents.InteractiveProgressCleared }
    )
    .catch(() => undefined);
}

function legacyResetGuideControl(page: Page) {
  return page
    .getByTestId(testIds.docsPanel.resetGuideButton)
    .or(page.getByRole('button', { name: 'Reset guide', exact: true }))
    .first();
}

async function resetInteractiveProgress(page: Page): Promise<void> {
  const resetButton = legacyResetGuideControl(page);
  await armProgressResetProbe(page);
  try {
    await resetButton.click({ timeout: REPLACEMENT_TIMEOUT_MS });
    await page.waitForFunction(
      (contentKey) =>
        (window as Window & { __pathfinderE2EResetProbe?: { contentKey: string } }).__pathfinderE2EResetProbe
          ?.contentKey === contentKey,
      E2E_GUIDE_URL,
      { timeout: REPLACEMENT_TIMEOUT_MS }
    );
  } finally {
    await clearProgressResetProbe(page);
  }
}

export async function openLegacyE2EGuide(page: Page, title: string): Promise<string> {
  await page.evaluate(
    ({ guideTitle, url }) => {
      document.dispatchEvent(
        new CustomEvent('pathfinder-auto-open-docs', {
          detail: { url, title: guideTitle },
        })
      );
    },
    { guideTitle: title, url: E2E_GUIDE_URL }
  );
  try {
    await page.waitForFunction(
      (url) => (window as Window & { __DocsPluginActiveTabUrl?: string }).__DocsPluginActiveTabUrl === url,
      E2E_GUIDE_URL,
      { timeout: REPLACEMENT_TIMEOUT_MS }
    );
  } catch (error) {
    const activeTab = await activeGuideTab(page);
    if (activeTab.id && activeTab.url === E2E_GUIDE_URL) {
      return activeTab.id;
    }
    if (activeTab.url === E2E_GUIDE_URL) {
      throw transitionFailure('guide-load-ambiguous', 'The new E2E guide tab has no usable identity', error);
    }
    throw error;
  }
  const activeTab = await activeGuideTab(page);
  if (!activeTab.id && activeTab.url === E2E_GUIDE_URL) {
    throw new FatalTransitionError('guide-load-ambiguous', 'The opened E2E guide tab did not publish its identity');
  }
  if (!activeTab.id || activeTab.url !== E2E_GUIDE_URL) {
    throw new Error(
      `The active tab changed before the E2E guide identity was confirmed: ${activeTab.url || 'no active URL'}`
    );
  }
  return activeTab.id;
}

export async function replacePreviousE2EGuide(page: Page, previousGuideTabId?: string): Promise<void> {
  let storage: E2EProgressStorageState;
  let activeTab: { id: string; url: string };
  try {
    storage = await inspectE2EProgressStorage(page);
    activeTab = await activeGuideTab(page);
  } catch (error) {
    throw transitionFailure('reset-ambiguous', 'The runner could not inspect previous E2E guide state', error);
  }
  const targetTabId = previousGuideTabId ?? (activeTab.url === E2E_GUIDE_URL ? activeTab.id : '');
  if (!targetTabId) {
    try {
      await clearNoCompletionResidue(page);
      await requireEmptyE2EProgressStorage(page);
    } catch (error) {
      throw transitionFailure('reset-ambiguous', 'The runner could not clear previous E2E guide residue', error);
    }
    return;
  }
  if (activeTab.id !== targetTabId || activeTab.url !== E2E_GUIDE_URL) {
    try {
      await activateE2EGuideTab(page, targetTabId);
      activeTab = await activeGuideTab(page);
    } catch (error) {
      throw transitionFailure('reset-ambiguous', 'The previous E2E guide tab could not be activated', error);
    }
  }
  if (activeTab.id !== targetTabId || activeTab.url !== E2E_GUIDE_URL) {
    throw new FatalTransitionError('reset-ambiguous', 'The previous E2E guide tab did not become active');
  }

  await dismissBadgeCelebrations(page);
  let stepsBeforeReset: StepHandle[] = [];
  let usedE2ECapability = false;
  try {
    usedE2ECapability = await resetWithE2ECapability(page);
    if (usedE2ECapability) {
      await requireEmptyE2EProgressStorage(page);
    }
  } catch (error) {
    throw transitionFailure('reset-ambiguous', 'The plugin-owned E2E reset failed', error);
  }

  if (!usedE2ECapability && storage.hasStoredCompletion) {
    const resetButton = legacyResetGuideControl(page);
    try {
      await resetButton.waitFor({ state: 'visible', timeout: REPLACEMENT_TIMEOUT_MS });
      stepsBeforeReset = await currentStepHandles(page);
      await resetInteractiveProgress(page);
    } catch (error) {
      await disposeStepHandles(stepsBeforeReset);
      throw transitionFailure(
        'reset-ambiguous',
        'The previous E2E guide has stored completion but the legacy Reset guide path failed',
        error
      );
    }
  } else if (!usedE2ECapability) {
    try {
      await clearNoCompletionResidue(page);
      await requireEmptyE2EProgressStorage(page);
    } catch (error) {
      throw transitionFailure('reset-ambiguous', 'The runner could not clear previous E2E guide residue', error);
    }
  }

  let stepsBeforeClose: StepHandle[];
  try {
    stepsBeforeClose = await currentStepHandles(page);
  } catch (error) {
    await disposeStepHandles(stepsBeforeReset);
    throw transitionFailure('reset-ambiguous', 'The runner could not inspect previous E2E guide steps', error);
  }
  const priorSteps = [...stepsBeforeReset, ...stepsBeforeClose];
  try {
    await page.getByTestId(testIds.docsPanel.tabCloseButton(activeTab.id)).click({
      timeout: REPLACEMENT_TIMEOUT_MS,
    });
    await waitForStepHandlesToDetach(page, priorSteps);
    await page.waitForFunction(
      (url) => (window as Window & { __DocsPluginActiveTabUrl?: string }).__DocsPluginActiveTabUrl !== url,
      E2E_GUIDE_URL,
      { timeout: REPLACEMENT_TIMEOUT_MS }
    );
  } catch (error) {
    await disposeStepHandles(priorSteps);
    throw transitionFailure('tab-close-failed', 'The previous E2E guide tab did not close cleanly', error);
  }
  if (storage.hasStoredCompletion) {
    try {
      await requireStoredCompletionStaysAbsent(page);
      await clearNoCompletionResidue(page);
      const postCleanupStorage = await inspectE2EProgressStorage(page);
      if (postCleanupStorage.hasStoredCompletion) {
        throw new FatalTransitionError(
          'reset-ambiguous',
          'The previous E2E guide recreated stored completion during post-reset cleanup'
        );
      }
    } catch (error) {
      throw transitionFailure(
        'reset-ambiguous',
        'The previous E2E guide reset did not reach a safe post-close state',
        error
      );
    }
  }
}
