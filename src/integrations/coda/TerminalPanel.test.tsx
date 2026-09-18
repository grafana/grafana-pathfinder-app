import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { TerminalPanel } from './TerminalPanel';
import { useTerminalLive } from './useTerminalLive.hook';
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
