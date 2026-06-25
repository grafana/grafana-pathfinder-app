import { waitFor } from '@testing-library/react';
import { getAppEvents } from '@grafana/runtime';
import { installLiveTabExecutor, resetLiveTabExecutorForTests } from './live-tab-executor';
import { FocusHandler, ButtonHandler, NavigateHandler, GuidedHandler } from '../../interactive-engine/action-handlers';
import { checkRequirements, dispatchFix } from '../../requirements-manager';
import { sidebarState } from '../../global-state/sidebar';
import { isExtensionSidebarOwnedByOther } from '../../utils/experiments/experiment-utils';
import type { CrossTabMessage } from '../../types/cross-tab.types';

jest.mock('../../requirements-manager', () => {
  const actual = jest.requireActual('../../requirements-manager');
  return { ...actual, checkRequirements: jest.fn(), dispatchFix: jest.fn() };
});

jest.mock('../../interactive-engine/action-handlers', () => {
  const makeHandler = () => ({ execute: jest.fn().mockResolvedValue(undefined) });
  const makeGuided = () => ({
    resetProgress: jest.fn(),
    executeGuidedStep: jest.fn().mockResolvedValue('completed'),
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

jest.mock('../../utils/experiments/experiment-utils', () => {
  const actual = jest.requireActual('../../utils/experiments/experiment-utils');
  return { ...actual, isExtensionSidebarOwnedByOther: jest.fn(() => false) };
});

class FakeTransport {
  started = false;
  stopped = false;
  senderId = 'live-self';
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
    const transport = new FakeTransport();
    const uninstall = installLiveTabExecutor(transport);

    expect(transport.started).toBe(true);
    expect(transport.stopped).toBe(false);

    uninstall();
    expect(transport.stopped).toBe(true);
  });

  it('routes a "do" highlight command to FocusHandler.execute with click=true', async () => {
    const transport = new FakeTransport();
    const uninstall = installLiveTabExecutor(transport);

    transport.emit(stampStepCommand('do', 'highlight', '#target'));

    await waitFor(() => expect(executeOf(FocusHandler)).toHaveBeenCalled());
    expect(executeOf(FocusHandler)).toHaveBeenCalledWith(
      expect.objectContaining({ refTarget: '#target', targetAction: 'highlight' }),
      true
    );
    uninstall();
  });

  it('routes a "show" command to the handler with click=false', async () => {
    const transport = new FakeTransport();
    const uninstall = installLiveTabExecutor(transport);

    transport.emit(stampStepCommand('show', 'highlight', '#target'));

    await waitFor(() => expect(executeOf(FocusHandler)).toHaveBeenCalled());
    expect(executeOf(FocusHandler)).toHaveBeenCalledWith(expect.objectContaining({ refTarget: '#target' }), false);
    uninstall();
  });

  it('routes button and navigate actions to their handlers', async () => {
    const transport = new FakeTransport();
    const uninstall = installLiveTabExecutor(transport);

    transport.emit(stampStepCommand('do', 'button', "button[type='submit']"));
    transport.emit(stampStepCommand('do', 'navigate', '/dashboards'));

    await waitFor(() => expect(executeOf(ButtonHandler)).toHaveBeenCalled());
    await waitFor(() => expect(executeOf(NavigateHandler)).toHaveBeenCalled());
    uninstall();
  });

  it('replays a multi-step internalActions sequence in order', async () => {
    const transport = new FakeTransport();
    const uninstall = installLiveTabExecutor(transport, { showToDoMs: 0, settleMs: 0, interStepMs: 0 });

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

  it('paces each composite action through show then do', async () => {
    const transport = new FakeTransport();
    const uninstall = installLiveTabExecutor(transport, { showToDoMs: 0, settleMs: 0, interStepMs: 0 });

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
    const transport = new FakeTransport();
    const uninstall = installLiveTabExecutor(transport);

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
    const transport = new FakeTransport();
    const uninstall = installLiveTabExecutor(transport, { showToDoMs: 0, settleMs: 0, interStepMs: 0 });

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
    const transport = new FakeTransport();
    const uninstall = installLiveTabExecutor(transport, { showToDoMs: 0, settleMs: 0, interStepMs: 0 });

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
    const transport = new FakeTransport();
    const uninstall = installLiveTabExecutor(transport, { showToDoMs: 0, settleMs: 0, interStepMs: 0 });

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

  it('ignores unsupported actions without throwing or routing', () => {
    const transport = new FakeTransport();
    const uninstall = installLiveTabExecutor(transport);

    expect(() => transport.emit(stampStepCommand('do', 'multistep', '#x'))).not.toThrow();
    expect(executeOf(FocusHandler)).not.toHaveBeenCalled();
    expect(executeOf(ButtonHandler)).not.toHaveBeenCalled();
    uninstall();
  });

  it('responds to a controller heartbeat with a live heartbeat', () => {
    const transport = new FakeTransport();
    const uninstall = installLiveTabExecutor(transport);

    transport.emit(controllerHeartbeat());

    expect(transport.postedMessages).toContainEqual({ kind: 'heartbeat', role: 'live' });
    uninstall();
  });

  it('closes the live-tab sidebar when a controller takes over', () => {
    const transport = new FakeTransport();
    const uninstall = installLiveTabExecutor(transport);

    transport.emit(stampSidebarHandoff('close'));

    expect(getAppEvents().publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'close-extension-sidebar' }));
    uninstall();
  });

  it('reopens the sidebar when the controller leaves and the slot is free', () => {
    const transport = new FakeTransport();
    const uninstall = installLiveTabExecutor(transport);

    transport.emit(stampSidebarHandoff('close'));
    transport.emit(stampSidebarHandoff('reopen'));

    expect(sidebarState.openSidebar).toHaveBeenCalled();
    uninstall();
  });

  it('does not reopen when another plugin occupies the sidebar', () => {
    (isExtensionSidebarOwnedByOther as jest.Mock).mockReturnValue(true);
    const transport = new FakeTransport();
    const uninstall = installLiveTabExecutor(transport);

    transport.emit(stampSidebarHandoff('close'));
    transport.emit(stampSidebarHandoff('reopen'));

    expect(sidebarState.openSidebar).not.toHaveBeenCalled();
    uninstall();
  });

  it('evaluates a check-requirements request against the live tab and replies', async () => {
    (checkRequirements as jest.Mock).mockResolvedValue({
      requirements: 'navmenu-open',
      pass: false,
      error: [{ requirement: 'navmenu-open', pass: false, canFix: true, fixType: 'navigation' }],
    });
    const transport = new FakeTransport();
    const uninstall = installLiveTabExecutor(transport);

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

  it('runs a fix-requirement against the live tab and replies with the outcome', async () => {
    (dispatchFix as jest.Mock).mockResolvedValue({ ok: true });
    const transport = new FakeTransport();
    const uninstall = installLiveTabExecutor(transport);

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
    const transport = new FakeTransport();
    const uninstall = installLiveTabExecutor(transport);

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
    const first = new FakeTransport();
    const second = new FakeTransport();
    const uninstall = installLiveTabExecutor(first);
    installLiveTabExecutor(second);

    expect(first.started).toBe(true);
    expect(second.started).toBe(false);
    uninstall();
  });

  it('does not brick the executor if a handler constructor throws (NEW-1064-1)', () => {
    (ButtonHandler as unknown as jest.Mock).mockImplementationOnce(() => {
      throw new Error('constructor boom');
    });
    const first = new FakeTransport();
    expect(() => installLiveTabExecutor(first)).toThrow('constructor boom');
    expect(first.started).toBe(false);

    // installed stayed false, so a later init installs cleanly rather than
    // being permanently blocked by the failed attempt.
    const second = new FakeTransport();
    const uninstall = installLiveTabExecutor(second);
    expect(second.started).toBe(true);
    uninstall();
  });

  it('does not execute commands delivered after uninstall (NEW-1064-2)', async () => {
    const transport = new FakeTransport();
    const uninstall = installLiveTabExecutor(transport);
    uninstall();

    transport.emit(stampStepCommand('do', 'highlight', '#target'));
    await Promise.resolve();

    expect(executeOf(FocusHandler)).not.toHaveBeenCalled();
  });

  it('drops a command with an unrecognized action at the sink (T1 defense in depth)', async () => {
    const transport = new FakeTransport();
    const uninstall = installLiveTabExecutor(transport);

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
    const transport = new FakeTransport();
    const uninstall = installLiveTabExecutor(transport);

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
    const transport = new FakeTransport();
    const uninstall = installLiveTabExecutor(transport);

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
});
