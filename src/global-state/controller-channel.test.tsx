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

    // Pair with the live tab first — replies are only honored from the paired
    // tab, and pairing happens on a heartbeat (T1 PART C).
    act(() => transport.emit(liveHeartbeat()));
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

    // Pair with the live tab first (T1 PART C: replies need an established pair).
    act(() => transport.emit(liveHeartbeat()));
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

  it('drops a reply from an unpaired tab and never lets it claim the pairing slot (T1 PART C)', async () => {
    const transport = new FakeTransport();
    render(
      <ControllerChannelProvider transport={transport}>
        <RequestProbe />
      </ControllerChannelProvider>
    );

    fireEvent.click(screen.getByText('check'));
    const request = postedOfKind(transport, 'check-requirements');

    // A forged reply arrives before any live heartbeat. It must be ignored AND
    // must not bind the pairing slot — pairing happens on a heartbeat only.
    act(() =>
      transport.emit({
        source: 'pathfinder',
        senderId: 'attacker',
        timestamp: 0,
        kind: 'requirement-result',
        requestId: request.requestId,
        stepId: 's1',
        result: { requirements: 'navmenu-open', pass: true, error: [] },
      })
    );
    expect(screen.getByTestId('check')).toHaveTextContent('pending');

    // The real live tab heartbeats and pairs; its reply is then honored — proving
    // the attacker never claimed the slot.
    act(() => transport.emit(liveHeartbeat()));
    act(() =>
      transport.emit({
        source: 'pathfinder',
        senderId: 'live',
        timestamp: 0,
        kind: 'requirement-result',
        requestId: request.requestId,
        stepId: 's1',
        result: { requirements: 'navmenu-open', pass: false, error: [] },
      })
    );
    await waitFor(() => expect(screen.getByTestId('check')).toHaveTextContent('pass:false'));
  });

  it('binds to the first live tab and ignores replies from others', async () => {
    const transport = new FakeTransport();
    render(
      <ControllerChannelProvider transport={transport}>
        <RequestProbe />
      </ControllerChannelProvider>
    );

    // Pair with live tab A via its heartbeat.
    act(() =>
      transport.emit({ source: 'pathfinder', senderId: 'live-A', timestamp: 0, kind: 'heartbeat', role: 'live' })
    );

    fireEvent.click(screen.getByText('check'));
    const request = postedOfKind(transport, 'check-requirements');

    // A different tab answering the same requestId must be ignored.
    act(() =>
      transport.emit({
        source: 'pathfinder',
        senderId: 'live-B',
        timestamp: 0,
        kind: 'requirement-result',
        requestId: request.requestId,
        stepId: 's1',
        result: { requirements: 'navmenu-open', pass: false, error: [] },
      })
    );
    expect(screen.getByTestId('check')).toHaveTextContent('pending');

    // The paired tab's reply is honored.
    act(() =>
      transport.emit({
        source: 'pathfinder',
        senderId: 'live-A',
        timestamp: 0,
        kind: 'requirement-result',
        requestId: request.requestId,
        stepId: 's1',
        result: { requirements: 'navmenu-open', pass: true, error: [] },
      })
    );
    await waitFor(() => expect(screen.getByTestId('check')).toHaveTextContent('pass:true'));
  });

  it('resolves awaitStepComplete when the live tab reports completion', async () => {
    function CompleteProbe() {
      const channel = useControllerChannel();
      const [done, setDone] = React.useState('pending');
      return (
        <div>
          <button onClick={() => channel?.awaitStepComplete('s9').then((ok) => setDone(`ok:${ok}`))}>await</button>
          <span data-testid="done">{done}</span>
        </div>
      );
    }
    const transport = new FakeTransport();
    render(
      <ControllerChannelProvider transport={transport}>
        <CompleteProbe />
      </ControllerChannelProvider>
    );

    // Pair with live-A first; a step-complete is only honored from the paired
    // tab (T1 PART C), and pairing happens on a heartbeat.
    act(() =>
      transport.emit({ source: 'pathfinder', senderId: 'live-A', timestamp: 0, kind: 'heartbeat', role: 'live' })
    );
    fireEvent.click(screen.getByText('await'));
    act(() =>
      transport.emit({
        source: 'pathfinder',
        senderId: 'live-A',
        timestamp: 0,
        kind: 'step-complete',
        stepId: 's9',
        ok: true,
      })
    );

    await waitFor(() => expect(screen.getByTestId('done')).toHaveTextContent('ok:true'));
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
