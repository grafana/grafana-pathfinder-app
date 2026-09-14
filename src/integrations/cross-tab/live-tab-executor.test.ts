import { waitFor } from '@testing-library/react';
import { getAppEvents } from '@grafana/runtime';
import { installLiveTabExecutor, resetLiveTabExecutorForTests, DEFAULT_PACING } from './live-tab-executor';
import { FocusHandler, ButtonHandler, NavigateHandler, GuidedHandler } from '../../interactive-engine/action-handlers';
import { checkRequirements, dispatchFix } from '../../requirements-manager';
import { sidebarState } from '../../global-state/sidebar';
import { isExtensionSidebarOwnedByOther } from '../../lib/storage/extension-sidebar';
import { FakeCrossTabTransport } from '../../test-utils/fake-cross-tab-transport';
import type { CrossTabAction, CrossTabMessage, StepCommandMessage } from '../../types/cross-tab.types';
import type { GuidedAction, GuidedStepOptions, GuidedSubstepResult } from '../../types/interactive-actions.types';
import { withFaroUserAction } from '../../lib/faro';
import { isInteractiveActionType } from '../../lib/interactive-action';

jest.mock('../../lib/interactive-action', () => {
  const actual = jest.requireActual('../../lib/interactive-action');
  return { ...actual, isInteractiveActionType: jest.fn(actual.isInteractiveActionType) };
});

jest.mock('../../requirements-manager', () => {
  const actual = jest.requireActual('../../requirements-manager');
  return { ...actual, checkRequirements: jest.fn(), dispatchFix: jest.fn() };
});
jest.mock('../../lib/faro', () => ({
  withFaroUserAction: jest.fn((_name: string, _attributes: unknown, work: () => unknown) => work()),
  setFaroUserActionAttributes: jest.fn(),
  USER_ACTION_TIMEOUT_LONG_MS: 600000,
}));

jest.mock('../../interactive-engine/action-handlers', () => {
  const makeHandler = () => ({ execute: jest.fn().mockResolvedValue(undefined) });
  const makeGuided = () => ({
    resetProgress: jest.fn(),
    executeGuidedStep: jest.fn().mockResolvedValue('completed'),
    cancel: jest.fn(),
  });
  return {
    FocusHandler: jest.fn(makeHandler),
    ButtonHandler: jest.fn(makeHandler),
    FormFillHandler: jest.fn(makeHandler),
    HoverHandler: jest.fn(makeHandler),
    NavigateHandler: jest.fn(makeHandler),
    GuidedHandler: jest.fn(makeGuided),
  };
});

jest.mock('@grafana/runtime', () => {
  const actual = jest.requireActual('@grafana/runtime');
  const publish = jest.fn();
  return { ...actual, getAppEvents: jest.fn(() => ({ publish })) };
});

jest.mock('../../global-state/sidebar', () => ({
  sidebarState: { getIsSidebarMounted: jest.fn(() => true), openSidebar: jest.fn() },
}));

jest.mock('../../lib/storage/extension-sidebar', () => {
  const actual = jest.requireActual('../../lib/storage/extension-sidebar');
  return { ...actual, isExtensionSidebarOwnedByOther: jest.fn(() => false) };
});

// Open gate: all side-effecting messages are pre-authorized (for non-auth tests).
const openAuthGate = {
  async verifySignedMessage(): Promise<boolean> {
    return true;
  },
  setPendingChallenge(): void {},
  setOwnLiveTabId(): void {},
  onSessionAccepted(): () => void {
    return () => {};
  },
};

// Closed gate: all side-effecting messages are rejected (negative auth tests).
const closedAuthGate = {
  async verifySignedMessage(): Promise<boolean> {
    return false;
  },
  setPendingChallenge(): void {},
  setOwnLiveTabId(): void {},
  onSessionAccepted(): () => void {
    return () => {};
  },
};

function controllerHeartbeat(): CrossTabMessage {
  return { source: 'pathfinder', senderId: 'controller', timestamp: 0, kind: 'heartbeat', role: 'controller' };
}

function stampStepCommand(
  phase: 'show' | 'do',
  targetAction: string,
  refTarget: string,
  runId = 'run-1'
): CrossTabMessage {
  return {
    source: 'pathfinder',
    senderId: 'controller',
    timestamp: 0,
    kind: 'step-command',
    phase,
    stepId: 's1',
    runId,
    action: { targetAction, refTarget },
  };
}

function stampSidebarHandoff(action: 'close' | 'reopen'): CrossTabMessage {
  return { source: 'pathfinder', senderId: 'controller', timestamp: 0, kind: 'sidebar-handoff', action };
}

function executeOf(handler: unknown): jest.Mock {
  const ctor = handler as jest.Mock;
  return (ctor.mock.results[0]?.value as { execute: jest.Mock }).execute;
}

function guidedMock(): { executeGuidedStep: jest.Mock; resetProgress: jest.Mock; cancel: jest.Mock } {
  return (GuidedHandler as jest.Mock).mock.results[0]?.value;
}

function guidedCommand(
  internalActions: GuidedAction[],
  options: Partial<CrossTabAction> = {},
  runId = 'guided-run'
): StepCommandMessage {
  return {
    source: 'pathfinder',
    senderId: 'controller',
    timestamp: 0,
    kind: 'step-command',
    phase: 'do',
    stepId: 'guided-step',
    runId,
    action: { targetAction: 'guided', refTarget: '', internalActions, ...options },
  };
}

describe('installLiveTabExecutor', () => {
  beforeEach(() => {
    resetLiveTabExecutorForTests();
    jest.clearAllMocks();
    (sidebarState.getIsSidebarMounted as jest.Mock).mockReturnValue(true);
    (isExtensionSidebarOwnedByOther as jest.Mock).mockReturnValue(false);
    (checkRequirements as jest.Mock).mockResolvedValue({ requirements: '', pass: true, error: [] });
    (dispatchFix as jest.Mock).mockResolvedValue({ ok: true });
  });

  it('starts the transport on install and stops it on uninstall', () => {
    const transport = new FakeCrossTabTransport('live-self');
    const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);

    expect(transport.started).toBe(true);
    expect(transport.stopped).toBe(false);

    uninstall();
    expect(transport.stopped).toBe(true);
  });

  it('routes a "do" highlight command to FocusHandler.execute with click=true', async () => {
    const transport = new FakeCrossTabTransport('live-self');
    const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);

    transport.emit(stampStepCommand('do', 'highlight', '#target'));

    await waitFor(() => expect(executeOf(FocusHandler)).toHaveBeenCalled());
    expect(executeOf(FocusHandler)).toHaveBeenCalledWith(
      expect.objectContaining({ refTarget: '#target', targetAction: 'highlight' }),
      true
    );
    expect(withFaroUserAction).toHaveBeenCalledWith(
      'pathfinder_remote_step',
      expect.objectContaining({ target_action: 'highlight', ref_target: '#target', phase: 'do' }),
      expect.any(Function),
      600000
    );
    uninstall();
  });

  it('routes a "show" command to the handler with click=false', async () => {
    const transport = new FakeCrossTabTransport('live-self');
    const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);

    transport.emit(stampStepCommand('show', 'highlight', '#target'));

    await waitFor(() => expect(executeOf(FocusHandler)).toHaveBeenCalled());
    expect(executeOf(FocusHandler)).toHaveBeenCalledWith(expect.objectContaining({ refTarget: '#target' }), false);
    uninstall();
  });

  it('routes button and navigate actions to their handlers', async () => {
    const transport = new FakeCrossTabTransport('live-self');
    const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);

    transport.emit(stampStepCommand('do', 'button', "button[type='submit']"));
    transport.emit(stampStepCommand('do', 'navigate', '/dashboards'));

    await waitFor(() => expect(executeOf(ButtonHandler)).toHaveBeenCalled());
    await waitFor(() => expect(executeOf(NavigateHandler)).toHaveBeenCalled());
    uninstall();
  });

  it('replays a multi-step internalActions sequence in order', async () => {
    const transport = new FakeCrossTabTransport('live-self');
    const uninstall = installLiveTabExecutor(transport, { showToDoMs: 0, settleMs: 0, interStepMs: 0 }, openAuthGate);

    transport.emit({
      source: 'pathfinder',
      senderId: 'controller',
      timestamp: 0,
      kind: 'step-command',
      phase: 'do',
      stepId: 'ms1',
      runId: 'run-1',
      action: {
        targetAction: 'multistep',
        refTarget: '',
        internalActions: [
          { targetAction: 'highlight', refTarget: '#a' },
          { targetAction: 'button', refTarget: '#b' },
        ],
      },
    });

    await waitFor(() => expect(executeOf(FocusHandler)).toHaveBeenCalled());
    await waitFor(() => expect(executeOf(ButtonHandler)).toHaveBeenCalled());
    uninstall();
  });

  // Paired-tab runs replay the command on the live tab. Dropping targetState
  // here would make the live tab blind-click a toggle that the controller-side
  // guide explicitly asked to put in a given state.
  it('carries targetState from the command onto the replayed action', async () => {
    const transport = new FakeCrossTabTransport('live-self');
    const uninstall = installLiveTabExecutor(transport, { showToDoMs: 0, settleMs: 0, interStepMs: 0 }, openAuthGate);

    transport.emit({
      source: 'pathfinder',
      senderId: 'controller',
      timestamp: 0,
      kind: 'step-command',
      phase: 'do',
      stepId: 'toggle-step',
      runId: 'run-1',
      action: { targetAction: 'highlight', refTarget: '#drawer-toggle', targetState: true },
    });

    await waitFor(() => expect(executeOf(FocusHandler)).toHaveBeenCalled());
    expect(executeOf(FocusHandler)).toHaveBeenCalledWith(expect.objectContaining({ targetState: true }), true);
    uninstall();
  });

  // Same guarantee one level down: a composite's internal actions carry the
  // field too, on both the auto-replay path and the guided relay.
  it('carries targetState onto each replayed internal action of a multistep', async () => {
    const transport = new FakeCrossTabTransport('live-self');
    const uninstall = installLiveTabExecutor(transport, { showToDoMs: 0, settleMs: 0, interStepMs: 0 }, openAuthGate);

    transport.emit({
      source: 'pathfinder',
      senderId: 'controller',
      timestamp: 0,
      kind: 'step-command',
      phase: 'do',
      stepId: 'ms-toggle',
      runId: 'run-1',
      action: {
        targetAction: 'multistep',
        refTarget: '',
        internalActions: [{ targetAction: 'highlight', refTarget: '#drawer-toggle', targetState: true }],
      },
    });

    await waitFor(() => expect(executeOf(FocusHandler)).toHaveBeenCalledTimes(2));
    expect(executeOf(FocusHandler)).toHaveBeenNthCalledWith(1, expect.objectContaining({ targetState: true }), false);
    expect(executeOf(FocusHandler)).toHaveBeenNthCalledWith(2, expect.objectContaining({ targetState: true }), true);
    uninstall();
  });

  it('carries targetState onto each guided step handed to the guided handler', async () => {
    const transport = new FakeCrossTabTransport('live-self');
    const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);

    transport.emit({
      source: 'pathfinder',
      senderId: 'controller',
      timestamp: 0,
      kind: 'step-command',
      phase: 'do',
      stepId: 'g-toggle',
      runId: 'run-g-toggle',
      action: {
        targetAction: 'guided',
        refTarget: '',
        internalActions: [{ targetAction: 'button', refTarget: '#explain', targetState: 'aria-expanded:true' }],
      },
    });

    const executeGuidedStep = (GuidedHandler as jest.Mock).mock.results[0]?.value.executeGuidedStep as jest.Mock;
    await waitFor(() => expect(executeGuidedStep).toHaveBeenCalled());
    expect(executeGuidedStep).toHaveBeenCalledWith(
      expect.objectContaining({ targetState: 'aria-expanded:true' }),
      0,
      1,
      120_000,
      undefined,
      expect.objectContaining({ checkRequirements: expect.any(Function), onSettled: expect.any(Function) })
    );
    uninstall();
  });

  describe('guided substep contract', () => {
    it.each([
      [30_000, 30_000],
      [45_000, 45_000],
      [60_000, 60_000],
      [undefined, 120_000],
    ])('forwards the authored timeout %s as %s', async (stepTimeout, expected) => {
      const transport = new FakeCrossTabTransport('live-self');
      const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);
      const action: GuidedAction = { targetAction: 'noop', targetComment: 'Read the instructions.' };
      transport.emit(guidedCommand([action], { stepTimeout }));

      await waitFor(() => expect(guidedMock().executeGuidedStep).toHaveBeenCalledTimes(1));
      expect(guidedMock().executeGuidedStep).toHaveBeenCalledWith(
        action,
        0,
        1,
        expected,
        undefined,
        expect.objectContaining({ checkRequirements: expect.any(Function), onSettled: expect.any(Function) })
      );
      uninstall();
    });

    it('preserves every guided field and uses explicit scope for requirement checks', async () => {
      const transport = new FakeCrossTabTransport('live-self');
      const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);
      const action: GuidedAction = {
        targetAction: 'formfill',
        refTarget: '#query',
        targetValue: 'up',
        targetState: 'aria-expanded:true',
        requirements: ['var-ready:true', 'section-completed:intro'],
        targetComment: 'Enter the query.',
        isSkippable: false,
        formHint: 'Use a metric name.',
        validateInput: true,
        lazyRender: true,
        scrollContainer: '#panels',
      };
      transport.emit(guidedCommand([action], { guideId: 'guide-a', contentKey: 'content-a', stepTimeout: 45_000 }));
      await waitFor(() => expect(guidedMock().executeGuidedStep).toHaveBeenCalled());
      const call = guidedMock().executeGuidedStep.mock.calls[0]!;
      expect(call[0]).toEqual(action);
      const options = call[5] as GuidedStepOptions;
      const checkedAction = { ...action, lazyRender: false };
      await options.checkRequirements!(checkedAction);
      expect(checkRequirements).toHaveBeenCalledWith({
        requirements: action.requirements,
        targetAction: 'formfill',
        refTarget: '#query',
        targetValue: 'up',
        lazyRender: false,
        scrollContainer: '#panels',
        guideId: 'guide-a',
        contentKey: 'content-a',
        stepId: 'guided-step',
        maxRetries: 0,
      });
      uninstall();
    });

    it.each(['timeout', 'cancelled', 'error'] as const)(
      'preserves consecutive skips and the final %s result',
      async (status) => {
        const transport = new FakeCrossTabTransport('live-self');
        const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);
        const actions: GuidedAction[] = [
          { targetAction: 'noop', isSkippable: true },
          { targetAction: 'button', refTarget: '#optional', isSkippable: true },
          { targetAction: 'formfill', refTarget: '#required' },
          { targetAction: 'highlight', refTarget: '#not-reached' },
        ];
        const results: GuidedSubstepResult[] = [
          { index: 0, action: 'noop', status: 'skipped', durationMs: 10 },
          { index: 1, action: 'button', status: 'skipped', durationMs: 20 },
          { index: 2, action: 'formfill', status, durationMs: 30_000 },
        ];
        guidedMock().executeGuidedStep.mockImplementation(
          async (_action, index, _total, _timeout, _onCompleted, options: GuidedStepOptions) => {
            const result = results[index]!;
            options.onSettled!(result);
            return result.status;
          }
        );
        transport.emit(guidedCommand(actions));

        await waitFor(() =>
          expect(transport.postedMessages).toContainEqual({
            kind: 'step-complete',
            stepId: 'guided-step',
            runId: 'guided-run',
            ok: false,
            substepResults: results,
          })
        );
        const progress = transport.postedMessages.filter(
          (message): message is { kind: string; index: number; substepResults: GuidedSubstepResult[] } =>
            (message as { kind: string }).kind === 'step-progress'
        );
        expect(progress.map(({ index, substepResults }) => [index, substepResults.length])).toEqual([
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 2],
          [2, 2],
          [2, 3],
        ]);
        expect(progress[0]!.substepResults).toEqual([]);
        expect(progress[1]!.substepResults).toEqual(results.slice(0, 1));
        expect(guidedMock().executeGuidedStep).toHaveBeenCalledTimes(3);
        uninstall();
      }
    );

    it('replaces a settlement correction instead of sending a duplicate index', async () => {
      const transport = new FakeCrossTabTransport('live-self');
      const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);
      const result: GuidedSubstepResult = { index: 0, action: 'noop', status: 'completed', durationMs: 1 };
      guidedMock().executeGuidedStep.mockImplementationOnce(
        async (_a, _i, _total, _timeout, _completed, options: GuidedStepOptions) => {
          options.onSettled!(result);
          options.onSettled!({ ...result, status: 'error' });
          return 'error';
        }
      );
      transport.emit(guidedCommand([{ targetAction: 'noop' }]));
      await waitFor(() =>
        expect(transport.postedMessages).toContainEqual({
          kind: 'step-complete',
          stepId: 'guided-step',
          runId: 'guided-run',
          ok: false,
          substepResults: [{ ...result, status: 'error' }],
        })
      );
      uninstall();
    });

    it('retains settled evidence when a later handler call throws', async () => {
      const transport = new FakeCrossTabTransport('live-self');
      const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);
      const first: GuidedSubstepResult = { index: 0, action: 'noop', status: 'skipped', durationMs: 1 };
      guidedMock()
        .executeGuidedStep.mockImplementationOnce(
          async (_a, _i, _total, _timeout, _completed, options: GuidedStepOptions) => {
            options.onSettled!(first);
            return 'skipped';
          }
        )
        .mockRejectedValueOnce(new Error('handler failed'));
      transport.emit(guidedCommand([{ targetAction: 'noop' }, { targetAction: 'button', refTarget: '#missing' }]));
      await waitFor(() =>
        expect(transport.postedMessages).toContainEqual({
          kind: 'step-complete',
          stepId: 'guided-step',
          runId: 'guided-run',
          ok: false,
          substepResults: [first],
        })
      );
      uninstall();
    });

    it('keeps scope and evidence separate for queued runs', async () => {
      const transport = new FakeCrossTabTransport('live-self');
      const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);
      let finishFirst!: () => void;
      const result: GuidedSubstepResult = { index: 0, action: 'noop', status: 'completed', durationMs: 5 };
      guidedMock()
        .executeGuidedStep.mockImplementationOnce(
          (action: GuidedAction, _index, _total, _timeout, _completed, options: GuidedStepOptions) =>
            new Promise((resolve) => {
              finishFirst = () => {
                void options.checkRequirements!(action).then(() => {
                  options.onSettled!(result);
                  resolve('completed');
                });
              };
            })
        )
        .mockImplementationOnce(
          async (action: GuidedAction, _i, _total, _timeout, _completed, options: GuidedStepOptions) => {
            await options.checkRequirements!(action);
            options.onSettled!(result);
            return 'completed';
          }
        );
      transport.emit(
        guidedCommand([{ targetAction: 'noop' }], { guideId: 'guide-a', contentKey: 'content-a' }, 'run-a')
      );
      transport.emit(
        guidedCommand([{ targetAction: 'noop' }], { guideId: 'guide-b', contentKey: 'content-b' }, 'run-b')
      );

      await waitFor(() => expect(guidedMock().executeGuidedStep).toHaveBeenCalledTimes(1));
      finishFirst();
      await waitFor(() =>
        expect(transport.postedMessages).toContainEqual({
          kind: 'step-complete',
          stepId: 'guided-step',
          runId: 'run-b',
          ok: true,
          substepResults: [result],
        })
      );
      expect(checkRequirements).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ guideId: 'guide-a', contentKey: 'content-a' })
      );
      expect(checkRequirements).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ guideId: 'guide-b', contentKey: 'content-b' })
      );
      expect(transport.postedMessages).toContainEqual(
        expect.objectContaining({ kind: 'step-progress', runId: 'run-b', substepResults: [] })
      );
      expect(guidedMock().resetProgress).toHaveBeenCalledTimes(2);
      uninstall();
    });

    it('cancels the active handler on teardown without starting another substep or queued run', async () => {
      const transport = new FakeCrossTabTransport('live-self');
      const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);
      const cancelled: GuidedSubstepResult = { index: 0, action: 'noop', status: 'cancelled', durationMs: 1 };
      guidedMock().executeGuidedStep.mockImplementationOnce(
        (_action, _index, _total, _timeout, _completed, options: GuidedStepOptions) =>
          new Promise((resolve) => {
            guidedMock().cancel.mockImplementationOnce(() => {
              options.onSettled!(cancelled);
              resolve('completed');
            });
          })
      );
      transport.emit(guidedCommand([{ targetAction: 'noop' }, { targetAction: 'button', refTarget: '#never' }]));
      transport.emit(guidedCommand([{ targetAction: 'noop' }], {}, 'queued-run'));
      await waitFor(() => expect(guidedMock().executeGuidedStep).toHaveBeenCalledTimes(1));
      uninstall();
      await Promise.resolve();
      await Promise.resolve();
      expect(guidedMock().cancel).toHaveBeenCalledTimes(1);
      expect(guidedMock().executeGuidedStep).toHaveBeenCalledTimes(1);
      expect(transport.postedMessages).toContainEqual(
        expect.objectContaining({ kind: 'step-progress', runId: 'guided-run', substepResults: [cancelled] })
      );
      expect(transport.postedMessages).not.toContainEqual(expect.objectContaining({ runId: 'queued-run' }));
    });

    it.each([
      { requirements: ['is-admin', {}] },
      { lazyRender: 'true' },
      { scrollContainer: [] },
      { isSkippable: 1 },
      { formHint: {} },
      { validateInput: null },
    ])('rejects malformed guided fields before authentication %#', async (invalid) => {
      const transport = new FakeCrossTabTransport('live-self');
      const gate = { ...openAuthGate, verifySignedMessage: jest.fn().mockResolvedValue(true) };
      const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, gate);
      const message = guidedCommand([{ targetAction: 'noop' }]);
      message.action.internalActions = [{ targetAction: 'noop', ...invalid }] as CrossTabAction[];
      transport.emit(message);
      await Promise.resolve();
      expect(gate.verifySignedMessage).not.toHaveBeenCalled();
      expect(guidedMock().executeGuidedStep).not.toHaveBeenCalled();
      expect(checkRequirements).not.toHaveBeenCalled();
      uninstall();
    });
  });

  it('paces each composite action through show then do', async () => {
    const transport = new FakeCrossTabTransport('live-self');
    const uninstall = installLiveTabExecutor(transport, { showToDoMs: 0, settleMs: 0, interStepMs: 0 }, openAuthGate);

    transport.emit({
      source: 'pathfinder',
      senderId: 'controller',
      timestamp: 0,
      kind: 'step-command',
      phase: 'do',
      stepId: 'ms1',
      runId: 'run-1',
      action: {
        targetAction: 'multistep',
        refTarget: '',
        internalActions: [{ targetAction: 'highlight', refTarget: '#a' }],
      },
    });

    await waitFor(() => expect(executeOf(FocusHandler)).toHaveBeenCalledTimes(2));
    expect(executeOf(FocusHandler)).toHaveBeenNthCalledWith(1, expect.objectContaining({ refTarget: '#a' }), false);
    expect(executeOf(FocusHandler)).toHaveBeenNthCalledWith(2, expect.objectContaining({ refTarget: '#a' }), true);
    uninstall();
  });

  it('runs a guided command through the guided handler, not the auto replay', async () => {
    const transport = new FakeCrossTabTransport('live-self');
    const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);

    transport.emit({
      source: 'pathfinder',
      senderId: 'controller',
      timestamp: 0,
      kind: 'step-command',
      phase: 'do',
      stepId: 'g1',
      runId: 'run-g1',
      action: {
        targetAction: 'guided',
        refTarget: '',
        internalActions: [
          { targetAction: 'highlight', refTarget: '#a' },
          { targetAction: 'button', refTarget: '#b' },
        ],
      },
    });

    const executeGuidedStep = (GuidedHandler as jest.Mock).mock.results[0]?.value.executeGuidedStep as jest.Mock;
    await waitFor(() => expect(executeGuidedStep).toHaveBeenCalledTimes(2));
    // Guided waits for the user — it must NOT auto-perform via the action handlers.
    expect(executeOf(FocusHandler)).not.toHaveBeenCalled();
    expect(executeOf(ButtonHandler)).not.toHaveBeenCalled();
    // And it reports completion so the controller doesn't mark the step done early.
    await waitFor(() =>
      expect(transport.postedMessages).toContainEqual(
        expect.objectContaining({ kind: 'step-complete', stepId: 'g1', runId: 'run-g1', ok: true })
      )
    );
    uninstall();
  });

  it('posts step-progress for each action during a multi-step replay', async () => {
    const transport = new FakeCrossTabTransport('live-self');
    const uninstall = installLiveTabExecutor(transport, { showToDoMs: 0, settleMs: 0, interStepMs: 0 }, openAuthGate);

    transport.emit({
      source: 'pathfinder',
      senderId: 'controller',
      timestamp: 0,
      kind: 'step-command',
      phase: 'do',
      stepId: 'ms3',
      runId: 'run-ms3',
      action: {
        targetAction: 'multistep',
        refTarget: '',
        internalActions: [
          { targetAction: 'highlight', refTarget: '#a' },
          { targetAction: 'button', refTarget: '#b' },
        ],
      },
    });

    await waitFor(() =>
      expect(transport.postedMessages).toContainEqual(
        expect.objectContaining({ kind: 'step-progress', stepId: 'ms3', runId: 'run-ms3', index: 0, total: 2 })
      )
    );
    await waitFor(() =>
      expect(transport.postedMessages).toContainEqual(
        expect.objectContaining({ kind: 'step-progress', stepId: 'ms3', runId: 'run-ms3', index: 1, total: 2 })
      )
    );
    uninstall();
  });

  it('echoes the runId from step-command in step-complete and step-progress replies', async () => {
    const transport = new FakeCrossTabTransport('live-self');
    const uninstall = installLiveTabExecutor(transport, { showToDoMs: 0, settleMs: 0, interStepMs: 0 }, openAuthGate);

    transport.emit({
      source: 'pathfinder',
      senderId: 'controller',
      timestamp: 0,
      kind: 'step-command',
      phase: 'do',
      stepId: 'echo-step',
      runId: 'echo-run-42',
      action: {
        targetAction: 'multistep',
        refTarget: '',
        internalActions: [{ targetAction: 'highlight', refTarget: '#a' }],
      },
    });

    await waitFor(() =>
      expect(transport.postedMessages).toContainEqual(
        expect.objectContaining({ kind: 'step-progress', stepId: 'echo-step', runId: 'echo-run-42' })
      )
    );
    await waitFor(() =>
      expect(transport.postedMessages).toContainEqual(
        expect.objectContaining({ kind: 'step-complete', stepId: 'echo-step', runId: 'echo-run-42', ok: true })
      )
    );
    uninstall();
  });

  it('posts step-complete after a multi-step replay finishes', async () => {
    const transport = new FakeCrossTabTransport('live-self');
    const uninstall = installLiveTabExecutor(transport, { showToDoMs: 0, settleMs: 0, interStepMs: 0 }, openAuthGate);

    transport.emit({
      source: 'pathfinder',
      senderId: 'controller',
      timestamp: 0,
      kind: 'step-command',
      phase: 'do',
      stepId: 'ms2',
      runId: 'run-ms2',
      action: {
        targetAction: 'multistep',
        refTarget: '',
        internalActions: [{ targetAction: 'highlight', refTarget: '#a' }],
      },
    });

    await waitFor(() =>
      expect(transport.postedMessages).toContainEqual(
        expect.objectContaining({ kind: 'step-complete', stepId: 'ms2', runId: 'run-ms2', ok: true })
      )
    );
    uninstall();
  });

  it('rejects an unsupported internal action at runAction without routing it', async () => {
    const transport = new FakeCrossTabTransport('live-self');
    const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);
    (isInteractiveActionType as unknown as jest.Mock).mockReturnValueOnce(false);

    transport.emit(stampStepCommand('do', 'highlight', '#x'));

    await waitFor(() => expect(isInteractiveActionType).toHaveBeenCalledWith('highlight'));
    expect(executeOf(FocusHandler)).not.toHaveBeenCalled();
    expect(executeOf(ButtonHandler)).not.toHaveBeenCalled();
    uninstall();
  });

  it('responds to a controller heartbeat with a live heartbeat', () => {
    const transport = new FakeCrossTabTransport('live-self');
    const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);

    transport.emit(controllerHeartbeat());

    expect(transport.postedMessages).toContainEqual({ kind: 'heartbeat', role: 'live' });
    uninstall();
  });

  it('closes the live-tab sidebar when a controller takes over', async () => {
    const transport = new FakeCrossTabTransport('live-self');
    const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);

    transport.emit(stampSidebarHandoff('close'));

    await waitFor(() =>
      expect(getAppEvents().publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'close-extension-sidebar' }))
    );
    uninstall();
  });

  it('reopens the sidebar when the controller leaves and the slot is free', async () => {
    const transport = new FakeCrossTabTransport('live-self');
    const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);

    transport.emit(stampSidebarHandoff('close'));
    transport.emit(stampSidebarHandoff('reopen'));

    await waitFor(() => expect(sidebarState.openSidebar).toHaveBeenCalled());
    uninstall();
  });

  it('does not reopen when another plugin occupies the sidebar', async () => {
    (isExtensionSidebarOwnedByOther as jest.Mock).mockReturnValue(true);
    const transport = new FakeCrossTabTransport('live-self');
    const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);

    transport.emit(stampSidebarHandoff('close'));
    transport.emit(stampSidebarHandoff('reopen'));

    await Promise.resolve();
    await Promise.resolve();
    expect(sidebarState.openSidebar).not.toHaveBeenCalled();
    uninstall();
  });

  it('evaluates a check-requirements request against the live tab and replies', async () => {
    (checkRequirements as jest.Mock).mockResolvedValue({
      requirements: 'navmenu-open',
      pass: false,
      error: [{ requirement: 'navmenu-open', pass: false, canFix: true, fixType: 'navigation' }],
    });
    const transport = new FakeCrossTabTransport('live-self');
    const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);

    transport.emit({
      source: 'pathfinder',
      senderId: 'controller',
      timestamp: 0,
      kind: 'check-requirements',
      requestId: 'r1',
      stepId: 's1',
      requirements: 'navmenu-open',
    });

    await waitFor(() =>
      expect(checkRequirements).toHaveBeenCalledWith(expect.objectContaining({ requirements: 'navmenu-open' }))
    );
    await waitFor(() =>
      expect(transport.postedMessages).toContainEqual(
        expect.objectContaining({
          kind: 'requirement-result',
          requestId: 'r1',
          stepId: 's1',
          result: expect.objectContaining({ pass: false }),
        })
      )
    );
    uninstall();
  });
  it('preserves commas in condition arrays on the live tab', async () => {
    (checkRequirements as jest.Mock).mockResolvedValue({
      requirements: ['has-dashboard-named:CPU, memory'],
      pass: false,
      error: [{ requirement: 'navmenu-open', pass: false, canFix: true, fixType: 'navigation' }],
    });
    const transport = new FakeCrossTabTransport('live-self');
    const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);

    transport.emit({
      source: 'pathfinder',
      senderId: 'controller',
      timestamp: 0,
      kind: 'check-requirements',
      requestId: 'r1',
      stepId: 's1',
      requirements: ['has-dashboard-named:CPU, memory'],
    });

    await waitFor(() =>
      expect(checkRequirements).toHaveBeenCalledWith(
        expect.objectContaining({ requirements: ['has-dashboard-named:CPU, memory'] })
      )
    );
    await waitFor(() =>
      expect(transport.postedMessages).toContainEqual(
        expect.objectContaining({
          kind: 'requirement-result',
          requestId: 'r1',
          stepId: 's1',
          result: expect.objectContaining({ pass: false }),
        })
      )
    );
    uninstall();
  });

  it('runs a fix-requirement against the live tab and replies with the outcome', async () => {
    (dispatchFix as jest.Mock).mockResolvedValue({ ok: true });
    const transport = new FakeCrossTabTransport('live-self');
    const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);

    transport.emit({
      source: 'pathfinder',
      senderId: 'controller',
      timestamp: 0,
      kind: 'fix-requirement',
      requestId: 'f1',
      stepId: 's1',
      requirements: 'navmenu-open',
      fixType: 'navigation',
    });

    await waitFor(() =>
      expect(dispatchFix).toHaveBeenCalledWith(
        expect.objectContaining({ fixType: 'navigation', requirements: 'navmenu-open' })
      )
    );
    await waitFor(() =>
      expect(transport.postedMessages).toContainEqual(
        expect.objectContaining({ kind: 'fix-result', requestId: 'f1', stepId: 's1', ok: true })
      )
    );
    uninstall();
  });

  it('replies with a failed fix-result when the live-tab fix throws', async () => {
    (dispatchFix as jest.Mock).mockRejectedValue(new Error('boom'));
    const transport = new FakeCrossTabTransport('live-self');
    const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);

    transport.emit({
      source: 'pathfinder',
      senderId: 'controller',
      timestamp: 0,
      kind: 'fix-requirement',
      requestId: 'f2',
      stepId: 's1',
      requirements: 'navmenu-open',
      fixType: 'navigation',
    });

    await waitFor(() =>
      expect(transport.postedMessages).toContainEqual(
        expect.objectContaining({ kind: 'fix-result', requestId: 'f2', ok: false })
      )
    );
    uninstall();
  });

  it('only installs once until uninstalled', () => {
    const first = new FakeCrossTabTransport('live-self');
    const second = new FakeCrossTabTransport('live-self');
    const uninstall = installLiveTabExecutor(first, DEFAULT_PACING, openAuthGate);
    installLiveTabExecutor(second, DEFAULT_PACING, openAuthGate);

    expect(first.started).toBe(true);
    expect(second.started).toBe(false);
    uninstall();
  });

  it('does not brick the executor if a handler constructor throws (NEW-1064-1)', () => {
    (ButtonHandler as unknown as jest.Mock).mockImplementationOnce(() => {
      throw new Error('constructor boom');
    });
    const first = new FakeCrossTabTransport('live-self');
    expect(() => installLiveTabExecutor(first, DEFAULT_PACING, openAuthGate)).toThrow('constructor boom');
    expect(first.started).toBe(false);

    // installed stayed false, so a later init installs cleanly rather than
    // being permanently blocked by the failed attempt.
    const second = new FakeCrossTabTransport('live-self');
    const uninstall = installLiveTabExecutor(second, DEFAULT_PACING, openAuthGate);
    expect(second.started).toBe(true);
    uninstall();
  });

  it('does not execute commands delivered after uninstall (NEW-1064-2)', async () => {
    const transport = new FakeCrossTabTransport('live-self');
    const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);
    uninstall();

    transport.emit(stampStepCommand('do', 'highlight', '#target'));
    await Promise.resolve();

    expect(executeOf(FocusHandler)).not.toHaveBeenCalled();
  });

  it('drops a command with an unrecognized action at the sink (T1 defense in depth)', async () => {
    const transport = new FakeCrossTabTransport('live-self');
    const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);

    const forged = {
      ...stampStepCommand('do', 'highlight', '#t'),
      action: { targetAction: 'exec', refTarget: '#t' },
    } as CrossTabMessage;
    transport.emit(forged);
    await Promise.resolve();

    expect(executeOf(FocusHandler)).not.toHaveBeenCalled();
    uninstall();
  });

  it('drops a forged fix-requirement missing required fields without dispatching a fix (T1 / security gate)', async () => {
    const transport = new FakeCrossTabTransport('live-self');
    const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);

    // fix-requirement is the highest-risk kind — runRemoteFix → dispatchFix
    // performs navigation / DOM mutation on the authenticated live tab. A message
    // missing the required `requirements` string must be dropped at the gate, so
    // dispatchFix is never reached and no fix-result is posted back.
    const forged = {
      source: 'pathfinder',
      senderId: 'attacker',
      timestamp: 0,
      kind: 'fix-requirement',
      requestId: 'x1',
      stepId: 's1',
      fixType: 'navigation',
    } as unknown as CrossTabMessage;
    transport.emit(forged);
    await Promise.resolve();

    expect(dispatchFix).not.toHaveBeenCalled();
    expect(transport.postedMessages).not.toContainEqual(expect.objectContaining({ kind: 'fix-result' }));
    uninstall();
  });

  it('drops a forged check-requirements missing required fields without probing the DOM (T1 / security gate)', async () => {
    const transport = new FakeCrossTabTransport('live-self');
    const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);

    const forged = {
      source: 'pathfinder',
      senderId: 'attacker',
      timestamp: 0,
      kind: 'check-requirements',
      requestId: 'x2',
      stepId: 's1',
    } as unknown as CrossTabMessage;
    transport.emit(forged);
    await Promise.resolve();

    expect(checkRequirements).not.toHaveBeenCalled();
    expect(transport.postedMessages).not.toContainEqual(expect.objectContaining({ kind: 'requirement-result' }));
    uninstall();
  });

  describe('auth gate — side-effecting commands require verified session', () => {
    it('drops step-command from an unpaired sender (closed gate)', async () => {
      const transport = new FakeCrossTabTransport('live-self');
      const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, closedAuthGate);

      transport.emit(stampStepCommand('do', 'highlight', '#t'));
      await Promise.resolve();

      expect(executeOf(FocusHandler)).not.toHaveBeenCalled();
      uninstall();
    });

    it('drops check-requirements from unpaired sender (closed gate)', async () => {
      const transport = new FakeCrossTabTransport('live-self');
      const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, closedAuthGate);

      transport.emit({
        source: 'pathfinder',
        senderId: 'attacker',
        timestamp: 0,
        kind: 'check-requirements',
        requestId: 'r1',
        stepId: 's1',
        requirements: 'navmenu-open',
      });
      await Promise.resolve();

      expect(checkRequirements).not.toHaveBeenCalled();
      uninstall();
    });

    it('drops fix-requirement from unpaired sender (closed gate)', async () => {
      const transport = new FakeCrossTabTransport('live-self');
      const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, closedAuthGate);

      transport.emit({
        source: 'pathfinder',
        senderId: 'attacker',
        timestamp: 0,
        kind: 'fix-requirement',
        requestId: 'f1',
        stepId: 's1',
        requirements: 'navmenu-open',
        fixType: 'navigation',
      });
      await Promise.resolve();

      expect(dispatchFix).not.toHaveBeenCalled();
      uninstall();
    });

    it('executes step-command from a verified session (open gate)', async () => {
      const transport = new FakeCrossTabTransport('live-self');
      const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);

      transport.emit(stampStepCommand('do', 'highlight', '#t'));

      await waitFor(() => expect(executeOf(FocusHandler)).toHaveBeenCalled());
      uninstall();
    });

    it('executes check-requirements from a verified session (open gate)', async () => {
      const transport = new FakeCrossTabTransport('live-self');
      const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);

      transport.emit({
        source: 'pathfinder',
        senderId: 'controller',
        timestamp: 0,
        kind: 'check-requirements',
        requestId: 'r2',
        stepId: 's2',
        requirements: 'navmenu-open',
      });

      await waitFor(() => expect(checkRequirements).toHaveBeenCalled());
      uninstall();
    });

    it('executes fix-requirement from a verified session (open gate)', async () => {
      const transport = new FakeCrossTabTransport('live-self');
      const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);

      transport.emit({
        source: 'pathfinder',
        senderId: 'controller',
        timestamp: 0,
        kind: 'fix-requirement',
        requestId: 'f2',
        stepId: 's2',
        requirements: 'navmenu-open',
        fixType: 'navigation',
      });

      await waitFor(() => expect(dispatchFix).toHaveBeenCalled());
      uninstall();
    });

    it('stores pending challenge when pairing-challenge arrives', () => {
      const challenges: unknown[] = [];
      const gate = {
        async verifySignedMessage(): Promise<boolean> {
          return false;
        },
        setPendingChallenge(c: unknown): void {
          challenges.push(c);
        },
        setOwnLiveTabId(): void {},
        onSessionAccepted(): () => void {
          return () => {};
        },
      };
      const transport = new FakeCrossTabTransport('live-self');
      const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, gate);

      transport.emit({
        source: 'pathfinder',
        senderId: 'ctrl-1',
        timestamp: 0,
        kind: 'pairing-challenge',
        sessionId: 'sess-1',
        publicKeyB64: 'abc123',
        pairingId: 'pairing-1',
        pairingProof: 'proof-1',
      } as CrossTabMessage);

      expect(challenges).toHaveLength(1);
      expect(challenges[0]).toMatchObject({
        sessionId: 'sess-1',
        publicKeyB64: 'abc123',
        senderTabId: 'ctrl-1',
        pairingId: 'pairing-1',
        pairingProof: 'proof-1',
      });
      uninstall();
    });

    it('heartbeat from controller replies without auth check', () => {
      const transport = new FakeCrossTabTransport('live-self');
      const uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, closedAuthGate);

      transport.emit(controllerHeartbeat());

      expect(transport.postedMessages).toContainEqual({ kind: 'heartbeat', role: 'live' });
      uninstall();
    });
  });
});
