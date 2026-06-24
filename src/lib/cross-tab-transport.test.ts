import { CrossTabTransport, createSenderId, type BroadcastChannelLike } from './cross-tab-transport';
import type { CrossTabMessage } from '../types/cross-tab.types';
import type { InteractiveAction } from '../types/collaboration.types';

class FakeBus {
  private channels = new Set<FakeChannel>();

  register(channel: FakeChannel): void {
    this.channels.add(channel);
  }

  unregister(channel: FakeChannel): void {
    this.channels.delete(channel);
  }

  deliver(sender: FakeChannel, name: string, message: unknown): void {
    this.channels.forEach((channel) => {
      if (channel !== sender && channel.name === name) {
        channel.onmessage?.({ data: message } as MessageEvent);
      }
    });
  }
}

class FakeChannel implements BroadcastChannelLike {
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(
    readonly name: string,
    private readonly bus: FakeBus
  ) {
    bus.register(this);
  }

  postMessage(message: unknown): void {
    this.bus.deliver(this, this.name, message);
  }

  close(): void {
    this.bus.unregister(this);
  }
}

function busFactory(bus: FakeBus) {
  return (name: string) => new FakeChannel(name, bus);
}

const action: InteractiveAction = { targetAction: 'highlight', refTarget: '#panel-add' };

describe('CrossTabTransport', () => {
  it('delivers a posted message to other transports and stamps the envelope', () => {
    const bus = new FakeBus();
    const controller = new CrossTabTransport('controller-id', busFactory(bus));
    const live = new CrossTabTransport('live-id', busFactory(bus));
    controller.start();
    live.start();

    const received: CrossTabMessage[] = [];
    live.onMessage((m) => received.push(m));

    controller.post({ kind: 'step-command', phase: 'show', stepId: 's1', runId: 'run-1', action });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      kind: 'step-command',
      phase: 'show',
      stepId: 's1',
      source: 'pathfinder',
      senderId: 'controller-id',
    });
    expect(typeof received[0]?.timestamp).toBe('number');
  });

  it('does not deliver a transport its own message', () => {
    const bus = new FakeBus();
    const controller = new CrossTabTransport('controller-id', busFactory(bus));
    controller.start();

    const received: CrossTabMessage[] = [];
    controller.onMessage((m) => received.push(m));

    controller.post({ kind: 'heartbeat', role: 'controller' });

    expect(received).toHaveLength(0);
  });

  it('filters out messages whose senderId matches its own (defensive self-echo guard)', () => {
    const bus = new FakeBus();
    const a = new CrossTabTransport('same-id', busFactory(bus));
    const b = new CrossTabTransport('same-id', busFactory(bus));
    a.start();
    b.start();

    const received: CrossTabMessage[] = [];
    b.onMessage((m) => received.push(m));

    a.post({ kind: 'heartbeat', role: 'live' });

    expect(received).toHaveLength(0);
  });

  it('ignores foreign (non-pathfinder) traffic on the channel', () => {
    const bus = new FakeBus();
    const live = new CrossTabTransport('live-id', busFactory(bus));
    const intruder = new FakeChannel('pathfinder-cross-tab', bus);
    live.start();

    const received: CrossTabMessage[] = [];
    live.onMessage((m) => received.push(m));

    intruder.postMessage({ source: 'something-else', hello: 'world' });

    expect(received).toHaveLength(0);
  });

  it('drops a forged same-origin message that fails per-kind validation', () => {
    const bus = new FakeBus();
    const intruder = new FakeChannel('pathfinder-cross-tab', bus);
    const live = new CrossTabTransport('live-id', busFactory(bus));
    live.start();

    const received: CrossTabMessage[] = [];
    live.onMessage((m) => received.push(m));

    // Well-formed envelope, but the step-command body is forged with an
    // action verb the executor must never run.
    intruder.postMessage({
      source: 'pathfinder',
      senderId: 'attacker',
      timestamp: Date.now(),
      kind: 'step-command',
      phase: 'do',
      stepId: 's1',
      action: { targetAction: 'exec-shell', refTarget: 'rm -rf /' },
    });

    expect(received).toHaveLength(0);
  });

  it('isolates a throwing listener so others still receive the message', () => {
    const bus = new FakeBus();
    const controller = new CrossTabTransport('controller-id', busFactory(bus));
    const live = new CrossTabTransport('live-id', busFactory(bus));
    controller.start();
    live.start();

    const received: CrossTabMessage[] = [];
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    live.onMessage(() => {
      throw new Error('boom');
    });
    live.onMessage((m) => received.push(m));

    controller.post({ kind: 'heartbeat', role: 'controller' });

    expect(received).toHaveLength(1);
    errorSpy.mockRestore();
  });

  it('routes heartbeats in both directions', () => {
    const bus = new FakeBus();
    const controller = new CrossTabTransport('controller-id', busFactory(bus));
    const live = new CrossTabTransport('live-id', busFactory(bus));
    controller.start();
    live.start();

    const atLive: CrossTabMessage[] = [];
    const atController: CrossTabMessage[] = [];
    live.onMessage((m) => atLive.push(m));
    controller.onMessage((m) => atController.push(m));

    controller.post({ kind: 'heartbeat', role: 'controller' });
    live.post({ kind: 'heartbeat', role: 'live' });

    expect(atLive).toEqual([expect.objectContaining({ kind: 'heartbeat', role: 'controller' })]);
    expect(atController).toEqual([expect.objectContaining({ kind: 'heartbeat', role: 'live' })]);
  });

  it('stops delivering after stop() and reports isActive()', () => {
    const bus = new FakeBus();
    const controller = new CrossTabTransport('controller-id', busFactory(bus));
    const live = new CrossTabTransport('live-id', busFactory(bus));
    controller.start();
    live.start();

    const received: CrossTabMessage[] = [];
    live.onMessage((m) => received.push(m));

    expect(live.isActive()).toBe(true);
    live.stop();
    expect(live.isActive()).toBe(false);

    controller.post({ kind: 'heartbeat', role: 'controller' });
    expect(received).toHaveLength(0);
  });

  it('post() is a no-op before start()', () => {
    const bus = new FakeBus();
    const controller = new CrossTabTransport('controller-id', busFactory(bus));
    const live = new CrossTabTransport('live-id', busFactory(bus));
    live.start();

    const received: CrossTabMessage[] = [];
    live.onMessage((m) => received.push(m));

    controller.post({ kind: 'heartbeat', role: 'controller' });
    expect(received).toHaveLength(0);
  });

  it('unsubscribes a listener via the returned disposer', () => {
    const bus = new FakeBus();
    const controller = new CrossTabTransport('controller-id', busFactory(bus));
    const live = new CrossTabTransport('live-id', busFactory(bus));
    controller.start();
    live.start();

    const received: CrossTabMessage[] = [];
    const unsubscribe = live.onMessage((m) => received.push(m));
    unsubscribe();

    controller.post({ kind: 'heartbeat', role: 'controller' });
    expect(received).toHaveLength(0);
  });

  it('stays inactive (no throw) when no channel is available', () => {
    const transport = new CrossTabTransport('id', () => null);
    transport.start();
    expect(transport.isActive()).toBe(false);
    expect(() => transport.post({ kind: 'heartbeat', role: 'controller' })).not.toThrow();
  });
});

describe('createSenderId', () => {
  it('returns a non-empty string', () => {
    expect(typeof createSenderId()).toBe('string');
    expect(createSenderId().length).toBeGreaterThan(0);
  });
});
