import type { ElementHandle, Page } from '@playwright/test';

import { testIds } from '../../../../src/constants/testIds';
import { StorageEvents } from '../../../../src/lib/event-names';
import { dismissBadgeCelebrations } from './badge-celebrations';

export const E2E_GUIDE_URL = 'bundled:e2e-test';

const STEP_SELECTOR = '[data-testid^="interactive-step-"]';
const REPLACEMENT_TIMEOUT_MS = 15_000;

type StepHandle = ElementHandle<HTMLElement | SVGElement>;

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

async function currentStepHandles(page: Page): Promise<StepHandle[]> {
  return page.locator(STEP_SELECTOR).elementHandles();
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
    throw new Error('Prior E2E guide steps did not detach before replacement');
  } finally {
    await Promise.all(handles.map((step) => step.dispose()));
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

async function resetInteractiveProgress(page: Page): Promise<void> {
  const resetButton = page.getByRole('button', { name: 'Reset guide', exact: true });
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

export async function openLegacyE2EGuide(page: Page, title: string): Promise<void> {
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
  await page.waitForFunction(
    (url) => (window as Window & { __DocsPluginActiveTabUrl?: string }).__DocsPluginActiveTabUrl === url,
    E2E_GUIDE_URL,
    { timeout: REPLACEMENT_TIMEOUT_MS }
  );
}
export async function replacePreviousE2EGuide(page: Page, previousGuideHadInteractiveSteps: boolean): Promise<void> {
  const activeTab = await activeGuideTab(page);
  if (!activeTab.id || activeTab.url !== E2E_GUIDE_URL) {
    throw new Error('The previous E2E guide tab is not active');
  }

  await dismissBadgeCelebrations(page);
  const stepsBeforeReset = await currentStepHandles(page);
  const resetButton = page.getByRole('button', { name: 'Reset guide', exact: true });
  const resetControlCount = await resetButton.count();
  if (resetControlCount > 0) {
    try {
      await resetInteractiveProgress(page);
    } catch (error) {
      await Promise.all(stepsBeforeReset.map((step) => step.dispose()));
      throw error;
    }
  } else if (previousGuideHadInteractiveSteps) {
    await Promise.all(stepsBeforeReset.map((step) => step.dispose()));
    throw new Error('The interactive E2E guide has no Reset guide control');
  }

  const stepsBeforeClose = await currentStepHandles(page);
  const priorSteps = [...stepsBeforeReset, ...stepsBeforeClose];
  try {
    await page.getByTestId(testIds.docsPanel.tabCloseButton(activeTab.id)).click({
      timeout: REPLACEMENT_TIMEOUT_MS,
    });
  } catch (error) {
    await Promise.all(priorSteps.map((step) => step.dispose()));
    throw error;
  }
  await waitForStepHandlesToDetach(page, priorSteps);
  await page.waitForFunction(
    (url) => (window as Window & { __DocsPluginActiveTabUrl?: string }).__DocsPluginActiveTabUrl !== url,
    E2E_GUIDE_URL,
    { timeout: REPLACEMENT_TIMEOUT_MS }
  );
}
