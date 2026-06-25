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

async function waitForPostedOfKind(transport: FakeTransport, kind: string): Promise<any> {
  await waitFor(() => expect(postedOfKind(transport, kind)).toBeTruthy());
  return postedOfKind(transport, kind);
}

async function pairWithLive(transport: FakeTransport, liveId = 'live'): Promise<void> {
  const challenge = await waitForPostedOfKind(transport, 'pairing-challenge');
  act(() =>
    transport.emit({
      source: 'pathfinder',
      senderId: liveId,
      timestamp: 0,
      kind: 'pairing-accept',
      sessionId: challenge.sessionId,
    })
  );
}

function signedFieldsFor(liveId: string) {
  return {
    sig: expect.any(String),
    sessionId: expect.any(String),
    liveTabId: liveId,
    sigTs: expect.any(Number),
    sigNonce: expect.any(String),
  };
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

  it('hands the sidebar off after pairing is accepted', async () => {
    const transport = new FakeTransport();
    render(
      <ControllerChannelProvider transport={transport}>
        <Probe />
      </ControllerChannelProvider>
    );

    expect(postedOfKind(transport, 'sidebar-handoff')).toBeUndefined();
    await pairWithLive(transport);

    await waitFor(() =>
      expect(transport.postedMessages).toContainEqual(
        expect.objectContaining({ kind: 'sidebar-handoff', action: 'close', ...signedFieldsFor('live') })
      )
    );
  });

  it('forwards signed channel.post messages after pairing', async () => {
    const transport = new FakeTransport();
    render(
      <ControllerChannelProvider transport={transport}>
        <Probe />
      </ControllerChannelProvider>
    );

    await pairWithLive(transport);
    fireEvent.click(screen.getByText('post'));

    await waitFor(() =>
      expect(transport.postedMessages).toContainEqual(
        expect.objectContaining({
          ...signedFieldsFor('live'),
          kind: 'step-command',
          phase: 'do',
          stepId: 's1',
          runId: 'test-run-id',
          action: { targetAction: 'button', refTarget: '#x' },
        })
      )
    );
  });

  it('reports connected once a paired live tab heartbeats', async () => {
    const transport = new FakeTransport();
    render(
      <ControllerChannelProvider transport={transport}>
        <Probe />
      </ControllerChannelProvider>
    );

    expect(screen.getByTestId('connected')).toHaveTextContent('false');
    act(() => transport.emit(liveHeartbeat()));
    expect(screen.getByTestId('connected')).toHaveTextContent('false');

    await pairWithLive(transport);
    act(() => transport.emit(liveHeartbeat()));
    expect(screen.getByTestId('connected')).toHaveTextContent('true');
  });

  it('sends sidebar-handoff:close once for the accepted pairing', async () => {
    const transport = new FakeTransport();
    render(
      <ControllerChannelProvider transport={transport}>
        <Probe />
      </ControllerChannelProvider>
    );

    await pairWithLive(transport);
    await waitFor(() =>
      expect(
        transport.postedMessages.filter((m) => (m as any)?.kind === 'sidebar-handoff' && (m as any)?.action === 'close')
      ).toHaveLength(1)
    );

    act(() =>
      transport.emit({ source: 'pathfinder', senderId: 'live', timestamp: 0, kind: 'pairing-accept', sessionId: 'x' })
    );
    act(() => transport.emit(liveHeartbeat()));

    expect(
      transport.postedMessages.filter((m) => (m as any)?.kind === 'sidebar-handoff' && (m as any)?.action === 'close')
    ).toHaveLength(1);
  });

  it('drops heartbeat-only pairing attempts', () => {
    const transport = new FakeTransport();
    render(
      <ControllerChannelProvider transport={transport}>
        <Probe />
      </ControllerChannelProvider>
    );

    act(() => transport.emit(liveHeartbeat()));
    fireEvent.click(screen.getByText('post'));

    expect(postedOfKind(transport, 'step-command')).toBeUndefined();
  });

  it('resolves requestRequirementCheck with the live tab reply', async () => {
    const transport = new FakeTransport();
    render(
      <ControllerChannelProvider transport={transport}>
        <RequestProbe />
      </ControllerChannelProvider>
    );

    await pairWithLive(transport);
    fireEvent.click(screen.getByText('check'));
    const request = await waitForPostedOfKind(transport, 'check-requirements');
    expect(request).toEqual(
      expect.objectContaining({
        ...signedFieldsFor('live'),
        requestId: expect.any(String),
      })
    );

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

    await pairWithLive(transport);
    fireEvent.click(screen.getByText('fix'));
    const request = await waitForPostedOfKind(transport, 'fix-requirement');
    expect(request).toEqual(
      expect.objectContaining({
        ...signedFieldsFor('live'),
        requestId: expect.any(String),
      })
    );

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

  it('drops a reply from an unpaired tab and never lets it claim the pairing slot', async () => {
    const transport = new FakeTransport();
    render(
      <ControllerChannelProvider transport={transport}>
        <RequestProbe />
      </ControllerChannelProvider>
    );

    await waitForPostedOfKind(transport, 'pairing-challenge');
    const originalRandomUUID = crypto.randomUUID.bind(crypto);
    const randomUUIDSpy = jest.spyOn(crypto, 'randomUUID').mockImplementation(() => originalRandomUUID());
    randomUUIDSpy.mockReturnValueOnce('00000000-0000-4000-8000-000000000001');
    try {
      fireEvent.click(screen.getByText('check'));

      act(() =>
        transport.emit({
          source: 'pathfinder',
          senderId: 'attacker',
          timestamp: 0,
          kind: 'requirement-result',
          requestId: '00000000-0000-4000-8000-000000000001',
          stepId: 's1',
          result: { requirements: 'navmenu-open', pass: true, error: [] },
        })
      );
      expect(screen.getByTestId('check')).toHaveTextContent('pending');

      await pairWithLive(transport);
      act(() =>
        transport.emit({
          source: 'pathfinder',
          senderId: 'live',
          timestamp: 0,
          kind: 'requirement-result',
          requestId: '00000000-0000-4000-8000-000000000001',
          stepId: 's1',
          result: { requirements: 'navmenu-open', pass: false, error: [] },
        })
      );
      await waitFor(() => expect(screen.getByTestId('check')).toHaveTextContent('pass:false'));
    } finally {
      randomUUIDSpy.mockRestore();
    }
  });

  it('binds to the first accepted live tab and ignores replies from others', async () => {
    const transport = new FakeTransport();
    render(
      <ControllerChannelProvider transport={transport}>
        <RequestProbe />
      </ControllerChannelProvider>
    );

    await pairWithLive(transport, 'live-A');

    fireEvent.click(screen.getByText('check'));
    const request = await waitForPostedOfKind(transport, 'check-requirements');

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

    await pairWithLive(transport, 'live-A');
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

    await pairWithLive(transport, 'live-A');
    fireEvent.click(screen.getByText('await'));

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

  it('forwards step-progress to an onStepProgress subscriber', async () => {
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

    await pairWithLive(transport, 'live-A');
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

  it('posts a signed sidebar hand-back on unmount after pairing', async () => {
    const transport = new FakeTransport();
    const { unmount } = render(
      <ControllerChannelProvider transport={transport}>
        <Probe />
      </ControllerChannelProvider>
    );

    await pairWithLive(transport);
    await waitForPostedOfKind(transport, 'sidebar-handoff');
    unmount();

    await waitFor(() =>
      expect(transport.postedMessages).toContainEqual(
        expect.objectContaining({ kind: 'sidebar-handoff', action: 'reopen', ...signedFieldsFor('live') })
      )
    );
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
