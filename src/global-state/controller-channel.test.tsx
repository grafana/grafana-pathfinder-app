import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { ControllerChannelProvider, useControllerChannel, useControllerConnected } from './controller-channel';
import type { CrossTabMessage } from '../types/cross-tab.types';

class FakeTransport {
  started = false;
  stopped = false;
  postedMessages: unknown[] = [];
  private listener: ((message: CrossTabMessage) => void) | null = null;

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.stopped = true;
  }

  post(payload: unknown): void {
    this.postedMessages.push(payload);
  }

  onMessage(listener: (message: CrossTabMessage) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  emit(message: CrossTabMessage): void {
    this.listener?.(message);
  }
}

function liveHeartbeat(): CrossTabMessage {
  return { source: 'pathfinder', senderId: 'live', timestamp: 0, kind: 'heartbeat', role: 'live' };
}

function Probe() {
  const channel = useControllerChannel();
  const connected = useControllerConnected();
  return (
    <div>
      <button
        onClick={() =>
          channel?.post({
            kind: 'step-command',
            phase: 'do',
            stepId: 's1',
            action: { targetAction: 'button', refTarget: '#x' },
          })
        }
      >
        post
      </button>
      <span data-testid="connected">{String(connected)}</span>
    </div>
  );
}

function RequestProbe() {
  const channel = useControllerChannel();
  const [check, setCheck] = React.useState('pending');
  const [fix, setFix] = React.useState('pending');
  return (
    <div>
      <button
        onClick={() =>
          channel?.requestRequirementCheck('s1', 'navmenu-open').then((r) => setCheck(r ? `pass:${r.pass}` : 'null'))
        }
      >
        check
      </button>
      <button
        onClick={() =>
          channel
            ?.requestFix('s1', { requirements: 'navmenu-open', fixType: 'navigation' })
            .then((r) => setFix(`ok:${r.ok}`))
        }
      >
        fix
      </button>
      <span data-testid="check">{check}</span>
      <span data-testid="fix">{fix}</span>
    </div>
  );
}

function postedOfKind(transport: FakeTransport, kind: string): any {
  return (transport.postedMessages as any[]).find((m) => m.kind === kind);
}

describe('ControllerChannelProvider', () => {
  it('starts the transport on mount and stops it on unmount', () => {
    const transport = new FakeTransport();
    const { unmount } = render(
      <ControllerChannelProvider transport={transport}>
        <Probe />
      </ControllerChannelProvider>
    );

    expect(transport.started).toBe(true);
    expect(transport.stopped).toBe(false);

    unmount();
    expect(transport.stopped).toBe(true);
  });

  it('posts a controller heartbeat on mount', () => {
    const transport = new FakeTransport();
    render(
      <ControllerChannelProvider transport={transport}>
        <Probe />
      </ControllerChannelProvider>
    );

    expect(transport.postedMessages).toContainEqual({ kind: 'heartbeat', role: 'controller' });
  });

  it('hands the sidebar off (close) on mount', () => {
    const transport = new FakeTransport();
    render(
      <ControllerChannelProvider transport={transport}>
        <Probe />
      </ControllerChannelProvider>
    );

    expect(transport.postedMessages).toContainEqual({ kind: 'sidebar-handoff', action: 'close' });
  });

  it('forwards channel.post to the transport', () => {
    const transport = new FakeTransport();
    render(
      <ControllerChannelProvider transport={transport}>
        <Probe />
      </ControllerChannelProvider>
    );

    fireEvent.click(screen.getByText('post'));

    expect(transport.postedMessages).toContainEqual({
      kind: 'step-command',
      phase: 'do',
      stepId: 's1',
      action: { targetAction: 'button', refTarget: '#x' },
    });
  });

  it('reports connected once a live heartbeat arrives', () => {
    const transport = new FakeTransport();
    render(
      <ControllerChannelProvider transport={transport}>
        <Probe />
      </ControllerChannelProvider>
    );

    expect(screen.getByTestId('connected')).toHaveTextContent('false');
    act(() => transport.emit(liveHeartbeat()));
    expect(screen.getByTestId('connected')).toHaveTextContent('true');
  });

  it('re-asserts sidebar-handoff:close once the first live heartbeat arrives (F-1067-1)', () => {
    const transport = new FakeTransport();
    render(
      <ControllerChannelProvider transport={transport}>
        <Probe />
      </ControllerChannelProvider>
    );

    const closes = () =>
      transport.postedMessages.filter((m) => (m as any)?.kind === 'sidebar-handoff' && (m as any)?.action === 'close');
    expect(closes()).toHaveLength(1); // initial close at mount

    act(() => transport.emit(liveHeartbeat()));
    expect(closes()).toHaveLength(2); // re-asserted now a live tab is present

    // A second/third live heartbeat must not keep re-posting.
    act(() => transport.emit(liveHeartbeat()));
    expect(closes()).toHaveLength(2);
  });

  it('resolves requestRequirementCheck with the live tab reply', async () => {
    const transport = new FakeTransport();
    render(
      <ControllerChannelProvider transport={transport}>
        <RequestProbe />
      </ControllerChannelProvider>
    );

    fireEvent.click(screen.getByText('check'));
    const request = postedOfKind(transport, 'check-requirements');
    expect(request.requestId).toBeTruthy();

    act(() =>
      transport.emit({
        source: 'pathfinder',
        senderId: 'live',
        timestamp: 0,
        kind: 'requirement-result',
        requestId: request.requestId,
        stepId: 's1',
        result: { requirements: 'navmenu-open', pass: true, error: [] },
      })
    );

    await waitFor(() => expect(screen.getByTestId('check')).toHaveTextContent('pass:true'));
  });

  it('resolves requestFix with the live tab outcome', async () => {
    const transport = new FakeTransport();
    render(
      <ControllerChannelProvider transport={transport}>
        <RequestProbe />
      </ControllerChannelProvider>
    );

    fireEvent.click(screen.getByText('fix'));
    const request = postedOfKind(transport, 'fix-requirement');
    expect(request.requestId).toBeTruthy();

    act(() =>
      transport.emit({
        source: 'pathfinder',
        senderId: 'live',
        timestamp: 0,
        kind: 'fix-result',
        requestId: request.requestId,
        stepId: 's1',
        ok: true,
      })
    );

    await waitFor(() => expect(screen.getByTestId('fix')).toHaveTextContent('ok:true'));
  });

  it('falls back to null when no live tab answers within the timeout', async () => {
    jest.useFakeTimers();
    try {
      const transport = new FakeTransport();
      render(
        <ControllerChannelProvider transport={transport}>
          <RequestProbe />
        </ControllerChannelProvider>
      );

      fireEvent.click(screen.getByText('check'));
      await act(async () => {
        jest.advanceTimersByTime(5000);
      });

      expect(screen.getByTestId('check')).toHaveTextContent('null');
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns null outside a provider', () => {
    function Peek() {
      const channel = useControllerChannel();
      return <span data-testid="outside">{channel === null ? 'null' : 'present'}</span>;
    }
    render(<Peek />);
    expect(screen.getByTestId('outside')).toHaveTextContent('null');
  });
});
