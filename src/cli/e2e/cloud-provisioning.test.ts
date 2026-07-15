jest.mock('./shared-cloud-stack-environment', () => ({
  SharedCloudStackEnvironment: jest.fn().mockImplementation((adminToken: string, cloudUrl: string) => ({
    adminToken,
    cloudUrl,
    provisionChain: jest.fn(async () => ({ kind: 'shared', targetUrl: cloudUrl, token: `minted:${cloudUrl}` })),
    teardownChain: jest.fn(async () => []),
    sweepOrphans: jest.fn(async () => undefined),
  })),
}));

import { SharedCloudStackEnvironment } from './shared-cloud-stack-environment';
import {
  chainNeedsCloudStack,
  cloudTargetsInChain,
  provisionCloudTargetsForChain,
  ProvisionedCloudTargets,
  sweepCloudTargets,
} from './cloud-provisioning';
import type { CloudAuthPolicy } from './cloud-auth';
import type { CloudChainCleanupRegistry } from './cloud-chain-cleanup-registry';
import type { CloudStackPoolManager } from './cloud-stack-pool-manager';
import type { PackageMeta } from './e2e-results';

const cloudAuth: CloudAuthPolicy = {
  targets: { sharedStackUrls: ['https://learn.grafana.net/', 'https://play.grafana.org/'] },
  adminTokenFor: (targetUrl) => {
    if (targetUrl?.startsWith('https://learn.grafana.net')) {
      return 'learn-admin';
    }
    if (targetUrl?.startsWith('https://play.grafana.org')) {
      return 'play-admin';
    }
    return undefined;
  },
  needsProvisioningFor(targetUrl) {
    return Boolean(this.adminTokenFor(targetUrl));
  },
};

function poolManagerWithLease(lease: unknown): CloudStackPoolManager {
  return {
    leaseForChain: jest.fn(async () => lease),
  } as unknown as CloudStackPoolManager;
}

function cleanupRegistry(): CloudChainCleanupRegistry {
  return {
    track: jest.fn(),
    untrack: jest.fn(),
    teardownAll: jest.fn(),
  } as unknown as CloudChainCleanupRegistry;
}

function mutatingCloudMeta(): Map<string, PackageMeta> {
  return new Map<string, PackageMeta>([
    [
      'mutating',
      {
        packageId: 'mutating',
        tier: 'cloud',
        targetUrl: 'https://learn.grafana.net/',
        sideEffects: { level: 'mutating', reasons: [] },
      },
    ],
    [
      'dependent',
      {
        packageId: 'dependent',
        tier: 'cloud',
        targetUrl: 'https://learn.grafana.net/',
        sideEffects: { level: 'readonly', reasons: [] },
      },
    ],
  ]);
}

describe('cloudTargetsInChain', () => {
  it('deduplicates shared-stack target URLs', () => {
    const packageMetaById = new Map<string, PackageMeta>([
      ['a', { packageId: 'a', tier: 'cloud', targetUrl: 'https://learn.grafana.net/' }],
      ['b', { packageId: 'b', tier: 'cloud', targetUrl: 'https://learn.grafana.net/' }],
      ['c', { packageId: 'c', tier: 'cloud', targetUrl: 'https://play.grafana.org/' }],
    ]);

    expect(cloudTargetsInChain([{ id: 'a' }, { id: 'b' }, { id: 'c' }], packageMetaById, cloudAuth)).toEqual([
      'https://learn.grafana.net/',
      'https://play.grafana.org/',
    ]);
  });
});

describe('ProvisionedCloudTargets', () => {
  it('looks up minted tokens by origin and tears down all targets', async () => {
    const learnEnv = { teardownChain: jest.fn(async () => []) } as unknown as InstanceType<
      typeof SharedCloudStackEnvironment
    >;
    const playEnv = { teardownChain: jest.fn(async () => []) } as unknown as InstanceType<
      typeof SharedCloudStackEnvironment
    >;
    const provisioned = new ProvisionedCloudTargets();

    provisioned.add({ kind: 'shared', targetUrl: 'https://learn.grafana.net/', token: 'learn-token' }, learnEnv);
    provisioned.add({ kind: 'shared', targetUrl: 'https://play.grafana.org/', token: 'play-token' }, playEnv);

    expect(provisioned.tokenFor('https://learn.grafana.net/dashboards')).toBe('learn-token');
    expect(provisioned.tokenFor('https://play.grafana.org/a')).toBe('play-token');
    expect(provisioned.tokenFor('https://other.grafana.net/')).toBeUndefined();

    await expect(provisioned.teardownAll({ outcome: 'cancelled' })).resolves.toEqual([]);
    expect(learnEnv.teardownChain).toHaveBeenCalledWith({ outcome: 'cancelled' });
    expect(playEnv.teardownChain).toHaveBeenCalledWith({ outcome: 'cancelled' });
  });

  it('looks up isolated target URLs and tokens by guide id', async () => {
    const env = { teardownChain: jest.fn(async () => ['warning']) };
    const provisioned = new ProvisionedCloudTargets();

    provisioned.addForGuides(
      ['a', 'b'],
      { kind: 'pool', stackSlug: 'isolated', token: 'isolated-token', targetUrl: 'https://isolated.grafana.net/' },
      env
    );

    expect(provisioned.targetUrlForGuide('a', 'https://learn.grafana.net/')).toBe('https://isolated.grafana.net/');
    expect(provisioned.tokenForGuide('b', 'https://learn.grafana.net/')).toBe('isolated-token');
    expect(provisioned.targetUrlForGuide('c', 'https://learn.grafana.net/')).toBe('https://learn.grafana.net/');

    await expect(provisioned.teardownAll({ outcome: 'passed' })).resolves.toEqual(['warning']);
    expect(env.teardownChain).toHaveBeenCalledWith({ outcome: 'passed' });
  });
});

describe('chainNeedsCloudStack', () => {
  it('requires an isolated stack for unsafe cloud guides when stack support is available', () => {
    const packageMetaById = new Map<string, PackageMeta>([
      [
        'readonly',
        {
          packageId: 'readonly',
          tier: 'cloud',
          targetUrl: 'https://learn.grafana.net/',
          sideEffects: { level: 'readonly', reasons: [] },
        },
      ],
      [
        'mutating',
        {
          packageId: 'mutating',
          tier: 'cloud',
          targetUrl: 'https://learn.grafana.net/',
          sideEffects: { level: 'mutating', reasons: [] },
        },
      ],
    ]);

    expect(
      chainNeedsCloudStack({ chain: [{ id: 'readonly' }], packageMetaById, cloudAuth, hasIsolatedCloudStack: true })
    ).toBe(false);
    expect(
      chainNeedsCloudStack({ chain: [{ id: 'mutating' }], packageMetaById, cloudAuth, hasIsolatedCloudStack: true })
    ).toBe(true);
  });

  it('uses an isolated stack for cloud guides that lack shared-stack auth', () => {
    const packageMetaById = new Map<string, PackageMeta>([
      [
        'readonly',
        {
          packageId: 'readonly',
          tier: 'cloud',
          targetUrl: 'https://other.grafana.net/',
          sideEffects: { level: 'readonly', reasons: [] },
        },
      ],
    ]);

    expect(
      chainNeedsCloudStack({ chain: [{ id: 'readonly' }], packageMetaById, cloudAuth, hasIsolatedCloudStack: true })
    ).toBe(true);
  });

  it('does not require an isolated stack when no stack support exists', () => {
    const packageMetaById = new Map<string, PackageMeta>([
      [
        'mutating',
        {
          packageId: 'mutating',
          tier: 'cloud',
          targetUrl: 'https://learn.grafana.net/',
          sideEffects: { level: 'mutating', reasons: [] },
        },
      ],
    ]);

    expect(
      chainNeedsCloudStack({ chain: [{ id: 'mutating' }], packageMetaById, cloudAuth, hasIsolatedCloudStack: false })
    ).toBe(false);
  });
});

describe('provisionCloudTargetsForChain', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('provisions each target with its matching admin token', async () => {
    const provisioned = await provisionCloudTargetsForChain({
      targetUrls: ['https://learn.grafana.net/', 'https://play.grafana.org/'],
      cloudAuth,
      chain: [],
      packageMetaById: new Map(),
      verbose: false,
    });

    expect(SharedCloudStackEnvironment).toHaveBeenCalledWith('learn-admin', 'https://learn.grafana.net/', false);
    expect(SharedCloudStackEnvironment).toHaveBeenCalledWith('play-admin', 'https://play.grafana.org/', false);
    expect(provisioned.tokenFor('https://learn.grafana.net/')).toBe('minted:https://learn.grafana.net/');
    expect(provisioned.tokenFor('https://play.grafana.org/')).toBe('minted:https://play.grafana.org/');
  });

  it('tears down already-provisioned targets when a later target fails', async () => {
    (SharedCloudStackEnvironment as unknown as jest.Mock).mockImplementationOnce(
      (adminToken: string, cloudUrl: string) => ({
        adminToken,
        cloudUrl,
        provisionChain: jest.fn(async () => ({ kind: 'shared', targetUrl: cloudUrl, token: `minted:${cloudUrl}` })),
        teardownChain: jest.fn(async () => []),
        sweepOrphans: jest.fn(async () => undefined),
      })
    );
    (SharedCloudStackEnvironment as unknown as jest.Mock).mockImplementationOnce(
      (adminToken: string, cloudUrl: string) => ({
        adminToken,
        cloudUrl,
        provisionChain: jest.fn(async () => {
          throw new Error('boom');
        }),
        teardownChain: jest.fn(async () => []),
        sweepOrphans: jest.fn(async () => undefined),
      })
    );

    await expect(
      provisionCloudTargetsForChain({
        targetUrls: ['https://learn.grafana.net/', 'https://play.grafana.org/'],
        cloudAuth,
        chain: [],
        packageMetaById: new Map(),
        verbose: false,
      })
    ).rejects.toThrow('boom');

    const first = (SharedCloudStackEnvironment as unknown as jest.Mock).mock.results[0]?.value;
    const second = (SharedCloudStackEnvironment as unknown as jest.Mock).mock.results[1]?.value;

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first!.teardownChain).toHaveBeenCalledTimes(1);
    expect(second!.teardownChain).not.toHaveBeenCalled();
  });

  it('leases one manager stack for an unsafe cloud chain', async () => {
    const lease = {
      provisionChain: jest.fn(() => ({
        kind: 'pool',
        targetUrl: 'https://pool.grafana.net/',
        token: 'pool-token',
        stackSlug: 'pool',
      })),
      teardownChain: jest.fn(async () => ['pool cleanup warning']),
    };
    const cloudStackPoolManager = poolManagerWithLease(lease);
    const packageMetaById = mutatingCloudMeta();

    const provisioned = await provisionCloudTargetsForChain({
      targetUrls: ['https://learn.grafana.net/'],
      cloudAuth,
      chain: [{ id: 'mutating' }, { id: 'dependent' }],
      packageMetaById,
      cloudStackPoolManager,
      verbose: false,
    });

    expect(cloudStackPoolManager.leaseForChain).toHaveBeenCalledWith({
      chain: [{ id: 'mutating' }, { id: 'dependent' }],
      packageMetaById,
    });
    expect(SharedCloudStackEnvironment).not.toHaveBeenCalled();
    expect(provisioned.targetUrlForGuide('mutating', 'https://learn.grafana.net/')).toBe('https://pool.grafana.net/');
    expect(provisioned.targetUrlForGuide('dependent', 'https://learn.grafana.net/')).toBe('https://pool.grafana.net/');
    expect(provisioned.tokenForGuide('mutating', 'https://learn.grafana.net/')).toBe('pool-token');
    await expect(provisioned.teardownAll({ outcome: 'failed' })).resolves.toEqual(['pool cleanup warning']);
    expect(lease.teardownChain).toHaveBeenCalledWith({ outcome: 'failed' });
  });

  it('tracks and untracks manager leases through the cleanup registry', async () => {
    const lease = {
      provisionChain: jest.fn(() => ({
        kind: 'pool',
        targetUrl: 'https://pool.grafana.net/',
        token: 'pool-token',
        stackSlug: 'pool',
      })),
      teardownChain: jest.fn(async () => []),
    };
    const cloudStackPoolManager = poolManagerWithLease(lease);
    const registry = cleanupRegistry();

    const provisioned = await provisionCloudTargetsForChain({
      targetUrls: ['https://learn.grafana.net/'],
      cloudAuth,
      chain: [{ id: 'mutating' }],
      packageMetaById: mutatingCloudMeta(),
      cloudStackPoolManager,
      cloudChainCleanup: registry,
      verbose: false,
    });

    expect(registry.track).toHaveBeenCalledWith(lease);
    await expect(provisioned.teardownAll()).resolves.toEqual([]);
    expect(registry.untrack).toHaveBeenCalledWith(lease);
  });

  it('untracks manager leases when provisioning the returned target fails', async () => {
    const lease = {
      provisionChain: jest.fn(async () => {
        throw new Error('lease boom');
      }),
      teardownChain: jest.fn(async () => []),
    };
    const cloudStackPoolManager = poolManagerWithLease(lease);
    const registry = cleanupRegistry();

    await expect(
      provisionCloudTargetsForChain({
        targetUrls: ['https://learn.grafana.net/'],
        cloudAuth,
        chain: [{ id: 'mutating' }],
        packageMetaById: mutatingCloudMeta(),
        cloudStackPoolManager,
        cloudChainCleanup: registry,
        verbose: false,
      })
    ).rejects.toThrow('lease boom');

    expect(registry.track).toHaveBeenCalledWith(lease);
    expect(registry.untrack).toHaveBeenCalledWith(lease);
  });

  it('surfaces manager no-capacity failures instead of falling back', async () => {
    const cloudStackPoolManager = {
      leaseForChain: jest.fn(async () => {
        throw new Error('no_capacity: no hot stack is available');
      }),
    } as unknown as CloudStackPoolManager;

    await expect(
      provisionCloudTargetsForChain({
        targetUrls: ['https://learn.grafana.net/'],
        cloudAuth,
        chain: [{ id: 'mutating' }],
        packageMetaById: mutatingCloudMeta(),
        cloudStackPoolManager,
        verbose: false,
      })
    ).rejects.toThrow('no_capacity: no hot stack is available');
  });
});

describe('sweepCloudTargets', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sweeps every target with a matching admin token', async () => {
    await sweepCloudTargets({
      targetUrls: ['https://learn.grafana.net/', 'https://play.grafana.org/'],
      cloudAuth,
      verbose: true,
    });

    const first = (SharedCloudStackEnvironment as unknown as jest.Mock).mock.results[0]?.value;
    const second = (SharedCloudStackEnvironment as unknown as jest.Mock).mock.results[1]?.value;

    expect(SharedCloudStackEnvironment).toHaveBeenCalledWith('learn-admin', 'https://learn.grafana.net/', true);
    expect(SharedCloudStackEnvironment).toHaveBeenCalledWith('play-admin', 'https://play.grafana.org/', true);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first!.sweepOrphans).toHaveBeenCalledTimes(1);
    expect(second!.sweepOrphans).toHaveBeenCalledTimes(1);
  });
});
