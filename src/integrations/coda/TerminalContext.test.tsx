import React, { useEffect } from 'react';
import { render } from '@testing-library/react';

import {
  TerminalProvider,
  getTerminalConnectionStatus,
  getTerminalSessionId,
  useTerminalContext,
} from './TerminalContext';
import type { ConnectionStatus } from './useTerminalLive.hook';
import { TERMINAL_STATUS_CHANGED_EVENT } from '../../types/requirements.types';

jest.mock('../../lib/logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
}));

const SESSION_ID = 's_0123456789abcdef0123456789abcdef';

/** Stands in for TerminalPanel, which is the only caller of `_register`. */
function FakePanel({ status, sessionId }: { status: ConnectionStatus; sessionId: string | null }) {
  const ctx = useTerminalContext();
  useEffect(() => {
    ctx?._register({
      status,
      sessionId,
      error: null,
      connect: jest.fn(),
      disconnect: jest.fn(),
      sendCommand: jest.fn(),
    });
  }, [ctx, status, sessionId]);
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
