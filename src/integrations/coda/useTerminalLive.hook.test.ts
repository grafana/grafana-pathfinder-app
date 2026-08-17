/**
 * Exec is session-scoped in the extracted Coda plugin: `POST
 * /v1/sessions/{id}/exec` reuses the stream's SSH client and refuses a session
 * whose terminal is gone. Knowing when a session has died is therefore the
 * consumer's job, and a retained id can only buy a doomed request. These tests
 * pin that every session-terminating path drops the id.
 *
 * `CodaSession` (from `@grafana/coda-client`) owns the Live channel, frame
 * validation and its own idle timer now — this hook only reacts to its
 * handlers, so tests drive those handlers directly rather than a raw Live
 * channel. Channel-level plumbing and the idle timer are the package's own
 * test suite's job, not this hook's.
 */

import { act, renderHook } from '@testing-library/react';
import type { Terminal } from '@xterm/xterm';
import { CodaError, type CodaSession, type SessionHandlers } from '@grafana/coda-client';

import { useTerminalLive } from './useTerminalLive.hook';
import { createSession } from './coda-api';

jest.mock('./coda-api', () => ({
  ...jest.requireActual('./coda-api'),
  createSession: jest.fn(),
}));

jest.mock('../../lib/logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
}));

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
function fakeSession(sessionId = SESSION_ID): FakeSession {
  const handlers: { current: SessionHandlers } = { current: {} };
  const close = jest.fn(async () => {
    handlers.current.onClosed?.();
  });
  const session = {
    sessionId,
    vmID: undefined,
    subscribe: jest.fn((h: SessionHandlers) => {
      handlers.current = h;
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
  expect(hook.result.current.sessionId).toBe(fake.session.sessionId);

  return { hook, terminalRef, ...fake };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useTerminalLive session lifetime', () => {
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
      handlers.current.onError?.(new CodaError('vm gone', 'internal', 0));
    });

    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.sessionId).toBeNull();
  });

  it('drops the session id when the session closes without an error', async () => {
    const { hook, handlers } = await connectedHook();

    act(() => {
      handlers.current.onConnected?.();
      handlers.current.onClosed?.();
    });

    expect(hook.result.current.status).toBe('disconnected');
    expect(hook.result.current.sessionId).toBeNull();
  });

  it('names an exhausted quota from the error code instead of the generic message', async () => {
    const { hook, handlers } = await connectedHook();

    act(() => {
      handlers.current.onError?.(new CodaError('Failed to create VM, please try again', 'vm_quota_exceeded', 0));
    });

    expect(hook.result.current.error).toMatch(/maximum number of sandbox VMs/i);
  });

  // New codes are an additive change within v1, and a backend older than the
  // field sends none at all: both must fall back to the sentence, not be fatal.
  it.each([
    ['an unrecognised code', 'quantum_flux'],
    ['no code at all (CodaSession defaults to "internal")', 'internal'],
  ])('falls back to the backend sentence for %s', async (_name, code) => {
    const { hook, handlers } = await connectedHook();

    act(() => {
      handlers.current.onError?.(new CodaError('something new went wrong', code, 0));
    });

    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.error).toBe('something new went wrong');
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
    expect(close).toHaveBeenCalled();
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

    expect(fake.session.subscribe).not.toHaveBeenCalled();
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

  // The banner latch is consumed by onClosed, which never fires when there is
  // no open session — so setting it unconditionally leaked it into the next
  // session and swallowed that one's first genuine close.
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
