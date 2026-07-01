import { createLatchedBroadcast } from './latched-broadcast';

describe('createLatchedBroadcast', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('delivers live to a subscriber present when emit is called', () => {
    const channel = createLatchedBroadcast<string>();
    const handler = jest.fn();

    channel.subscribe(handler);
    channel.emit('a');

    expect(handler).toHaveBeenCalledWith('a');
  });

  it('latches for a subscriber that attaches after emit, within ttl', () => {
    const channel = createLatchedBroadcast<string>({ ttlMs: 1000 });
    channel.emit('a');

    jest.setSystemTime(500);
    const handler = jest.fn();
    channel.subscribe(handler);

    expect(handler).toHaveBeenCalledWith('a');
  });

  it('does not deliver a latched value to a subscriber that attaches after ttl', () => {
    const channel = createLatchedBroadcast<string>({ ttlMs: 1000 });
    channel.emit('a');

    jest.setSystemTime(1500);
    const handler = jest.fn();
    channel.subscribe(handler);

    expect(handler).not.toHaveBeenCalled();
  });

  it('broadcasts a live emit to all current subscribers and does not latch for later ones', () => {
    const channel = createLatchedBroadcast<string>();
    const first = jest.fn();
    const second = jest.fn();
    channel.subscribe(first);
    channel.subscribe(second);

    channel.emit('x');

    expect(first).toHaveBeenCalledWith('x');
    expect(second).toHaveBeenCalledWith('x');

    const late = jest.fn();
    channel.subscribe(late);
    expect(late).not.toHaveBeenCalled();
  });

  it('delivers a latched value to only the first late subscriber', () => {
    const channel = createLatchedBroadcast<string>();
    channel.emit('once');

    const first = jest.fn();
    const second = jest.fn();
    channel.subscribe(first);
    channel.subscribe(second);

    expect(first).toHaveBeenCalledWith('once');
    expect(second).not.toHaveBeenCalled();
  });

  it('clears the latch on the first drain even when that subscriber then unsubscribes', () => {
    const channel = createLatchedBroadcast<string>({ ttlMs: 1000 });
    channel.emit('once');

    const first = jest.fn();
    const unsubscribe = channel.subscribe(first);
    expect(first).toHaveBeenCalledWith('once');
    unsubscribe();

    jest.setSystemTime(500);
    const second = jest.fn();
    channel.subscribe(second);

    expect(second).not.toHaveBeenCalled();
  });

  it('stops delivering after unsubscribe', () => {
    const channel = createLatchedBroadcast<string>();
    const handler = jest.fn();
    const unsubscribe = channel.subscribe(handler);

    unsubscribe();
    channel.emit('a');

    expect(handler).not.toHaveBeenCalled();
  });

  it('keeps only the last value when multiple emits happen with no subscribers', () => {
    const channel = createLatchedBroadcast<string>();
    channel.emit('first');
    channel.emit('second');

    const handler = jest.fn();
    channel.subscribe(handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('second');
  });
});
