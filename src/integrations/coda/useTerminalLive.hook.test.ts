/** Exercise the real SDK recovery coordinator with controlled transport sessions. */

import { act, renderHook } from '@testing-library/react';
import type { Terminal } from '@xterm/xterm';
import { CodaError, type CodaSession, type SessionHandlers } from '@grafana/coda-client';

import { useTerminalLive } from './useTerminalLive.hook';
import { createSession, listVMs } from './coda-api';

jest.mock('./coda-api', () => ({
  ...jest.requireActual('./coda-api'),
  createSession: jest.fn(),
  listVMs: jest.fn(),
}));

jest.mock('../../lib/logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
}));

const mockedCreateSession = createSession as jest.MockedFunction<typeof createSession>;
const mockedListVMs = listVMs as jest.MockedFunction<typeof listVMs>;
const mockedLogger = jest.requireMock('../../lib/logging').logger as {
  error: jest.Mock;
  warn: jest.Mock;
};

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

interface FakeSession {
  session: CodaSession;
  /** Populated once the hook calls `subscribe()`. */
  handlers: { current: SessionHandlers };
  close: jest.Mock;
}

/**
 * A test double for `CodaSession`. `subscribe()` captures the handlers into
 * `handlers.current` so a test can invoke them directly to simulate backend
 * behaviour, and `close()` mirrors the real class by firing `onClosed`
 * synchronously (as `CodaSession.finish()` does) before "resolving" the
 * destroy call. `handlers` is returned separately, not as a property on the
 * session object — `CodaSession` itself has a private field of that name,
 * and a same-named public property on a type intersected with it collapses
 * to `never`.
 */
function fakeSession(sessionId = SESSION_ID, vmID?: string): FakeSession {
  const handlers: { current: SessionHandlers } = { current: {} };
  let closed = false;
  const finish = () => {
    if (!closed) {
      closed = true;
      handlers.current.onClosed?.();
    }
  };
  const close = jest.fn(async () => finish());
  const session = {
    sessionId,
    vmID,
    subscribe: jest.fn((h: SessionHandlers) => {
      handlers.current = {
        ...h,
        onError: (error) => {
          h.onError?.(error);
          finish();
        },
      };
    }),
    write: jest.fn(),
    resize: jest.fn(),
    exec: jest.fn(),
    close,
  } as unknown as CodaSession;

  return { session, handlers, close };
}

async function connectedHook(fake: FakeSession = fakeSession()) {
  mockedCreateSession.mockResolvedValue(fake.session);

  const terminalRef = { current: fakeTerminal() };
  const hook = renderHook(() => useTerminalLive({ terminalRef }));

  await act(async () => {
    hook.result.current.connect();
  });
  expect(hook.result.current.sessionId).toBeNull();

  return { hook, terminalRef, ...fake };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedListVMs.mockResolvedValue([]);
});

describe('useTerminalLive session lifetime', () => {
  const activeVm = {
    id: 'vm-1',
    template: 'vm-aws',
    state: 'active' as const,
    owner: 'user-1',
    expiresAt: '2026-09-14T12:00:00Z',
    createdAt: '2026-09-14T11:30:00Z',
  };

  it('does not query VM expiry before the Live session connects', async () => {
    await connectedHook(fakeSession(SESSION_ID, 'vm-1'));

    expect(mockedListVMs).not.toHaveBeenCalled();
  });

  it('refreshes the server-reported VM expiry while connected', async () => {
    jest.useFakeTimers();
    try {
      mockedListVMs.mockResolvedValue([activeVm]);
      const fake = fakeSession();
      const { hook, handlers } = await connectedHook(fake);

      await act(async () => {
        handlers.current.onConnected?.('vm-1');
        await Promise.resolve();
      });

      expect(mockedListVMs).toHaveBeenCalledTimes(1);
      expect(hook.result.current.vmExpiresAt).toBe(activeVm.expiresAt);
      expect(hook.result.current.lifetimeVM).toEqual(activeVm);

      act(() => {
        jest.advanceTimersByTime(60_000);
      });
      expect(mockedListVMs).toHaveBeenCalledTimes(5);
    } finally {
      jest.useRealTimers();
    }
  });

  it('leaves the connected session usable when the expiry lookup fails', async () => {
    mockedListVMs.mockRejectedValue(new Error('temporary failure'));
    const fake = fakeSession();
    const { hook, handlers } = await connectedHook(fake);

    await act(async () => {
      handlers.current.onConnected?.('vm-1');
      await Promise.resolve();
    });

    expect(mockedListVMs).toHaveBeenCalledTimes(1);
    expect(hook.result.current.status).toBe('connected');
    expect(hook.result.current.vmExpiresAt).toBeNull();
  });

  it('keeps the VM identity when a later status frame omits vmId', async () => {
    mockedListVMs.mockResolvedValue([activeVm]);
    const fake = fakeSession();
    const { hook, handlers } = await connectedHook(fake);

    await act(async () => {
      handlers.current.onConnected?.('vm-1');
      await Promise.resolve();
    });
    act(() => {
      handlers.current.onStatus?.({ state: 'active', message: 'Still ready' });
    });

    expect(hook.result.current.vmExpiresAt).toBe(activeVm.expiresAt);
  });

  it('retains expiry from status frames that establish or replace the VM identity', async () => {
    const { hook, handlers } = await connectedHook();
    const firstFrame = { state: 'active', vmId: 'first-vm', expiresAt: activeVm.expiresAt };
    act(() => handlers.current.onStatus?.(firstFrame));
    expect(hook.result.current.vmExpiresAt).toBe(activeVm.expiresAt);
    const nextExpiry = '2026-09-14T13:00:00Z';
    const secondFrame = { state: 'active', vmId: 'second-vm', expiresAt: nextExpiry };
    act(() => handlers.current.onStatus?.(secondFrame));
    expect(hook.result.current.vmExpiresAt).toBe(nextExpiry);
    act(() => handlers.current.onStatus?.({ state: 'active', vmId: 'third-vm' }));
    expect(hook.result.current.vmExpiresAt).toBeNull();
  });

  it('holds the session id once connected', async () => {
    const { hook, handlers } = await connectedHook();

    act(() => {
      handlers.current.onConnected?.('vm-1');
    });

    expect(hook.result.current.status).toBe('connected');
    expect(hook.result.current.sessionId).toBe(SESSION_ID);
  });

  it('drops the session id on a backend error', async () => {
    const { hook, handlers } = await connectedHook();

    act(() => {
      handlers.current.onError?.(new CodaError('vm gone', 'vm_expired', 0));
    });

    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.sessionId).toBeNull();
    expect(hook.result.current.vmExpiresAt).toBeNull();
  });

  it('drops the session id when the session closes without an error', async () => {
    const { hook, handlers } = await connectedHook();

    act(() => {
      handlers.current.onConnected?.();
      handlers.current.onClosed?.();
    });

    expect(hook.result.current.status).toBe('disconnected');
    expect(hook.result.current.sessionId).toBeNull();
    expect(hook.result.current.vmExpiresAt).toBeNull();
  });

  it('names an exhausted quota from the error code instead of the generic message', async () => {
    const { hook, handlers } = await connectedHook();

    act(() => {
      handlers.current.onError?.(new CodaError('Failed to create VM, please try again', 'vm_quota_exceeded', 0));
    });

    expect(hook.result.current.error).toMatch(/maximum number of sandbox VMs/i);
  });

  it('drops the session id on an explicit disconnect', async () => {
    const { hook, handlers, close } = await connectedHook();

    act(() => {
      handlers.current.onConnected?.();
    });
    act(() => {
      hook.result.current.disconnect();
    });

    expect(hook.result.current.sessionId).toBeNull();
    expect(hook.result.current.vmExpiresAt).toBeNull();
    expect(close).toHaveBeenCalled();
  });

  it('surfaces a protocol mismatch without terminating the live session', async () => {
    const { hook, terminalRef, handlers, close } = await connectedHook();

    act(() => {
      handlers.current.onConnected?.('vm-1');
    });

    act(() => {
      handlers.current.onProtocolError?.({
        detail: 'event payload failed validation',
        sessionId: SESSION_ID,
        vmId: 'vm-1',
      });
    });

    expect(hook.result.current.status).toBe('connected');
    expect(hook.result.current.error).toBe(
      'Unreadable message from the sandbox backend — the plugin and backend may be out of sync.'
    );
    expect(hook.result.current.sessionId).toBe(SESSION_ID);
    expect(close).not.toHaveBeenCalled();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      '[Terminal] Coda protocol mismatch',
      expect.objectContaining({
        detail: 'event payload failed validation',
        sessionId: SESSION_ID,
        vmId: 'vm-1',
        category: 'protocol_error',
      })
    );
    expect(mockedLogger.warn).not.toHaveBeenCalled();

    const writeln = terminalRef.current.writeln as jest.Mock;
    expect(writeln).toHaveBeenCalledWith('\r\n');
    expect(writeln).toHaveBeenCalledWith(
      '\x1b[31m✖ Error: Unreadable message from the sandbox backend — the plugin and backend may be out of sync.\x1b[0m'
    );
    expect(writeln.mock.calls.some(([line]) => String(line).includes('Session ended - VM disconnected'))).toBe(false);

    act(() => {
      handlers.current.onOutput?.('compatible frame after mismatch');
    });
    expect(terminalRef.current.write).toHaveBeenCalledWith('compatible frame after mismatch');
  });
});

describe('useTerminalLive teardown races', () => {
  // Cancel is rendered for exactly the window where createSession is in flight
  // and there is no session to close, so the teardown has to reach forward to
  // the session that has not arrived yet.
  it('abandons a session that arrives after the user cancelled', async () => {
    const fake = fakeSession();
    let resolveCreate: (session: CodaSession) => void = () => {};
    mockedCreateSession.mockReturnValue(
      new Promise<CodaSession>((resolve) => {
        resolveCreate = resolve;
      })
    );

    const terminalRef = { current: fakeTerminal() };
    const hook = renderHook(() => useTerminalLive({ terminalRef }));

    act(() => {
      hook.result.current.connect();
    });
    expect(hook.result.current.status).toBe('connecting');

    act(() => {
      hook.result.current.disconnect();
    });
    expect(hook.result.current.status).toBe('disconnected');

    await act(async () => {
      resolveCreate(fake.session);
    });

    expect(fake.handlers.current).toEqual({});
    expect(fake.close).toHaveBeenCalled();
    expect(hook.result.current.status).toBe('disconnected');
    expect(hook.result.current.sessionId).toBeNull();
  });

  it('leaves a failed connect alone once it has been cancelled', async () => {
    let rejectCreate: (err: unknown) => void = () => {};
    mockedCreateSession.mockReturnValue(
      new Promise<CodaSession>((_resolve, reject) => {
        rejectCreate = reject;
      })
    );

    const terminalRef = { current: fakeTerminal() };
    const hook = renderHook(() => useTerminalLive({ terminalRef }));

    act(() => {
      hook.result.current.connect();
    });
    act(() => {
      hook.result.current.disconnect();
    });

    await act(async () => {
      rejectCreate(new CodaError('boom', 'internal', 0));
    });

    expect(hook.result.current.status).toBe('disconnected');
    expect(hook.result.current.error).toBeNull();
  });

  it('does not swallow the next session close after a no-op disconnect', async () => {
    const terminalRef = { current: fakeTerminal() };
    const hook = renderHook(() => useTerminalLive({ terminalRef }));

    act(() => {
      hook.result.current.disconnect();
    });

    const fake = fakeSession();
    mockedCreateSession.mockResolvedValue(fake.session);
    await act(async () => {
      hook.result.current.connect();
    });
    act(() => {
      fake.handlers.current.onConnected?.();
    });
    expect(hook.result.current.status).toBe('connected');

    act(() => {
      fake.handlers.current.onClosed?.();
    });

    expect(hook.result.current.status).toBe('disconnected');
    expect(hook.result.current.sessionId).toBeNull();
  });

  it('closes the session and stops the progress bar on unmount', async () => {
    jest.useFakeTimers();
    try {
      const { hook, terminalRef, handlers, close } = await connectedHook();

      act(() => {
        handlers.current.onStatus?.({ state: 'provisioning', message: 'Booting VM' });
      });
      act(() => {
        jest.advanceTimersByTime(2_000);
      });

      const write = terminalRef.current.write as jest.Mock;
      const writesWhileMounted = write.mock.calls.length;
      expect(writesWhileMounted).toBeGreaterThan(0);

      hook.unmount();
      act(() => {
        jest.advanceTimersByTime(10_000);
      });

      expect(write.mock.calls.length).toBe(writesWhileMounted);
      expect(close).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

it.each(['vm_unreachable', 'host_identity_unverified', 'coda_auth_failed'])(
  'offers replacement only for an identified unreachable VM (%s)',
  async (code) => {
    const { hook, handlers } = await connectedHook();
    act(() => handlers.current.onStatus?.({ state: 'ssh_connecting', vmId: 'failed-vm' }));
    act(() => handlers.current.onError?.(new CodaError('failed', code, 0)));
    expect(hook.result.current.unreachableVmId).toBe(code === 'vm_unreachable' ? 'failed-vm' : null);
    expect(hook.result.current.sessionId).toBeNull();
    act(() => hook.result.current.disconnect());
    expect(hook.result.current.unreachableVmId).toBeNull();
  }
);

it('leaves the welcome to the guest and passes terminal output through unchanged', async () => {
  const { handlers, terminalRef } = await connectedHook();
  expect(terminalRef.current.writeln).toHaveBeenCalledTimes(1);
  expect(terminalRef.current.writeln).toHaveBeenCalledWith('Connecting to sandbox...');
  jest.mocked(terminalRef.current.writeln).mockClear();
  act(() => {
    handlers.current.onStatus?.({ state: 'ssh_connecting', message: 'Establishing SSH connection...' });
    handlers.current.onConnected?.('vm-1');
  });
  expect(terminalRef.current.writeln).not.toHaveBeenCalled();
  const output = 'Welcome to Coda, your ephemeral sandbox.\r\nARM64 · Docker\r\n';
  act(() => handlers.current.onOutput?.(output));
  expect(terminalRef.current.write).toHaveBeenLastCalledWith(output);
});

describe('automatic recovery', () => {
  it.each(['internal', 'rate_limited', 'coda_unavailable', 'future_error'])(
    'shows an initial reservation failure immediately: %s',
    async (code) => {
      mockedCreateSession.mockRejectedValue(new CodaError('initial failure', code, 503));
      const terminalRef = { current: fakeTerminal() };
      const hook = renderHook(() => useTerminalLive({ terminalRef }));
      await act(async () => hook.result.current.connect());
      expect(hook.result.current.status).toBe('error');
      expect(hook.result.current.error).toBeTruthy();
      const originalError = hook.result.current.error;
      await act(async () => {
        jest.advanceTimersByTime(310000);
      });
      expect(mockedCreateSession).toHaveBeenCalledTimes(1);
      expect(hook.result.current.error).toBe(originalError);
      expect(terminalRef.current.writeln).not.toHaveBeenCalledWith(expect.stringContaining('Reconnecting'));
    }
  );

  it('stops a failed first subscription without masking its error', async () => {
    const { hook, handlers, terminalRef } = await connectedHook();
    act(() => handlers.current.onError?.(new CodaError('initial failure', 'future_error', 503)));
    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.error).toBe('initial failure');
    await act(async () => {
      jest.advanceTimersByTime(310000);
    });
    expect(mockedCreateSession).toHaveBeenCalledTimes(1);
    expect(terminalRef.current.writeln).not.toHaveBeenCalledWith(expect.stringContaining('Reconnecting'));
  });

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('reattaches a reloaded plugin to the same VM and replaces the dead session id', async () => {
    const first = fakeSession();
    const next = fakeSession('replacement-session');
    const { hook, terminalRef } = await connectedHook(first);
    await act(async () => first.handlers.current.onConnected?.('vm-existing'));
    mockedCreateSession.mockResolvedValue(next.session);

    act(() => first.handlers.current.onError?.(new CodaError('reloading', 'instance_disposing', 503)));
    expect(hook.result.current.status).toBe('connecting');
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.sessionId).toBeNull();
    expect(hook.result.current.vmId).toBe('vm-existing');
    act(() => {
      void hook.result.current.sendCommand('do-not-replay');
    });
    expect(first.session.write).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(mockedCreateSession).toHaveBeenLastCalledWith({ vmId: 'vm-existing' });
    await act(async () => next.handlers.current.onConnected?.('vm-existing'));
    expect(hook.result.current.status).toBe('connected');
    expect(hook.result.current.sessionId).toBe('replacement-session');
    expect(hook.result.current.vmId).toBe('vm-existing');
    expect(next.session.write).not.toHaveBeenCalled();
    expect(terminalRef.current.clear).toHaveBeenCalledTimes(1);
    expect(next.session.resize).toHaveBeenCalledWith(24, 80);
    act(() => first.handlers.current.onClosed?.());
    expect(hook.result.current.status).toBe('connected');
  });

  it.each(['disconnect', 'unmount'])('cancels pending recovery on %s', async (action) => {
    const { hook, handlers } = await connectedHook();
    await act(async () => handlers.current.onConnected?.('vm-existing'));
    act(() => handlers.current.onError?.(new CodaError('reloading', 'instance_disposing', 503)));
    act(() => {
      if (action === 'unmount') {
        hook.unmount();
      } else {
        hook.result.current.disconnect();
      }
    });
    await act(async () => {
      jest.advanceTimersByTime(300000);
    });
    expect(mockedCreateSession).toHaveBeenCalledTimes(1);
  });

  it('closes a late reattach after cancellation without subscribing it', async () => {
    const { hook, handlers } = await connectedHook();
    await act(async () => handlers.current.onConnected?.('vm-existing'));
    let resolveCreate!: (session: CodaSession) => void;
    mockedCreateSession.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      })
    );
    act(() => handlers.current.onError?.(new CodaError('reloading', 'instance_disposing', 503)));
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    act(() => hook.result.current.disconnect());
    const late = fakeSession('late-session');
    await act(async () => resolveCreate(late.session));
    expect(late.handlers.current).toEqual({});
    expect(late.close).toHaveBeenCalledTimes(1);
    expect(hook.result.current.status).toBe('disconnected');
    expect(hook.result.current.sessionId).toBeNull();
  });

  it.each(['vm_expired', 'vm_failed', 'role_forbidden'])('does not recover %s', async (code) => {
    const { hook, handlers } = await connectedHook();
    await act(async () => handlers.current.onConnected?.('vm-existing'));
    act(() => handlers.current.onError?.(new CodaError('terminal failure', code, 0)));
    await act(async () => {
      jest.advanceTimersByTime(300000);
    });
    expect(mockedCreateSession).toHaveBeenCalledTimes(1);
    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.sessionId).toBeNull();
  });

  it('offers Retry only after the recovery budget is exhausted', async () => {
    const { hook, handlers } = await connectedHook();
    await act(async () => handlers.current.onConnected?.('vm-existing'));
    mockedCreateSession.mockRejectedValue(new CodaError('still restarting', 'coda_unavailable', 503));
    act(() => handlers.current.onError?.(new CodaError('reloading', 'instance_disposing', 503)));
    for (let i = 0; i < 32; i++) {
      await act(async () => {
        jest.advanceTimersByTime(20000);
      });
    }
    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.error).toBe('Automatic reconnection stopped. Select Retry to try again.');
    expect(hook.result.current.sessionId).toBeNull();
  });

  it('offers Retry at the recovery deadline even while a slow reattach is still provisioning', async () => {
    const { hook, handlers } = await connectedHook();
    await act(async () => handlers.current.onConnected?.('vm-existing'));
    const outageStart = Date.now();
    const slow = fakeSession('slow-session');
    mockedCreateSession.mockImplementation(async () => {
      if (Date.now() - outageStart < 250_000) {
        throw new CodaError('still restarting', 'coda_unavailable', 503);
      }
      return slow.session;
    });
    act(() => handlers.current.onError?.(new CodaError('reloading', 'instance_disposing', 503)));
    for (let elapsed = 0; elapsed < 299_000; elapsed += 1000) {
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
    }
    expect(slow.handlers.current.onConnected).toBeDefined();
    expect(hook.result.current.status).toBe('connecting');

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.error).toBe('Automatic reconnection stopped. Select Retry to try again.');
    expect(slow.close).toHaveBeenCalled();
    act(() => {
      slow.handlers.current.onConnected?.('vm-existing');
      slow.handlers.current.onError?.(new CodaError('late failure', 'coda_unavailable', 503));
    });
    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.sessionId).toBeNull();
  });

  it('clears the recovery deadline once a reattach connects', async () => {
    const first = fakeSession();
    const next = fakeSession('replacement-session');
    const { hook } = await connectedHook(first);
    await act(async () => first.handlers.current.onConnected?.('vm-existing'));
    mockedCreateSession.mockResolvedValue(next.session);
    act(() => first.handlers.current.onError?.(new CodaError('reloading', 'instance_disposing', 503)));
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    await act(async () => next.handlers.current.onConnected?.('vm-existing'));
    await act(async () => {
      jest.advanceTimersByTime(600_000);
    });
    expect(hook.result.current.status).toBe('connected');
    expect(hook.result.current.sessionId).toBe('replacement-session');
  });
});

it('ignores status and protocol callbacks after the stream is superseded', async () => {
  const first = fakeSession();
  const { hook, terminalRef } = await connectedHook(first);
  const terminal = terminalRef.current;
  await act(async () => {
    hook.result.current.disconnect();
  });
  const second = fakeSession('s_1123456789abcdef0123456789abcdef', 'current-vm');
  mockedCreateSession.mockResolvedValueOnce(second.session);
  await act(async () => {
    await hook.result.current.connect();
  });
  await act(async () => {
    second.handlers.current.onConnected?.('current-vm');
  });
  jest.mocked(terminal.write).mockClear();
  jest.mocked(terminal.writeln).mockClear();
  act(() => {
    first.handlers.current.onStatus?.({ state: 'provisioning', vmId: 'stale-vm', expiresAt: 'old' });
    first.handlers.current.onProtocolError?.({ detail: 'stale', sessionId: SESSION_ID, vmId: 'stale-vm' });
  });
  expect(hook.result.current.vmId).toBe('current-vm');
  expect(hook.result.current.error).toBeNull();
  expect(terminal.write).not.toHaveBeenCalled();
  expect(terminal.writeln).not.toHaveBeenCalled();
  hook.unmount();
});
