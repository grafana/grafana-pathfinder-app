import type { Locator, Page } from '@playwright/test';

import { ensureDocsPanelOpen, isPathfinderDockedValue } from './bootstrap';

interface HarnessOptions {
  panelVisible?: boolean | boolean[];
  bootstrapStates?: Array<{ rawDockedValue: string | null; sidebarMounted: boolean }>;
  dockedValue?: string | null;
  helpExpanded?: boolean;
  helpMenuVisible?: boolean;
  panelWaitResults?: Array<'resolve' | Error>;
  openConfirmationResults?: Array<'resolve' | Error>;
  evaluateInBrowser?: boolean;
  executeOpenSignalPredicate?: boolean;
  onHelpClick?: () => void;
}

function createHarness(options: HarnessOptions = {}) {
  const panelWaitFor = jest.fn();
  for (const result of options.panelWaitResults ?? ['resolve']) {
    if (result === 'resolve') {
      panelWaitFor.mockResolvedValueOnce(undefined);
    } else {
      panelWaitFor.mockRejectedValueOnce(result);
    }
  }

  const panelVisibleResults = Array.isArray(options.panelVisible)
    ? [...options.panelVisible]
    : [options.panelVisible ?? false];
  const panelVisibleFallback = panelVisibleResults[panelVisibleResults.length - 1] ?? false;
  const panelIsVisible = jest.fn().mockImplementation(() => {
    return Promise.resolve(panelVisibleResults.shift() ?? panelVisibleFallback);
  });
  const panel = {
    isVisible: panelIsVisible,
    waitFor: panelWaitFor,
  } as unknown as Locator;
  const helpButton = {
    click: jest.fn().mockImplementation(async () => options.onHelpClick?.()),
    getAttribute: jest.fn().mockResolvedValue(options.helpExpanded ? 'true' : 'false'),
  } as unknown as Locator;
  const helpMenu = {
    count: jest.fn().mockResolvedValue(options.helpMenuVisible ? 1 : 0),
  } as unknown as Locator;

  const confirmationResults = [...(options.openConfirmationResults ?? ['resolve'])];
  const waitForFunction = jest.fn().mockImplementation((fn, arg) => {
    if (!arg || typeof arg !== 'object' || !('panelTestId' in arg)) {
      return Promise.resolve(undefined);
    }
    if (options.executeOpenSignalPredicate) {
      return fn(arg) ? Promise.resolve(undefined) : Promise.reject(new Error('Open signal not observed'));
    }
    const result = confirmationResults.shift() ?? 'resolve';
    return result === 'resolve' ? Promise.resolve(undefined) : Promise.reject(result);
  });
  const bootstrapStates = options.bootstrapStates
    ? [...options.bootstrapStates]
    : [
        {
          rawDockedValue: options.dockedValue ?? null,
          sidebarMounted: false,
        },
      ];
  const bootstrapStateFallback = bootstrapStates[bootstrapStates.length - 1] ?? {
    rawDockedValue: null,
    sidebarMounted: false,
  };
  const evaluate = jest.fn().mockImplementation((fn, arg) => {
    if (options.evaluateInBrowser) {
      return Promise.resolve(fn(arg));
    }
    return Promise.resolve(bootstrapStates.shift() ?? bootstrapStateFallback);
  });

  const page = {
    getByTestId: jest.fn().mockReturnValue(panel),
    locator: jest.fn().mockReturnValue(helpButton),
    getByRole: jest.fn().mockReturnValue(helpMenu),
    evaluate,
    waitForFunction,
    keyboard: {
      press: jest.fn().mockResolvedValue(undefined),
    },
  } as unknown as Page;

  return {
    page,
    panel,
    helpButton,
    panelIsVisible,
    panelWaitFor,
    evaluate,
    waitForFunction,
    pressKey: page.keyboard.press as jest.Mock,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
  delete (window as Window & { __pathfinderE2ESidebarMounted?: boolean }).__pathfinderE2ESidebarMounted;
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('isPathfinderDockedValue', () => {
  it.each([
    'grafana-pathfinder-app',
    'Interactive learning',
    JSON.stringify({ pluginId: 'grafana-pathfinder-app', componentTitle: 'Interactive learning' }),
    JSON.stringify(JSON.stringify({ pluginId: 'grafana-pathfinder-app', componentTitle: 'Interactive learning' })),
  ])('recognizes Pathfinder dock ownership from %s', (rawValue) => {
    expect(isPathfinderDockedValue(rawValue)).toBe(true);
  });

  it('rejects a docked sidebar owned by another plugin', () => {
    expect(isPathfinderDockedValue(JSON.stringify({ pluginId: 'grafana-assistant-app' }))).toBe(false);
  });

  it.each([null, '{"invalid', JSON.stringify(JSON.stringify(JSON.stringify({ pluginId: 'grafana-pathfinder-app' })))])(
    'rejects malformed or over-encoded dock values from %s',
    (rawValue) => {
      expect(isPathfinderDockedValue(rawValue)).toBe(false);
    }
  );
});

describe('ensureDocsPanelOpen', () => {
  it('returns without clicking when the panel is already visible', async () => {
    const { page, panel, helpButton, panelWaitFor } = createHarness({ panelVisible: true });

    await expect(ensureDocsPanelOpen(page)).resolves.toBe(panel);

    expect(helpButton.click).not.toHaveBeenCalled();
    expect(panelWaitFor).not.toHaveBeenCalled();
  });

  it('waits without clicking when Pathfinder is already docked', async () => {
    const { page, panel, helpButton, panelWaitFor } = createHarness({
      dockedValue: JSON.stringify({
        pluginId: 'grafana-pathfinder-app',
        componentTitle: 'Interactive learning',
      }),
    });

    await expect(ensureDocsPanelOpen(page)).resolves.toBe(panel);

    expect(helpButton.click).not.toHaveBeenCalled();
    expect(panelWaitFor).toHaveBeenCalledTimes(1);
  });

  it('waits without clicking when the direct Help toggle is already expanded', async () => {
    const { page, panel, helpButton, panelWaitFor } = createHarness({ helpExpanded: true });

    await expect(ensureDocsPanelOpen(page)).resolves.toBe(panel);

    expect(helpButton.click).not.toHaveBeenCalled();
    expect(panelWaitFor).toHaveBeenCalledTimes(1);
  });

  it('does not treat an expanded generic Help menu as an open Pathfinder panel', async () => {
    const { page, helpButton, panelWaitFor } = createHarness({
      helpExpanded: true,
      helpMenuVisible: true,
    });

    await ensureDocsPanelOpen(page);

    expect(helpButton.click).toHaveBeenCalledTimes(1);
    expect(panelWaitFor).toHaveBeenCalledTimes(1);
  });

  it('returns when the panel becomes visible while waiting for plugin readiness', async () => {
    const { page, panel, helpButton, panelWaitFor, waitForFunction } = createHarness({
      panelVisible: [false, true],
    });

    await expect(ensureDocsPanelOpen(page)).resolves.toBe(panel);

    expect(waitForFunction).toHaveBeenCalledTimes(1);
    expect(helpButton.click).not.toHaveBeenCalled();
    expect(panelWaitFor).not.toHaveBeenCalled();
  });

  it('detects the sidebar mount event fired by the Help action', async () => {
    const { page, helpButton, panelWaitFor } = createHarness({
      evaluateInBrowser: true,
      executeOpenSignalPredicate: true,
      onHelpClick: () => window.dispatchEvent(new Event('pathfinder-sidebar-mounted')),
    });

    await ensureDocsPanelOpen(page);

    expect(helpButton.click).toHaveBeenCalledTimes(1);
    expect(panelWaitFor).toHaveBeenCalledTimes(1);
    expect((window as Window & { __pathfinderE2ESidebarMounted?: boolean }).__pathfinderE2ESidebarMounted).toBe(true);
  });

  it('recognizes dock ownership that appears after an unconfirmed Help click', async () => {
    const pathfinderDocked = JSON.stringify({
      pluginId: 'grafana-pathfinder-app',
      componentTitle: 'Interactive learning',
    });
    const { page, helpButton, panelWaitFor } = createHarness({
      bootstrapStates: [
        { rawDockedValue: null, sidebarMounted: false },
        { rawDockedValue: null, sidebarMounted: false },
        { rawDockedValue: pathfinderDocked, sidebarMounted: false },
      ],
      openConfirmationResults: [new Error('Mount event delayed')],
    });

    await ensureDocsPanelOpen(page);

    expect(helpButton.click).toHaveBeenCalledTimes(1);
    expect(panelWaitFor).toHaveBeenCalledTimes(1);
  });

  it('dismisses the generic Help menu and retries the open action once', async () => {
    const { page, helpButton, panelWaitFor, pressKey } = createHarness({
      helpMenuVisible: true,
      openConfirmationResults: [new Error('Pathfinder did not open'), 'resolve'],
    });

    await ensureDocsPanelOpen(page);

    expect(helpButton.click).toHaveBeenCalledTimes(2);
    expect(pressKey).toHaveBeenCalledWith('Escape');
    expect(panelWaitFor).toHaveBeenCalledTimes(1);
  });

  it('propagates the second confirmation error after exactly two Help clicks', async () => {
    const secondError = new Error('Second confirmation failed');
    const { page, helpButton, panelWaitFor } = createHarness({
      helpMenuVisible: true,
      openConfirmationResults: [new Error('First confirmation failed'), secondError],
    });

    await expect(ensureDocsPanelOpen(page)).rejects.toBe(secondError);

    expect(helpButton.click).toHaveBeenCalledTimes(2);
    expect(panelWaitFor).not.toHaveBeenCalled();
  });

  it('accepts panel DOM presence as the only open signal', async () => {
    const { page, helpButton, panelWaitFor } = createHarness({
      evaluateInBrowser: true,
      executeOpenSignalPredicate: true,
      onHelpClick: () => {
        const panel = document.createElement('div');
        panel.dataset.testid = 'docs-panel-container';
        document.body.appendChild(panel);
      },
    });

    await ensureDocsPanelOpen(page);

    expect(helpButton.click).toHaveBeenCalledTimes(1);
    expect(panelWaitFor).toHaveBeenCalledTimes(1);
    expect((window as Window & { __pathfinderE2ESidebarMounted?: boolean }).__pathfinderE2ESidebarMounted).toBe(false);
  });

  it('runs one setup-only recovery callback after an initial bootstrap failure', async () => {
    const beforeRetry = jest.fn().mockResolvedValue(undefined);
    const { page, helpButton, panelWaitFor } = createHarness({
      panelWaitResults: [new Error('first bootstrap failed'), 'resolve'],
      openConfirmationResults: ['resolve', 'resolve'],
    });

    await ensureDocsPanelOpen(page, { beforeRetry });

    expect(beforeRetry).toHaveBeenCalledTimes(1);
    expect(helpButton.click).toHaveBeenCalledTimes(2);
    expect(panelWaitFor).toHaveBeenCalledTimes(2);
  });

  it('propagates the second bootstrap failure without another retry', async () => {
    const beforeRetry = jest.fn().mockResolvedValue(undefined);
    const secondFailure = new Error('second bootstrap failed');
    const { page, helpButton } = createHarness({
      panelWaitResults: [new Error('first bootstrap failed'), secondFailure],
      openConfirmationResults: ['resolve', 'resolve'],
    });

    await expect(ensureDocsPanelOpen(page, { beforeRetry })).rejects.toBe(secondFailure);

    expect(beforeRetry).toHaveBeenCalledTimes(1);
    expect(helpButton.click).toHaveBeenCalledTimes(2);
  });

  it('propagates a custom timeout to every wait in one bootstrap attempt', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000);
    const { page, helpButton, panelWaitFor, waitForFunction } = createHarness();

    await ensureDocsPanelOpen(page, { timeoutMs: 250 });

    const waitTimeouts = waitForFunction.mock.calls.map((call) => call[2]?.timeout);
    expect(waitTimeouts).toEqual([250, 250]);
    expect(helpButton.getAttribute).toHaveBeenCalledWith('aria-expanded', { timeout: 250 });
    expect(helpButton.click).toHaveBeenCalledWith({ timeout: 250 });
    expect(panelWaitFor).toHaveBeenCalledWith({ state: 'visible', timeout: 250 });
  });

  it('clamps expired deadline waits to one millisecond', async () => {
    jest.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValue(1_200);
    const { page, helpButton, panelWaitFor, waitForFunction } = createHarness();

    await ensureDocsPanelOpen(page, { timeoutMs: 100 });

    const waitTimeouts = waitForFunction.mock.calls.map((call) => call[2]?.timeout);
    expect(waitTimeouts).toEqual([1, 1]);
    expect(helpButton.getAttribute).toHaveBeenCalledWith('aria-expanded', { timeout: 1 });
    expect(helpButton.click).toHaveBeenCalledWith({ timeout: 1 });
    expect(panelWaitFor).toHaveBeenCalledWith({ state: 'visible', timeout: 1 });
  });

  it('surfaces a timeout failure when no setup retry is configured', async () => {
    const timeoutError = new Error('Panel wait timed out');
    const { page } = createHarness({
      panelWaitResults: [timeoutError],
    });

    await expect(ensureDocsPanelOpen(page, { timeoutMs: 100 })).rejects.toBe(timeoutError);
  });
});
