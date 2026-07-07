import { CloudChainCleanupRegistry } from './cloud-chain-cleanup-registry';

describe('CloudChainCleanupRegistry', () => {
  it('tears down tracked stacks once and untracks them', async () => {
    const registry = new CloudChainCleanupRegistry();
    const first = { teardownChain: jest.fn(async () => ['first warning']) };
    const second = { teardownChain: jest.fn(async () => []) };

    registry.track(first);
    registry.track(second);

    await expect(registry.teardownAll()).resolves.toEqual(['first warning']);
    await expect(registry.teardownAll()).resolves.toEqual([]);
    expect(first.teardownChain).toHaveBeenCalledTimes(1);
    expect(second.teardownChain).toHaveBeenCalledTimes(1);
  });

  it('returns a warning when a tracked environment teardown throws', async () => {
    const registry = new CloudChainCleanupRegistry();
    const target = {
      teardownChain: jest.fn(async () => {
        throw new Error('destroy failed');
      }),
    };

    registry.track(target);

    await expect(registry.teardownAll()).resolves.toEqual(['Failed to tear down active Cloud stack: destroy failed']);
    await expect(registry.teardownAll()).resolves.toEqual([]);
  });
});
