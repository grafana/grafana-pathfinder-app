import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { TerminalPanel } from './TerminalPanel';
import { useTerminalLive } from './useTerminalLive.hook';
import { lifetimeClient, type LifetimeVM } from './coda-api';
import { testIds } from '../../constants/testIds';

jest.mock('./useTerminalLive.hook', () => ({ useTerminalLive: jest.fn() }));
jest.mock('./TerminalContext', () => ({ useTerminalContext: () => null }));
jest.mock('./useGcxCredential.hook', () => ({ useGcxCredential: () => ({}) }));
jest.mock('./GcxSetupPanel', () => ({ GcxReadyLine: () => null, GcxSetupPanel: () => null }));
jest.mock('./WorkspaceLink', () => ({ WorkspaceLink: () => null }));
jest.mock('@xterm/xterm', () => ({
  Terminal: jest.fn(() => ({
    loadAddon: jest.fn(),
    open: jest.fn(),
    write: jest.fn(),
    writeln: jest.fn(),
    dispose: jest.fn(),
    parser: { registerOscHandler: jest.fn() },
  })),
}));
jest.mock('@xterm/addon-fit', () => ({ FitAddon: jest.fn(() => ({ fit: jest.fn(), proposeDimensions: jest.fn() })) }));
jest.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: jest.fn() }));
jest.mock('@xterm/addon-serialize', () => ({ SerializeAddon: jest.fn(() => ({ serialize: () => '' })) }));
jest.mock('@xterm/addon-search', () => ({
  SearchAddon: jest.fn(() => ({ findNext: jest.fn(), findPrevious: jest.fn() })),
}));
jest.mock('@xterm/addon-webgl', () => ({
  WebglAddon: jest.fn(() => ({ onContextLoss: jest.fn(), dispose: jest.fn() })),
}));

const observers: Array<{ callback: ResizeObserverCallback; disconnect: jest.Mock }> = [];
const originalResizeObserver = global.ResizeObserver;
beforeAll(() => {
  global.ResizeObserver = jest.fn((callback: ResizeObserverCallback) => {
    const observer = { callback, observe: jest.fn(), unobserve: jest.fn(), disconnect: jest.fn() };
    observers.push(observer);
    return observer;
  }) as unknown as typeof ResizeObserver;
});
afterAll(() => {
  global.ResizeObserver = originalResizeObserver;
});

const live = jest.mocked(useTerminalLive);
const disconnect = jest.fn();
beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  live.mockReturnValue({
    status: 'connected',
    connect: jest.fn(),
    disconnect,
    resize: jest.fn(),
    sendCommand: jest.fn(),
    error: null,
    sessionId: 'session',
    vmId: 'vm',
    vmExpiresAt: null,
    unreachableVmId: null,
  } as ReturnType<typeof useTerminalLive>);
});

function openPanel(onClose = jest.fn()) {
  render(<TerminalPanel onClose={onClose} />);
  fireEvent.click(screen.getByTestId(testIds.codaTerminal.expandButton));
  return onClose;
}

it('invokes disconnect once from the real terminal actions menu', async () => {
  openPanel();
  fireEvent.click(screen.getByRole('button', { name: 'Terminal actions' }));
  fireEvent.click(await screen.findByTestId(testIds.codaTerminal.disconnectButton));
  expect(disconnect).toHaveBeenCalledTimes(1);
});

it('invokes close once from the real terminal actions menu', async () => {
  const onClose = openPanel();
  fireEvent.click(screen.getByRole('button', { name: 'Terminal actions' }));
  fireEvent.click(await screen.findByTestId(testIds.codaTerminal.closeButton));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(disconnect).not.toHaveBeenCalled();
});

it.each(['disconnected', 'connecting'] as const)('hides disconnect while %s and retains close', async (status) => {
  live.mockReturnValue({ ...live({ terminalRef: { current: null } }), status } as ReturnType<typeof useTerminalLive>);
  openPanel();
  fireEvent.click(screen.getByRole('button', { name: 'Terminal actions' }));
  expect(await screen.findByTestId(testIds.codaTerminal.closeButton)).toBeVisible();
  expect(screen.queryByTestId(testIds.codaTerminal.disconnectButton)).not.toBeInTheDocument();
  expect(
    screen.getByTestId(status === 'connecting' ? testIds.codaTerminal.cancelButton : testIds.codaTerminal.connectButton)
  ).toBeVisible();
});

it('focuses the search input when the toolbar search action opens it', () => {
  openPanel();
  fireEvent.click(screen.getByTestId(testIds.codaTerminal.searchToggle));
  expect(screen.getByTestId(testIds.codaTerminal.searchInput)).toHaveFocus();
});

it('keeps the collapsed lifetime mounted through an extension and a lost-response retry', async () => {
  const expiry = new Date(Date.now() + 5 * 60000).toISOString();
  const vm = {
    id: 'vm',
    expiresAt: expiry,
    lifetime: {
      canExtend: true,
      extensionsRemaining: 3,
      eligibleAt: new Date(Date.now() - 1000).toISOString(),
      unavailableReason: null,
    },
  } as LifetimeVM;
  live.mockReturnValue({ ...live({ terminalRef: { current: null } }), vmExpiresAt: expiry });
  jest.spyOn(lifetimeClient, 'getVM').mockResolvedValue(vm);
  let reject!: (reason: Error) => void;
  const extend = jest
    .spyOn(lifetimeClient, 'extendVM')
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        })
    )
    .mockResolvedValue(vm);
  try {
    render(<TerminalPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Extend by 30 minutes' }));
    expect(screen.getByTestId(testIds.codaTerminal.panel)).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'Extending…' })).toBeDisabled();
    await act(async () => reject(new Error('Lost response')));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry extension' }));
    expect(extend).toHaveBeenCalledTimes(2);
    expect(extend.mock.calls[1]).toEqual(extend.mock.calls[0]);
    expect(screen.getByTestId(testIds.codaTerminal.panel)).not.toBeVisible();
  } finally {
    jest.restoreAllMocks();
  }
});

describe('terminal geometry', () => {
  let width = 640;
  let height = 320;
  let dimensions = { rows: 20, cols: 80 };

  beforeEach(() => {
    jest.useFakeTimers();
    width = 640;
    height = 320;
    dimensions = { rows: 20, cols: 80 };
    jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
    jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height);
    jest.mocked(FitAddon).mockImplementation(
      () =>
        ({
          proposeDimensions: jest.fn(() => dimensions),
          fit: jest.fn(() => {
            const terminal = jest.mocked(Terminal).mock.results.at(-1)!.value;
            terminal.rows = dimensions.rows;
            terminal.cols = dimensions.cols;
          }),
        }) as unknown as FitAddon
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function flush() {
    act(() => jest.advanceTimersByTime(20));
  }

  function notifyResize() {
    act(() => observers.at(-1)!.callback([], {} as ResizeObserver));
  }

  it('fits width-only growth and shrinkage and coalesces drag events without replacing the terminal', () => {
    openPanel();
    flush();
    const resize = live.mock.results.at(-1)!.value.resize;
    expect(resize).toHaveBeenLastCalledWith(20, 80);
    const terminal = jest.mocked(Terminal).mock.results.at(-1)!.value;
    resize.mockClear();
    width = 960;
    dimensions = { rows: 20, cols: 120 };
    notifyResize();
    notifyResize();
    flush();
    expect(resize).toHaveBeenCalledTimes(1);
    expect(resize).toHaveBeenLastCalledWith(20, 120);
    width = 400;
    dimensions = { rows: 20, cols: 50 };
    notifyResize();
    flush();
    expect(resize).toHaveBeenLastCalledWith(20, 50);
    expect(Terminal).toHaveBeenCalledTimes(1);
    expect(terminal.dispose).not.toHaveBeenCalled();
  });

  it('skips hidden and invalid geometry and refits after collapse and expansion', () => {
    openPanel();
    flush();
    const resize = live.mock.results.at(-1)!.value.resize;
    resize.mockClear();
    width = 0;
    notifyResize();
    flush();
    width = 640;
    dimensions = { rows: NaN, cols: 80 };
    notifyResize();
    flush();
    expect(resize).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId(testIds.codaTerminal.collapseButton));
    expect(observers.at(-1)!.disconnect).toHaveBeenCalled();
    dimensions = { rows: 25, cols: 100 };
    fireEvent.click(screen.getByTestId(testIds.codaTerminal.expandButton));
    flush();
    expect(resize).toHaveBeenLastCalledWith(25, 100);
  });

  it('fits on connection and reconnection and cancels pending work on unmount', () => {
    const current = live.mock.results.at(-1)?.value ?? live({ terminalRef: { current: null } });
    live.mockReturnValue({ ...current, status: 'connecting' });
    const view = render(<TerminalPanel />);
    fireEvent.click(screen.getByTestId(testIds.codaTerminal.expandButton));
    flush();
    expect(current.resize).not.toHaveBeenCalled();
    live.mockReturnValue({ ...current, status: 'connected' });
    view.rerender(<TerminalPanel />);
    flush();
    expect(current.resize).toHaveBeenLastCalledWith(20, 80);
    live.mockReturnValue({ ...current, status: 'connecting' });
    view.rerender(<TerminalPanel />);
    dimensions = { rows: 25, cols: 100 };
    live.mockReturnValue({ ...current, status: 'connected' });
    view.rerender(<TerminalPanel />);
    flush();
    expect(current.resize).toHaveBeenLastCalledWith(25, 100);
    current.resize.mockClear();
    notifyResize();
    const observer = observers.at(-1)!;
    view.unmount();
    flush();
    expect(observer.disconnect).toHaveBeenCalled();
    expect(current.resize).not.toHaveBeenCalled();
  });
});
