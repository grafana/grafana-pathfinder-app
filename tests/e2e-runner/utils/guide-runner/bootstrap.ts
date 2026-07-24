import type { Locator, Page } from '@playwright/test';

import { testIds } from '../../../../src/constants/testIds';
import { EXTENSION_SIDEBAR_DOCKED_KEY } from '../../../../src/lib/storage/extension-sidebar';
import pluginJson from '../../../../src/plugin.json';

const PATHFINDER_COMPONENT_TITLE = 'Interactive learning';
const DEFAULT_PANEL_OPEN_TIMEOUT_MS = 10_000;
const OPEN_CONFIRMATION_TIMEOUT_MS = 2_000;

interface PanelBootstrapOptions {
  beforeRetry?: () => Promise<void>;
  timeoutMs?: number;
}

interface BootstrapState {
  pathfinderDocked: boolean;
  sidebarMounted: boolean;
}

function parseDockedValue(value: unknown, remainingDepth = 2): unknown {
  if (typeof value !== 'string' || remainingDepth === 0) {
    return value;
  }
  try {
    return parseDockedValue(JSON.parse(value), remainingDepth - 1);
  } catch {
    return value;
  }
}

export function isPathfinderDockedValue(rawValue: string | null): boolean {
  const value = parseDockedValue(rawValue);
  if (typeof value === 'string') {
    return value === pluginJson.id || value === PATHFINDER_COMPONENT_TITLE;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const docked = value as { pluginId?: unknown; componentTitle?: unknown };
  return docked.pluginId === pluginJson.id || docked.componentTitle === PATHFINDER_COMPONENT_TITLE;
}

function remainingTimeout(deadline: number): number {
  return Math.max(1, deadline - Date.now());
}

async function readBootstrapState(page: Page, armMountListener: boolean): Promise<BootstrapState> {
  const state = await page.evaluate(
    ({ storageKey, armListener }) => {
      const runtimeWindow = window as Window & { __pathfinderE2ESidebarMounted?: boolean };
      if (armListener && runtimeWindow.__pathfinderE2ESidebarMounted === undefined) {
        runtimeWindow.__pathfinderE2ESidebarMounted = false;
        window.addEventListener(
          'pathfinder-sidebar-mounted',
          () => {
            runtimeWindow.__pathfinderE2ESidebarMounted = true;
          },
          { once: true }
        );
      }
      let rawDockedValue: string | null = null;
      try {
        rawDockedValue = localStorage.getItem(storageKey);
      } catch {
        rawDockedValue = null;
      }
      return {
        rawDockedValue,
        sidebarMounted: runtimeWindow.__pathfinderE2ESidebarMounted === true,
      };
    },
    { storageKey: EXTENSION_SIDEBAR_DOCKED_KEY, armListener: armMountListener }
  );
  return {
    pathfinderDocked: isPathfinderDockedValue(state.rawDockedValue),
    sidebarMounted: state.sidebarMounted,
  };
}

function hasOpenSignal(state: BootstrapState): boolean {
  return state.pathfinderDocked || state.sidebarMounted;
}

async function waitForOpenSignal(page: Page, timeout: number): Promise<void> {
  await page.waitForFunction(
    ({ panelTestId }) => {
      const runtimeWindow = window as Window & { __pathfinderE2ESidebarMounted?: boolean };
      return (
        runtimeWindow.__pathfinderE2ESidebarMounted === true ||
        document.querySelector(`[data-testid="${panelTestId}"]`) !== null
      );
    },
    { panelTestId: testIds.docsPanel.container },
    { timeout }
  );
}

async function isGenericHelpMenuVisible(page: Page): Promise<boolean> {
  const menu = page.getByRole('menu').last();
  return menu.isVisible().catch(() => false);
}

async function dismissGenericHelpMenu(page: Page): Promise<void> {
  if (await isGenericHelpMenuVisible(page)) {
    await page.keyboard.press('Escape');
  }
}
async function isExpandedPathfinderToggle(page: Page, helpButton: Locator): Promise<boolean> {
  return (await helpButton.getAttribute('aria-expanded')) === 'true' && !(await isGenericHelpMenuVisible(page));
}

async function openDocsPanelAttempt(page: Page, timeoutMs: number): Promise<Locator> {
  const deadline = Date.now() + timeoutMs;
  const panel = page.getByTestId(testIds.docsPanel.container);
  if (await panel.isVisible()) {
    return panel;
  }

  let state = await readBootstrapState(page, true);
  if (hasOpenSignal(state)) {
    await panel.waitFor({ state: 'visible', timeout: remainingTimeout(deadline) });
    return panel;
  }

  await page.waitForFunction(
    () => Boolean((window as Window & { __pathfinderPluginConfig?: unknown }).__pathfinderPluginConfig),
    undefined,
    { timeout: remainingTimeout(deadline) }
  );

  const helpButton = page.locator('button[aria-label="Help"]');
  for (let openAttempt = 0; openAttempt < 2; openAttempt++) {
    if (await panel.isVisible()) {
      return panel;
    }
    state = await readBootstrapState(page, false);
    if (hasOpenSignal(state)) {
      break;
    }
    if (await isExpandedPathfinderToggle(page, helpButton)) {
      break;
    }

    await helpButton.click();
    try {
      await waitForOpenSignal(page, Math.min(OPEN_CONFIRMATION_TIMEOUT_MS, remainingTimeout(deadline)));
      break;
    } catch (error) {
      state = await readBootstrapState(page, false);
      if (hasOpenSignal(state)) {
        break;
      }
      if (openAttempt === 1) {
        throw error;
      }
      await dismissGenericHelpMenu(page);
    }
  }

  await panel.waitFor({ state: 'visible', timeout: remainingTimeout(deadline) });
  return panel;
}

export async function ensureDocsPanelOpen(
  page: Page,
  { beforeRetry, timeoutMs = DEFAULT_PANEL_OPEN_TIMEOUT_MS }: PanelBootstrapOptions = {}
): Promise<Locator> {
  try {
    return await openDocsPanelAttempt(page, timeoutMs);
  } catch (error) {
    if (!beforeRetry) {
      throw error;
    }
    await beforeRetry();
    return openDocsPanelAttempt(page, timeoutMs);
  }
}
