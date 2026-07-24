import type { Locator, Page } from '@playwright/test';

import { ensureDocsPanelOpen, isPathfinderDockedValue } from './bootstrap';

interface HarnessOptions {
  panelVisible?: boolean;
  dockedValue?: string | null;
  helpExpanded?: boolean;
  helpMenuVisible?: boolean;
  panelWaitResults?: Array<'resolve' | Error>;
  openConfirmationResults?: Array<'resolve' | Error>;
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

  const panel = {
    isVisible: jest.fn().mockResolvedValue(options.panelVisible ?? false),
    waitFor: panelWaitFor,
  } as unknown as Locator;
  const helpButton = {
    click: jest.fn().mockResolvedValue(undefined),
    getAttribute: jest.fn().mockResolvedValue(options.helpExpanded ? 'true' : 'false'),
  } as unknown as Locator;
  const helpMenu = {
    last: jest.fn().mockReturnThis(),
    isVisible: jest.fn().mockResolvedValue(options.helpMenuVisible ?? false),
  } as unknown as Locator;

  const confirmationResults = [...(options.openConfirmationResults ?? ['resolve'])];
  const waitForFunction = jest.fn().mockImplementation((_fn, arg) => {
    if (!arg || typeof arg !== 'object' || !('panelTestId' in arg)) {
      return Promise.resolve(undefined);
    }
    const result = confirmationResults.shift() ?? 'resolve';
    return result === 'resolve' ? Promise.resolve(undefined) : Promise.reject(result);
  });

  const page = {
    getByTestId: jest.fn().mockReturnValue(panel),
    locator: jest.fn().mockReturnValue(helpButton),
    getByRole: jest.fn().mockReturnValue(helpMenu),
    evaluate: jest.fn().mockResolvedValue({
      rawDockedValue: options.dockedValue ?? null,
      sidebarMounted: false,
    }),
    waitForFunction,
    keyboard: {
      press: jest.fn().mockResolvedValue(undefined),
    },
  } as unknown as Page;

  return {
    page,
    panel,
    helpButton,
    panelWaitFor,
    waitForFunction,
    pressKey: page.keyboard.press as jest.Mock,
  };
}

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
});
