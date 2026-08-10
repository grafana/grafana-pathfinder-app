import { renderHook, act } from '@testing-library/react';
import { Subject } from 'rxjs';
import { LiveChannelEventType, type LiveChannelEvent } from '@grafana/data';
import type { Terminal } from '@xterm/xterm';

import { useTerminalLive } from './useTerminalLive.hook';
import { logger } from '../../lib/logging';

jest.mock('../../lib/logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
}));

const mockPublish = jest.fn();
let liveEvents: Subject<LiveChannelEvent<unknown>>;

jest.mock('@grafana/runtime', () => ({
  getGrafanaLiveSrv: () => ({
    getStream: () => liveEvents.asObservable(),
    publish: (...args: unknown[]) => mockPublish(...args),
  }),
}));

const SSH_HANDSHAKE_TIMEOUT_MS = 35_000;

/** Production framing: JSON in the first value of a single-field DataFrame. */
function asDataFrame(frame: unknown) {
  return {
    schema: { fields: [{ name: 'data', type: 'string' }] },
    data: { values: [[JSON.stringify(frame)]] },
  };
}

function createTerminal() {
  return {
    rows: 24,
    cols: 80,
    write: jest.fn(),
    writeln: jest.fn(),
    clear: jest.fn(),
    onData: jest.fn(() => ({ dispose: jest.fn() })),
  };
}

type MockTerminal = ReturnType<typeof createTerminal>;

function writtenLines(terminal: MockTerminal): string {
  return terminal.writeln.mock.calls.map((call) => String(call[0])).join('\n');
}

function setup() {
  const terminal = createTerminal();
  const terminalRef = { current: terminal as unknown as Terminal };
  const hook = renderHook(() => useTerminalLive({ terminalRef }));

  act(() => {
    hook.result.current.connect();
  });

  return { terminal, hook };
}

function emitMessage(message: unknown) {
  act(() => {
    liveEvents.next({ type: LiveChannelEventType.Message, message });
  });
}

function emitFrame(frame: unknown) {
  emitMessage(asDataFrame(frame));
}

function advance(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockPublish.mockResolvedValue(undefined);
  liveEvents = new Subject<LiveChannelEvent<unknown>>();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useTerminalLive — handshake timer', () => {
  it('clears the timer when a valid connected frame arrives', () => {
    const { terminal, hook } = setup();

    emitFrame({ type: 'connected', vmId: 'vm-1' });
    advance(SSH_HANDSHAKE_TIMEOUT_MS + 5_000);

    expect(hook.result.current.status).toBe('connected');
    expect(writtenLines(terminal)).toContain('SSH connection established');
    expect(writtenLines(terminal)).not.toContain('timed out');
  });

  it('fires when the VM never connects', () => {
    const { terminal, hook } = setup();

    advance(SSH_HANDSHAKE_TIMEOUT_MS);

    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.error).toBe('SSH handshake timed out');
    expect(writtenLines(terminal)).toContain('SSH handshake timed out');
  });

  it('is re-armed by status frames so provisioning does not trip it', () => {
    const { terminal } = setup();

    advance(20_000);
    emitFrame({ type: 'status', state: 'ssh_connecting', message: 'Connecting over SSH...' });
    advance(20_000);

    expect(writtenLines(terminal)).not.toContain('timed out');

    advance(20_000);

    expect(writtenLines(terminal)).toContain('timed out');
  });
});

describe('useTerminalLive — protocol mismatch is diagnosable', () => {
  it('reports a renamed frame type, keeps the stream alive, and does not clear the timer', () => {
    const { terminal, hook } = setup();

    emitFrame({ type: 'sshConnected', vmId: 'vm-1' });

    expect(logger.warn).toHaveBeenCalledWith(
      '[Terminal] Rejected terminal frame from backend',
      expect.objectContaining({ detail: 'unknown message type "sshConnected"' })
    );
    expect(writtenLines(terminal)).toContain('may be out of sync');
    expect(writtenLines(terminal)).toContain('unknown message type "sshConnected"');
    expect(liveEvents.observed).toBe(true);
    expect(hook.result.current.status).toBe('connecting');

    // Stream survived: a following valid frame is still handled.
    emitFrame({ type: 'connected', vmId: 'vm-1' });
    expect(hook.result.current.status).toBe('connected');
  });

  it('surfaces a malformed frame instead of dropping it silently', () => {
    const { terminal, hook } = setup();

    emitFrame({ type: 'output', data: 42 });

    expect(writtenLines(terminal)).toContain('Unreadable message from the sandbox backend');
    expect(writtenLines(terminal)).toContain('expected string');
    expect(hook.result.current.status).toBe('connecting');
  });

  it('reports the mismatch once per session rather than on every frame', () => {
    const { terminal } = setup();

    emitFrame({ type: 'output', data: 1 });
    emitFrame({ type: 'output', data: 2 });
    emitFrame({ type: 'output', data: 3 });

    const reports = terminal.writeln.mock.calls.filter((call) => String(call[0]).includes('Unreadable message'));
    expect(reports).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('leaves a trace but no user-visible noise for messages that never claimed to be terminal frames', () => {
    const { terminal } = setup();

    emitMessage({ schema: { fields: [] } });
    emitMessage({ schema: { fields: [] } });

    expect(logger.warn).not.toHaveBeenCalled();
    expect(writtenLines(terminal)).not.toContain('Unreadable message');
    expect(logger.debug).toHaveBeenCalledTimes(1);
  });
});

describe('useTerminalLive — frame handling', () => {
  it('writes output frame data to the terminal', () => {
    const { terminal } = setup();

    emitFrame({ type: 'output', data: 'total 4\r\n' });

    expect(terminal.write).toHaveBeenCalledWith('total 4\r\n');
  });

  it('renders an unknown but well-formed VM state, proving the state field stays open', () => {
    const { terminal } = setup();

    emitFrame({ type: 'status', state: 'destroying', message: 'VM state: destroying' });

    expect(writtenLines(terminal)).toContain('VM state: destroying');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('falls back to the raw state when the backend sends no message', () => {
    const { terminal } = setup();

    emitFrame({ type: 'status', state: 'checking' });

    expect(writtenLines(terminal)).toContain('Status: checking');
  });

  it('surfaces an error frame and tears the session down', () => {
    const { terminal, hook } = setup();

    emitFrame({ type: 'error', error: 'Relay URL is not a trusted host' });

    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.error).toBe('Relay URL is not a trusted host');
    expect(writtenLines(terminal)).toContain('Relay URL is not a trusted host');
  });

  it('ignores heartbeats', () => {
    const { terminal } = setup();
    terminal.writeln.mockClear();

    emitFrame({ type: 'heartbeat' });

    expect(terminal.writeln).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('useTerminalLive — outbound messages', () => {
  it('publishes typed resize and input messages over the socket', async () => {
    const { hook } = setup();
    emitFrame({ type: 'connected', vmId: 'vm-1' });
    mockPublish.mockClear();

    act(() => {
      hook.result.current.resize(30, 100);
    });
    await act(async () => {
      await hook.result.current.sendCommand('ls -la');
    });

    expect(mockPublish).toHaveBeenCalledWith(expect.objectContaining({ scope: 'plugin' }), { type: 'resize', rows: 30, cols: 100 }, { useSocket: true }); // prettier-ignore
    expect(mockPublish).toHaveBeenCalledWith(expect.objectContaining({ scope: 'plugin' }), { type: 'input', data: 'ls -la\n' }, { useSocket: true }); // prettier-ignore
  });

  it('logs a publish failure once instead of swallowing it', async () => {
    const { hook } = setup();
    emitFrame({ type: 'connected', vmId: 'vm-1' });
    mockPublish.mockRejectedValue(new Error('socket closed'));

    await act(async () => {
      await hook.result.current.sendCommand('whoami');
      await hook.result.current.sendCommand('hostname');
    });

    const inputFailures = (logger.error as jest.Mock).mock.calls.filter(
      (call) => call[0] === '[Terminal] Failed to publish terminal input'
    );
    expect(inputFailures).toHaveLength(1);
  });
});
