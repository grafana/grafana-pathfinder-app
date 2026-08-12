/**
 * Exec is session-scoped in the extracted Coda plugin: `POST
 * /v1/sessions/{id}/exec` reuses the stream's SSH client and refuses a session
 * whose terminal is gone. Knowing when a session has died is therefore the
 * consumer's job, and a retained id can only buy a doomed request. These tests
 * pin that every stream-terminating path drops the id.
 */

import { act, renderHook } from '@testing-library/react';
import { Subject } from 'rxjs';
import { LiveChannelConnectionState, type LiveChannelEvent } from '@grafana/data';
import { getGrafanaLiveSrv } from '@grafana/runtime';
import type { Terminal } from '@xterm/xterm';

import { useTerminalLive } from './useTerminalLive.hook';
import { createSession } from './coda-api';

jest.mock('@grafana/runtime', () => ({
  getGrafanaLiveSrv: jest.fn(),
}));

jest.mock('./coda-api', () => ({
  ...jest.requireActual('./coda-api'),
  createSession: jest.fn(),
}));

jest.mock('../../lib/logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
}));

const mockedGetGrafanaLiveSrv = getGrafanaLiveSrv as jest.MockedFunction<typeof getGrafanaLiveSrv>;
const mockedCreateSession = createSession as jest.MockedFunction<typeof createSession>;

const SESSION_ID = 's_0123456789abcdef0123456789abcdef';

function fakeTerminal(): Terminal {
  return {
    clear: jest.fn(),
    write: jest.fn(),
    writeln: jest.fn(),
    onData: jest.fn(() => ({ dispose: jest.fn() })),
    rows: 24,
    cols: 80,
  } as unknown as Terminal;
}

/** One frame in the shape RunStream sends: a single JSON-encoded string field. */
function frame(event: Record<string, unknown>) {
  return {
    type: 'message',
    message: { data: { values: [[JSON.stringify(event)]] } },
  } as unknown as LiveChannelEvent<unknown>;
}

function statusEvent(state: LiveChannelConnectionState) {
  return { type: 'status', state } as unknown as LiveChannelEvent<unknown>;
}

async function connectedHook() {
  const stream = new Subject<LiveChannelEvent<unknown>>();
  mockedGetGrafanaLiveSrv.mockReturnValue({
    getStream: jest.fn(() => stream),
    publish: jest.fn(),
  } as unknown as ReturnType<typeof getGrafanaLiveSrv>);
  mockedCreateSession.mockResolvedValue({
    sessionId: SESSION_ID,
    channel: 'plugin/grafana-coda-app/v1/session/abc',
    state: 'pending',
    template: 'vm-aws',
  });

  const terminalRef = { current: fakeTerminal() };
  const hook = renderHook(() => useTerminalLive({ terminalRef }));

  await act(async () => {
    hook.result.current.connect();
  });
  expect(hook.result.current.sessionId).toBe(SESSION_ID);

  return { hook, stream };
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useTerminalLive session lifetime', () => {
  it('holds the session id while the stream is live', async () => {
    const { hook, stream } = await connectedHook();

    act(() => {
      stream.next(frame({ type: 'connected', vmId: 'vm-1' }));
    });

    expect(hook.result.current.status).toBe('connected');
    expect(hook.result.current.sessionId).toBe(SESSION_ID);
  });

  it('drops the session id on a backend error frame', async () => {
    const { hook, stream } = await connectedHook();

    act(() => {
      stream.next(frame({ type: 'error', error: 'vm gone' }));
    });

    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.sessionId).toBeNull();
  });

  it('drops the session id on a backend disconnected frame', async () => {
    const { hook, stream } = await connectedHook();

    act(() => {
      stream.next(frame({ type: 'connected' }));
      stream.next(frame({ type: 'disconnected' }));
    });

    expect(hook.result.current.status).toBe('disconnected');
    expect(hook.result.current.sessionId).toBeNull();
  });

  it('drops the session id when the Live channel drops', async () => {
    const { hook, stream } = await connectedHook();

    act(() => {
      stream.next(frame({ type: 'connected' }));
      stream.next(statusEvent(LiveChannelConnectionState.Disconnected));
    });

    expect(hook.result.current.sessionId).toBeNull();
  });

  it('drops the session id when the subscription errors', async () => {
    const { hook, stream } = await connectedHook();

    act(() => {
      stream.error(new Error('socket closed'));
    });

    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.sessionId).toBeNull();
  });

  it('drops the session id when the stream completes', async () => {
    const { hook, stream } = await connectedHook();

    act(() => {
      stream.next(frame({ type: 'connected' }));
      stream.complete();
    });

    expect(hook.result.current.sessionId).toBeNull();
  });

  it('drops the session id when the handshake safety net fires', async () => {
    jest.useFakeTimers();
    const { hook } = await connectedHook();

    act(() => {
      jest.advanceTimersByTime(36_000);
    });

    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.sessionId).toBeNull();
  });

  it('drops the session id on an explicit disconnect', async () => {
    const { hook, stream } = await connectedHook();

    act(() => {
      stream.next(frame({ type: 'connected' }));
    });
    act(() => {
      hook.result.current.disconnect();
    });

    expect(hook.result.current.sessionId).toBeNull();
  });
});
