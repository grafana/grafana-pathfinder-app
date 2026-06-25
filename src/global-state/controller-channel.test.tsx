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
            runId: 'test-run-id',
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

    act(() => transport.emit(liveHeartbeat()));
    fireEvent.click(screen.getByText('post'));

    expect(transport.postedMessages).toContainEqual(
      expect.objectContaining({
        kind: 'step-command',
        phase: 'do',
        stepId: 's1',
        runId: 'test-run-id',
        action: { targetAction: 'button', refTarget: '#x' },
      })
    );
  });

  it('injects targetTabId into step-command after pairing', () => {
    const transport = new FakeTransport();
    render(
      <ControllerChannelProvider transport={transport}>
        <Probe />
      </ControllerChannelProvider>
    );

    act(() => transport.emit(liveHeartbeat()));
    fireEvent.click(screen.getByText('post'));

    expect(transport.postedMessages).toContainEqual(
      expect.objectContaining({ kind: 'step-command', targetTabId: 'live' })
    );
  });

  it('drops a step-command when unpaired', () => {
    const transport = new FakeTransport();
    render(
      <ControllerChannelProvider transport={transport}>
        <Probe />
      </ControllerChannelProvider>
    );

    fireEvent.click(screen.getByText('post'));

    const posted = (transport.postedMessages as any[]).find((m) => m.kind === 'step-command');
    expect(posted).toBeUndefined();
  });

  it('injects targetTabId into check-requirements after pairing', () => {
    const transport = new FakeTransport();
    render(
      <ControllerChannelProvider transport={transport}>
        <RequestProbe />
      </ControllerChannelProvider>
    );

    act(() => transport.emit(liveHeartbeat()));
    fireEvent.click(screen.getByText('check'));

    const posted = (transport.postedMessages as any[]).find((m) => m.kind === 'check-requirements');
    expect(posted).toBeDefined();
    expect(posted.targetTabId).toBe('live');
  });

  it('injects targetTabId into fix-requirement after pairing', () => {
    const transport = new FakeTransport();
    render(
      <ControllerChannelProvider transport={transport}>
        <RequestProbe />
      </ControllerChannelProvider>
    );

    act(() => transport.emit(liveHeartbeat()));
    fireEvent.click(screen.getByText('fix'));

    const posted = postedOfKind(transport, 'fix-requirement');
    expect(posted).toBeDefined();
    expect(posted.targetTabId).toBe('live');

    // Settle the pending promise so it doesn't resolve to null on unmount and
    // contaminate the next test via the failAllPending → .then(r => r.ok) path.
    act(() =>
      transport.emit({
        source: 'pathfinder',
        senderId: 'live',
        timestamp: 0,
        kind: 'fix-result',
        requestId: posted.requestId,
        stepId: 's1',
        ok: true,
      })
    );
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

  it('drops a reply from a non-paired tab and never lets it claim the pairing slot (T1 PART C)', async () => {
    const transport = new FakeTransport();
    render(
      <ControllerChannelProvider transport={transport}>
        <RequestProbe />
      </ControllerChannelProvider>
    );

    // Pair with the real live tab first — pairing happens on a heartbeat only.
    act(() => transport.emit(liveHeartbeat()));
    fireEvent.click(screen.getByText('check'));
    const request = postedOfKind(transport, 'check-requirements');

    // A forged reply from a different sender arrives. It must be ignored — the
    // attacker can't claim the already-bound pairing slot via a reply.
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

    // The paired tab's reply is honored.
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
          <button onClick={() => channel?.awaitStepComplete('s9', 'run-9').then((ok) => setDone(`ok:${ok}`))}>
            await
          </button>
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
        runId: 'run-9',
        ok: true,
      })
    );

    await waitFor(() => expect(screen.getByTestId('done')).toHaveTextContent('ok:true'));
  });

  it('drops a step-complete with a stale runId and does not settle the waiter', async () => {
    function CompleteProbe() {
      const channel = useControllerChannel();
      const [done, setDone] = React.useState('pending');
      return (
        <div>
          <button onClick={() => channel?.awaitStepComplete('s10', 'run-new').then((ok) => setDone(`ok:${ok}`))}>
            await
          </button>
          <span data-testid="done2">{done}</span>
        </div>
      );
    }
    const transport = new FakeTransport();
    render(
      <ControllerChannelProvider transport={transport}>
        <CompleteProbe />
      </ControllerChannelProvider>
    );

    act(() =>
      transport.emit({ source: 'pathfinder', senderId: 'live-A', timestamp: 0, kind: 'heartbeat', role: 'live' })
    );
    fireEvent.click(screen.getByText('await'));

    // A step-complete with the wrong runId (stale from a cancelled run) must not settle.
    act(() =>
      transport.emit({
        source: 'pathfinder',
        senderId: 'live-A',
        timestamp: 0,
        kind: 'step-complete',
        stepId: 's10',
        runId: 'run-old',
        ok: true,
      })
    );
    expect(screen.getByTestId('done2')).toHaveTextContent('pending');

    // The correct runId settles normally.
    act(() =>
      transport.emit({
        source: 'pathfinder',
        senderId: 'live-A',
        timestamp: 0,
        kind: 'step-complete',
        stepId: 's10',
        runId: 'run-new',
        ok: true,
      })
    );
    await waitFor(() => expect(screen.getByTestId('done2')).toHaveTextContent('ok:true'));
  });

  it('forwards step-progress to an onStepProgress subscriber', () => {
    function ProgressProbe() {
      const channel = useControllerChannel();
      const [p, setP] = React.useState('none');
      React.useEffect(
        () => channel?.onStepProgress('s9', 'run-9', (index, total) => setP(`${index}/${total}`)),
        [channel]
      );
      return <span data-testid="progress">{p}</span>;
    }
    const transport = new FakeTransport();
    render(
      <ControllerChannelProvider transport={transport}>
        <ProgressProbe />
      </ControllerChannelProvider>
    );

    // A forged step-progress before any live heartbeat must be dropped — pairing
    // happens on a heartbeat only, so an unpaired sender can't drive the bar.
    act(() =>
      transport.emit({
        source: 'pathfinder',
        senderId: 'attacker',
        timestamp: 0,
        kind: 'step-progress',
        stepId: 's9',
        runId: 'run-9',
        index: 2,
        total: 3,
      })
    );
    expect(screen.getByTestId('progress')).toHaveTextContent('none');

    // Pair with live-A via a heartbeat; its step-progress is then honored.
    act(() =>
      transport.emit({ source: 'pathfinder', senderId: 'live-A', timestamp: 0, kind: 'heartbeat', role: 'live' })
    );
    act(() =>
      transport.emit({
        source: 'pathfinder',
        senderId: 'live-A',
        timestamp: 0,
        kind: 'step-progress',
        stepId: 's9',
        runId: 'run-9',
        index: 1,
        total: 3,
      })
    );
    expect(screen.getByTestId('progress')).toHaveTextContent('1/3');
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
