import React, { useEffect } from 'react';
import { act, render } from '@testing-library/react';

import {
  TerminalProvider,
  getTerminalConnectionStatus,
  getTerminalSessionId,
  useTerminalContext,
  type TerminalContextValue,
} from './TerminalContext';
import * as codaApi from './coda-api';
import { getGcxCredentialSnapshot, resetGcxCredentialStore, runGcxCredential } from './gcx-credential-store';
import type { ConnectionStatus } from './useTerminalLive.hook';
import { TERMINAL_STATUS_CHANGED_EVENT } from '../../lib/event-names';

jest.mock('./coda-api', () => ({ ...jest.requireActual('./coda-api'), provisionGcx: jest.fn() }));

jest.mock('../../lib/logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
}));

const SESSION_ID = 's_0123456789abcdef0123456789abcdef';

/** Stands in for TerminalPanel, which is the only caller of `_register`. */
const mockConnect = jest.fn();
const mockDisconnect = jest.fn();
function FakePanel({
  status,
  sessionId,
  vmId = 'vm-1',
}: {
  status: ConnectionStatus;
  sessionId: string | null;
  vmId?: string | null;
}) {
  const ctx = useTerminalContext();
  useEffect(() => {
    ctx?._register({
      status,
      sessionId,
      vmId,
      error: null,
      connect: mockConnect,
      disconnect: mockDisconnect,
      sendCommand: jest.fn(),
    });
  }, [ctx, status, sessionId, vmId]);
  return null;
}

function Probe({ onRender }: { onRender: (registered: boolean) => void }) {
  const ctx = useTerminalContext();
  onRender(!!ctx?.isTerminalRegistered);
  return null;
}

describe('TerminalProvider', () => {
  // The provider mounts unconditionally while TerminalPanel is gated on dev
  // mode, enableCodaTerminal and the Coda plugin being present, so a non-null
  // context is not a working terminal (issue #1541).
  it('reports no registered terminal until a panel registers', () => {
    const seen: boolean[] = [];
    render(
      <TerminalProvider>
        <Probe onRender={(registered) => seen.push(registered)} />
      </TerminalProvider>
    );
    expect(seen.every((registered) => registered === false)).toBe(true);
  });

  it('reports a registered terminal once a panel registers', () => {
    const seen: boolean[] = [];
    render(
      <TerminalProvider>
        <FakePanel status="connected" sessionId={SESSION_ID} />
        <Probe onRender={(registered) => seen.push(registered)} />
      </TerminalProvider>
    );
    expect(seen.at(-1)).toBe(true);
  });

  // Exec reuses the stream's SSH client, so an id read out of a terminal that
  // is not attached can only buy a request the backend refuses.
  describe('getTerminalSessionId', () => {
    it('returns the id while connected', () => {
      render(
        <TerminalProvider>
          <FakePanel status="connected" sessionId={SESSION_ID} />
        </TerminalProvider>
      );
      expect(getTerminalConnectionStatus()).toBe('connected');
      expect(getTerminalSessionId()).toBe(SESSION_ID);
    });

    it.each(['connecting', 'disconnected', 'error'] as const)('returns null when status is %s', (status) => {
      render(
        <TerminalProvider>
          <FakePanel status={status} sessionId={SESSION_ID} />
        </TerminalProvider>
      );
      expect(getTerminalSessionId()).toBeNull();
    });
  });
});

describe('TERMINAL_STATUS_CHANGED_EVENT', () => {
  // The requirements checker runs outside React, so it cannot observe the module
  // state above changing. Without this event a step that checked while the
  // terminal was disconnected keeps that answer for the whole guide — and
  // provisioning a VM takes about a minute, so that is every terminal step.
  it('fires when a panel reports a new status, carrying it in the detail', () => {
    const seen: string[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail.status);
    window.addEventListener(TERMINAL_STATUS_CHANGED_EVENT, listener);

    const { rerender } = render(
      <TerminalProvider>
        <FakePanel status="connecting" sessionId={null} />
      </TerminalProvider>
    );
    rerender(
      <TerminalProvider>
        <FakePanel status="connected" sessionId={SESSION_ID} />
      </TerminalProvider>
    );

    window.removeEventListener(TERMINAL_STATUS_CHANGED_EVENT, listener);
    expect(seen).toContain('connected');
    // And the module state a listener would then read agrees with the event.
    expect(getTerminalConnectionStatus()).toBe('connected');
  });

  it('fires on disconnect too, so a step can block again', () => {
    const seen: string[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail.status);

    const { rerender } = render(
      <TerminalProvider>
        <FakePanel status="connected" sessionId={SESSION_ID} />
      </TerminalProvider>
    );
    window.addEventListener(TERMINAL_STATUS_CHANGED_EVENT, listener);
    rerender(
      <TerminalProvider>
        <FakePanel status="disconnected" sessionId={null} />
      </TerminalProvider>
    );

    window.removeEventListener(TERMINAL_STATUS_CHANGED_EVENT, listener);
    expect(seen).toContain('disconnected');
  });
});

describe('connection recovery consumers', () => {
  let context: TerminalContextValue;
  function Capture() {
    const value = useTerminalContext()!;
    useEffect(() => {
      context = value;
    }, [value]);
    return null;
  }
  function tree(status: ConnectionStatus, sessionId: string | null, vmId: string | null = 'vm-1') {
    return (
      <TerminalProvider>
        <FakePanel status={status} sessionId={sessionId} vmId={vmId} />
        <Capture />
      </TerminalProvider>
    );
  }
  beforeEach(() => {
    mockConnect.mockClear();
    mockDisconnect.mockClear();
    jest.mocked(codaApi.provisionGcx).mockReset();
    resetGcxCredentialStore();
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(['initial provision', 'recovery'])(
    'waits for a usable session during %s without starting another connection',
    async (phase) => {
      const view = render(
        tree(phase === 'recovery' ? 'connected' : 'connecting', phase === 'recovery' ? SESSION_ID : null)
      );
      view.rerender(tree('connecting', null));
      const settled = jest.fn();
      let waiting!: Promise<string | null>;
      await act(async () => {
        waiting = context.openTerminal();
        void waiting.then(settled);
      });
      expect(settled).not.toHaveBeenCalled();
      expect(mockConnect).not.toHaveBeenCalled();
      view.rerender(tree('connected', 'new-session'));
      await expect(waiting).resolves.toBe('new-session');
    }
  );

  it.each(['connecting', 'connected'] as const)(
    'reuses configured VM options when openTerminal omits options while %s',
    async (status) => {
      jest.useFakeTimers();
      try {
        const view = render(tree('disconnected', null));
        act(() => context.connect({ template: 'configured-template', app: 'app', scenario: 'scenario' }));
        view.rerender(tree('connected', SESSION_ID));
        if (status === 'connecting') {
          view.rerender(tree('connecting', null));
        }
        mockConnect.mockClear();
        mockDisconnect.mockClear();
        const settled = jest.fn();
        let waiting!: Promise<string | null>;
        await act(async () => {
          waiting = context.openTerminal();
          void waiting.then(settled);
          jest.advanceTimersByTime(200);
        });
        expect(mockDisconnect).not.toHaveBeenCalled();
        expect(mockConnect).not.toHaveBeenCalled();
        if (status === 'connecting') {
          expect(settled).not.toHaveBeenCalled();
          view.rerender(tree('connected', 'recovered-session'));
          await expect(waiting).resolves.toBe('recovered-session');
        } else {
          await expect(waiting).resolves.toBe(SESSION_ID);
        }
      } finally {
        jest.useRealTimers();
      }
    }
  );

  it('keeps a VM-option reconnect waiter pending until the replacement session connects', async () => {
    jest.useFakeTimers();
    try {
      const view = render(tree('connected', SESSION_ID));
      const settled = jest.fn();
      let waiting!: Promise<string | null>;
      await act(async () => {
        waiting = context.openTerminal({ template: 'different-template' });
        void waiting.then(settled);
      });
      view.rerender(tree('disconnected', null));
      await act(async () => {});
      expect(settled).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(100);
      });
      expect(mockConnect).toHaveBeenCalledWith({ template: 'different-template' });
      expect(settled).not.toHaveBeenCalled();
      view.rerender(tree('connecting', null));
      view.rerender(tree('connected', 'replacement-session', 'vm-2'));
      await expect(waiting).resolves.toBe('replacement-session');
    } finally {
      jest.useRealTimers();
    }
  });

  it.each(['error', 'disconnected', 'cancel', 'unmount'])('settles recovery waiters on %s', async (end) => {
    const view = render(tree('connecting', null));
    let waiting!: Promise<string | null>;
    act(() => {
      waiting = context.openTerminal();
    });
    if (end === 'unmount') {
      view.unmount();
    } else if (end === 'cancel') {
      act(() => context.disconnect());
    } else {
      view.rerender(tree(end as ConnectionStatus, null));
    }
    await expect(waiting).resolves.toBeNull();
  });

  it('passes VM identity through registration so completed GCX setup survives recovery', async () => {
    const credential = { path: '/config/gcx', contextName: 'coda', server: 'https://example.com' };
    const provision = jest.mocked(codaApi.provisionGcx).mockResolvedValue(credential);
    const view = render(tree('connecting', null));
    let install!: Promise<void>;
    act(() => {
      install = context.openTerminal().then((id) => runGcxCredential(id, 'test-token', 'step-a'));
    });
    expect(provision).not.toHaveBeenCalled();
    view.rerender(tree('connected', SESSION_ID));
    await act(async () => install);
    view.rerender(tree('connecting', null));
    view.rerender(tree('connected', 'new-session'));
    expect(getGcxCredentialSnapshot()).toMatchObject({
      state: 'ready',
      sessionId: 'new-session',
      credential,
      requesterId: 'step-a',
    });
    expect(provision).toHaveBeenCalledTimes(1);
    view.rerender(tree('connected', 'different-session', 'vm-2'));
    expect(getGcxCredentialSnapshot().state).toBe('idle');
  });
});
