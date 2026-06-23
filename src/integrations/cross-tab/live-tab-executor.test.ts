import { waitFor } from '@testing-library/react';
import { installLiveTabExecutor, resetLiveTabExecutorForTests } from './live-tab-executor';
import { FocusHandler, ButtonHandler, NavigateHandler } from '../../interactive-engine/action-handlers';
import type { CrossTabMessage } from '../../types/cross-tab.types';

jest.mock('../../interactive-engine/action-handlers', () => {
  const makeHandler = () => ({ execute: jest.fn().mockResolvedValue(undefined) });
  return {
    FocusHandler: jest.fn(makeHandler),
    ButtonHandler: jest.fn(makeHandler),
    FormFillHandler: jest.fn(makeHandler),
    HoverHandler: jest.fn(makeHandler),
    NavigateHandler: jest.fn(makeHandler),
  };
});

class FakeTransport {
  started = false;
  stopped = false;
  private listener: ((message: CrossTabMessage) => void) | null = null;

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.stopped = true;
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

function stampStepCommand(phase: 'show' | 'do', targetAction: string, refTarget: string): CrossTabMessage {
  return {
    source: 'pathfinder',
    senderId: 'controller',
    timestamp: 0,
    kind: 'step-command',
    phase,
    stepId: 's1',
    action: { targetAction, refTarget },
  };
}

function executeOf(handler: unknown): jest.Mock {
  const ctor = handler as jest.Mock;
  return (ctor.mock.results[0]?.value as { execute: jest.Mock }).execute;
}

describe('installLiveTabExecutor', () => {
  beforeEach(() => {
    resetLiveTabExecutorForTests();
    jest.clearAllMocks();
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

  it('ignores unsupported actions without throwing or routing', () => {
    const transport = new FakeTransport();
    const uninstall = installLiveTabExecutor(transport);

    expect(() => transport.emit(stampStepCommand('do', 'multistep', '#x'))).not.toThrow();
    expect(executeOf(FocusHandler)).not.toHaveBeenCalled();
    expect(executeOf(ButtonHandler)).not.toHaveBeenCalled();
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
});
