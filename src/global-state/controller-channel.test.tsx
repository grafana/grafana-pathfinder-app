import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { ControllerChannelProvider, useControllerChannel, useControllerConnected } from './controller-channel';
import { FakeCrossTabTransport, TEST_PAIRING } from '../test-utils/fake-cross-tab-transport';
import { createPairingAcceptProof } from '../lib/pairing-manager';
import type { CrossTabMessage, CrossTabPayload } from '../types/cross-tab.types';
import type { GuidedSubstepResult } from '../types/interactive-actions.types';

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

function postedOfKind(transport: FakeCrossTabTransport, kind: string): any {
  return (transport.postedMessages as any[]).find((m) => m.kind === kind);
}

async function waitForPostedOfKind(transport: FakeCrossTabTransport, kind: string): Promise<any> {
  await waitFor(() => expect(postedOfKind(transport, kind)).toBeTruthy());
  return postedOfKind(transport, kind);
}

async function pairWithLive(transport: FakeCrossTabTransport, liveId = 'live'): Promise<void> {
  const challenge = await waitForPostedOfKind(transport, 'pairing-challenge');
  const acceptProof = await createPairingAcceptProof(TEST_PAIRING.pairingSecret, {
    pairingId: TEST_PAIRING.pairingId,
    sessionId: challenge.sessionId,
    liveTabId: liveId,
  });
  act(() =>
    transport.emit({
      source: 'pathfinder',
      senderId: liveId,
      timestamp: 0,
      kind: 'pairing-accept',
      sessionId: challenge.sessionId,
      pairingId: TEST_PAIRING.pairingId,
      acceptProof,
    })
  );
  await waitForPostedOfKind(transport, 'sidebar-handoff');
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

async function pairedChannel() {
  let channel!: NonNullable<ReturnType<typeof useControllerChannel>>;
  function CaptureChannel() {
    const current = useControllerChannel();
    React.useEffect(() => {
      if (current) {
        channel = current;
      }
    }, [current]);
    return null;
  }
  const transport = new FakeCrossTabTransport();
  const view = render(
    <ControllerChannelProvider transport={transport} pairing={TEST_PAIRING}>
      <CaptureChannel />
    </ControllerChannelProvider>
  );
  await pairWithLive(transport);
  return { channel, transport, unmount: view.unmount };
}

function stepReply(
  payload: Extract<CrossTabPayload, { kind: 'step-progress' | 'step-complete' }>,
  senderId = 'live'
): CrossTabMessage {
  return { source: 'pathfinder', senderId, timestamp: 0, ...payload };
}

describe('ControllerChannelProvider', () => {
  it('starts the transport on mount and stops it on unmount', () => {
    const transport = new FakeCrossTabTransport();
    const { unmount } = render(
      <ControllerChannelProvider transport={transport} pairing={TEST_PAIRING}>
        <Probe />
      </ControllerChannelProvider>
    );

    expect(transport.started).toBe(true);
    expect(transport.stopped).toBe(false);

    unmount();
    expect(transport.stopped).toBe(true);
  });

  it('posts a controller heartbeat on mount', () => {
    const transport = new FakeCrossTabTransport();
    render(
      <ControllerChannelProvider transport={transport} pairing={TEST_PAIRING}>
        <Probe />
      </ControllerChannelProvider>
    );

    expect(transport.postedMessages).toContainEqual({ kind: 'heartbeat', role: 'controller' });
  });

  it('posts a launch-bound pairing challenge', async () => {
    const transport = new FakeCrossTabTransport();
    render(
      <ControllerChannelProvider transport={transport} pairing={TEST_PAIRING}>
        <Probe />
      </ControllerChannelProvider>
    );

    await expect(waitForPostedOfKind(transport, 'pairing-challenge')).resolves.toEqual(
      expect.objectContaining({
        kind: 'pairing-challenge',
        sessionId: expect.any(String),
        publicKeyB64: expect.any(String),
        pairingId: 'pairing-1',
        pairingProof: expect.any(String),
      })
    );
  });

  it('hands the sidebar off after pairing is accepted', async () => {
    const transport = new FakeCrossTabTransport();
    render(
      <ControllerChannelProvider transport={transport} pairing={TEST_PAIRING}>
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
    const transport = new FakeCrossTabTransport();
    render(
      <ControllerChannelProvider transport={transport} pairing={TEST_PAIRING}>
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
    const transport = new FakeCrossTabTransport();
    render(
      <ControllerChannelProvider transport={transport} pairing={TEST_PAIRING}>
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
    const transport = new FakeCrossTabTransport();
    render(
      <ControllerChannelProvider transport={transport} pairing={TEST_PAIRING}>
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
      transport.emit({
        source: 'pathfinder',
        senderId: 'live',
        timestamp: 0,
        kind: 'pairing-accept',
        sessionId: 'x',
        pairingId: TEST_PAIRING.pairingId,
        acceptProof: 'ignored-already-paired',
      })
    );
    act(() => transport.emit(liveHeartbeat()));

    expect(
      transport.postedMessages.filter((m) => (m as any)?.kind === 'sidebar-handoff' && (m as any)?.action === 'close')
    ).toHaveLength(1);
  });

  it('ignores a forged pairing-accept and still pairs with the genuine live tab', async () => {
    const transport = new FakeCrossTabTransport();
    render(
      <ControllerChannelProvider transport={transport} pairing={TEST_PAIRING}>
        <Probe />
      </ControllerChannelProvider>
    );

    const challenge = await waitForPostedOfKind(transport, 'pairing-challenge');
    act(() =>
      transport.emit({
        source: 'pathfinder',
        senderId: 'attacker',
        timestamp: 0,
        kind: 'pairing-accept',
        sessionId: challenge.sessionId,
        pairingId: TEST_PAIRING.pairingId,
        acceptProof: 'forged',
      })
    );

    await pairWithLive(transport, 'live');

    fireEvent.click(screen.getByText('post'));
    await waitFor(() =>
      expect(transport.postedMessages).toContainEqual(
        expect.objectContaining({ ...signedFieldsFor('live'), kind: 'step-command' })
      )
    );
  });

  it('drops heartbeat-only pairing attempts', () => {
    const transport = new FakeCrossTabTransport();
    render(
      <ControllerChannelProvider transport={transport} pairing={TEST_PAIRING}>
        <Probe />
      </ControllerChannelProvider>
    );

    act(() => transport.emit(liveHeartbeat()));
    fireEvent.click(screen.getByText('post'));

    expect(postedOfKind(transport, 'step-command')).toBeUndefined();
  });

  it('resolves requestRequirementCheck with the live tab reply', async () => {
    const transport = new FakeCrossTabTransport();
    render(
      <ControllerChannelProvider transport={transport} pairing={TEST_PAIRING}>
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
    const transport = new FakeCrossTabTransport();
    render(
      <ControllerChannelProvider transport={transport} pairing={TEST_PAIRING}>
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

  it('resolves an in-flight requestFix with the fix fallback when the provider unmounts', async () => {
    let resolveOutcome: ((value: string) => void) | undefined;
    const outcome = new Promise<string>((resolve) => {
      resolveOutcome = resolve;
    });

    function PendingFixProbe() {
      const channel = useControllerChannel();

      return (
        <button
          onClick={() =>
            channel
              ?.requestFix('s1', { requirements: 'navmenu-open', fixType: 'navigation' })
              .then((result) => resolveOutcome?.(`ok:${result.ok}`))
          }
        >
          fix
        </button>
      );
    }

    const transport = new FakeCrossTabTransport();
    const { unmount } = render(
      <ControllerChannelProvider transport={transport} pairing={TEST_PAIRING}>
        <PendingFixProbe />
      </ControllerChannelProvider>
    );

    await pairWithLive(transport);

    fireEvent.click(screen.getByText('fix'));
    await waitForPostedOfKind(transport, 'fix-requirement');

    unmount();

    await expect(outcome).resolves.toBe('ok:false');
  });

  it('falls back to null when no live tab answers within the timeout', async () => {
    jest.useFakeTimers();
    try {
      const transport = new FakeCrossTabTransport();
      render(
        <ControllerChannelProvider transport={transport} pairing={TEST_PAIRING}>
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
    const transport = new FakeCrossTabTransport();
    render(
      <ControllerChannelProvider transport={transport} pairing={TEST_PAIRING}>
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
    const transport = new FakeCrossTabTransport();
    render(
      <ControllerChannelProvider transport={transport} pairing={TEST_PAIRING}>
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
    const transport = new FakeCrossTabTransport();
    render(
      <ControllerChannelProvider transport={transport} pairing={TEST_PAIRING}>
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
    const transport = new FakeCrossTabTransport();
    render(
      <ControllerChannelProvider transport={transport} pairing={TEST_PAIRING}>
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
    const transport = new FakeCrossTabTransport();
    render(
      <ControllerChannelProvider transport={transport} pairing={TEST_PAIRING}>
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

  describe('guided evidence', () => {
    const skipped: GuidedSubstepResult = { index: 0, action: 'noop', status: 'skipped', durationMs: 5 };
    const results: GuidedSubstepResult[] = [
      skipped,
      { ...skipped, index: 1, action: 'button' },
      { index: 2, action: 'formfill', status: 'timeout', durationMs: 30_000 },
    ];

    it('publishes cumulative progress and final failure evidence before completion', async () => {
      const { channel, transport, unmount } = await pairedChannel();
      const events: string[] = [];
      const progress = jest.fn((_index: number, _total: number, ledger?: GuidedSubstepResult[]) => {
        events.push(`evidence:${ledger?.length}`);
      });
      channel.onStepProgress('s', 'r', progress);
      const done = channel.awaitStepComplete('s', 'r').then((ok) => {
        events.push(`done:${ok}`);
        unmount();
        return ok;
      });

      act(() => {
        transport.emit(
          stepReply({ kind: 'step-progress', stepId: 's', runId: 'r', index: 0, total: 3, substepResults: [skipped] })
        );
        transport.emit(
          stepReply({
            kind: 'step-progress',
            stepId: 's',
            runId: 'r',
            index: 2,
            total: 3,
            substepResults: results.slice(0, 2),
          })
        );
        transport.emit(
          stepReply({ kind: 'step-complete', stepId: 's', runId: 'r', ok: false, substepResults: results })
        );
      });

      expect(progress).toHaveBeenLastCalledWith(2, 3, results);
      expect(events).toEqual(['evidence:1', 'evidence:2', 'evidence:3']);
      await act(async () => expect(await done).toBe(false));
      expect(events).toEqual(['evidence:1', 'evidence:2', 'evidence:3', 'done:false']);
    });

    it('resolves the completion even when its final evidence subscriber unmounts the provider', async () => {
      const { channel, transport, unmount } = await pairedChannel();
      const progress = jest.fn(() => unmount());
      channel.onStepProgress('s', 'r', progress);
      const done = channel.awaitStepComplete('s', 'r');

      act(() =>
        transport.emit(
          stepReply({ kind: 'step-complete', stepId: 's', runId: 'r', ok: true, substepResults: [skipped] })
        )
      );

      expect(progress).toHaveBeenCalledWith(0, 1, [skipped]);
      await expect(done).resolves.toBe(true);
    });

    it('isolates cancelled runs, foreign senders, and replies after completion', async () => {
      const { channel, transport, unmount } = await pairedChannel();
      const progress = jest.fn();
      channel.onStepProgress('s', 'old', progress);
      const old = channel.awaitStepComplete('s', 'old');
      channel.cancelStepComplete('s', 'old');
      await expect(old).resolves.toBe(false);

      channel.onStepProgress('s', 'new', progress);
      const resolved = jest.fn();
      const done = channel.awaitStepComplete('s', 'new').then(resolved);
      act(() => {
        for (const [runId, sender] of [
          ['old', 'live'],
          ['new', 'other-live'],
        ]) {
          transport.emit(
            stepReply(
              { kind: 'step-progress', stepId: 's', runId: runId!, index: 0, total: 1, substepResults: [skipped] },
              sender
            )
          );
          transport.emit(
            stepReply(
              { kind: 'step-complete', stepId: 's', runId: runId!, ok: true, substepResults: [skipped] },
              sender
            )
          );
        }
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(progress).not.toHaveBeenCalled();
      expect(resolved).not.toHaveBeenCalled();

      act(() =>
        transport.emit(
          stepReply({ kind: 'step-complete', stepId: 's', runId: 'new', ok: true, substepResults: [skipped] })
        )
      );
      await done;
      expect(progress).toHaveBeenCalledTimes(1);
      expect(resolved).toHaveBeenCalledWith(true);

      act(() =>
        transport.emit(
          stepReply({ kind: 'step-progress', stepId: 's', runId: 'new', index: 0, total: 1, substepResults: [] })
        )
      );
      expect(progress).toHaveBeenCalledTimes(1);
      unmount();
    });

    it('rejects oversized completion results before any progress and keeps the waiter active', async () => {
      const { channel, transport, unmount } = await pairedChannel();
      const progress = jest.fn();
      const resolved = jest.fn();
      channel.onStepProgress('s', 'r', progress);
      const done = channel.awaitStepComplete('s', 'r').then(resolved);
      const oversized = Array.from({ length: 1025 }, (_, index) => ({ ...skipped, index }));

      act(() =>
        transport.emit(
          stepReply({ kind: 'step-complete', stepId: 's', runId: 'r', ok: true, substepResults: oversized })
        )
      );
      await act(async () => {
        await Promise.resolve();
      });
      expect(progress).not.toHaveBeenCalled();
      expect(resolved).not.toHaveBeenCalled();

      act(() =>
        transport.emit(
          stepReply({ kind: 'step-complete', stepId: 's', runId: 'r', ok: true, substepResults: [skipped] })
        )
      );
      await done;
      expect(progress).toHaveBeenCalledTimes(1);
      expect(progress).toHaveBeenCalledWith(0, 1, [skipped]);
      expect(resolved).toHaveBeenCalledTimes(1);
      expect(resolved).toHaveBeenCalledWith(true);
      unmount();
    });

    it('rejects malformed ledgers and final results outside the known total', async () => {
      const { channel, transport, unmount } = await pairedChannel();
      const progress = jest.fn();
      const resolved = jest.fn();
      channel.onStepProgress('s', 'r', progress);
      const done = channel.awaitStepComplete('s', 'r').then(resolved);
      act(() => {
        transport.emit(
          stepReply({ kind: 'step-progress', stepId: 's', runId: 'r', index: 0, total: 1, substepResults: [] })
        );
        transport.emit(
          stepReply({
            kind: 'step-complete',
            stepId: 's',
            runId: 'r',
            ok: true,
            substepResults: [skipped, { ...skipped, index: 1 }],
          })
        );
        transport.emit(
          stepReply({
            kind: 'step-complete',
            stepId: 's',
            runId: 'r',
            ok: true,
            substepResults: [{ ...skipped, durationMs: Infinity }],
          })
        );
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(progress).toHaveBeenCalledTimes(1);
      expect(resolved).not.toHaveBeenCalled();

      act(() =>
        transport.emit(
          stepReply({ kind: 'step-complete', stepId: 's', runId: 'r', ok: true, substepResults: [skipped] })
        )
      );
      await done;
      expect(progress).toHaveBeenLastCalledWith(0, 1, [skipped]);
      expect(resolved).toHaveBeenCalledWith(true);
      unmount();
    });

    it('keeps a newer subscription when an older subscription uses the same callback', async () => {
      const { channel, transport, unmount } = await pairedChannel();
      const progress = jest.fn();
      const stopOld = channel.onStepProgress('s', 'r', progress);
      channel.onStepProgress('s', 'r', progress);
      stopOld();
      act(() =>
        transport.emit(
          stepReply({ kind: 'step-progress', stepId: 's', runId: 'r', index: 0, total: 1, substepResults: [skipped] })
        )
      );
      expect(progress).toHaveBeenCalledWith(0, 1, [skipped]);
      unmount();
    });
  });

  it('posts a signed sidebar hand-back on unmount after pairing', async () => {
    const transport = new FakeCrossTabTransport();
    const { unmount } = render(
      <ControllerChannelProvider transport={transport} pairing={TEST_PAIRING}>
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

  it('posts a prepared signed sidebar hand-back synchronously on pagehide', async () => {
    const transport = new FakeCrossTabTransport();
    render(
      <ControllerChannelProvider transport={transport} pairing={TEST_PAIRING}>
        <Probe />
      </ControllerChannelProvider>
    );

    await pairWithLive(transport);
    await waitFor(() =>
      expect(transport.postedMessages).toContainEqual(
        expect.objectContaining({ kind: 'sidebar-handoff', action: 'close', ...signedFieldsFor('live') })
      )
    );

    const before = transport.postedMessages.length;
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(transport.postedMessages.slice(before)).toContainEqual(
      expect.objectContaining({ kind: 'sidebar-handoff', action: 'reopen', ...signedFieldsFor('live') })
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
