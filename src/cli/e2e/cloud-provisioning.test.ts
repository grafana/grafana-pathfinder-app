jest.mock('./cloud-environment', () => ({
  CloudEnvironment: jest.fn().mockImplementation((adminToken: string, cloudUrl: string) => ({
    adminToken,
    cloudUrl,
    provisionChain: jest.fn(async () => `minted:${cloudUrl}`),
    teardownChain: jest.fn(async () => undefined),
    sweepOrphans: jest.fn(async () => undefined),
  })),
}));
jest.mock('./cloud-stack-environment', () => ({
  CloudStackEnvironment: jest.fn().mockImplementation(() => ({
    provisionChain: jest.fn(async () => ({
      targetUrl: 'https://ephemeral.grafana.net/',
      token: 'ephemeral-token',
      stackSlug: 'pfe2eabc',
    })),
    teardownChain: jest.fn(async () => undefined),
  })),
}));

import { CloudEnvironment } from './cloud-environment';
import { CloudStackEnvironment, type CloudStackProvisioningConfig } from './cloud-stack-environment';
import type { CloudStackPool } from './cloud-stack-pool';
import {
  chainNeedsCloudStack,
  cloudTargetsInChain,
  provisionCloudTargetsForChain,
  ProvisionedCloudTargets,
  sweepCloudTargets,
  unsafeCloudGuidesWithoutStack,
} from './cloud-provisioning';
import type { CloudAuthPolicy } from './cloud-auth';
import type { PackageMeta } from './e2e-results';

const cloudAuth: CloudAuthPolicy = {
  targets: { provisionable: ['https://learn.grafana.net/', 'https://play.grafana.org/'] },
  adminTokenFor: (targetUrl) => {
    if (targetUrl?.startsWith('https://learn.grafana.net')) {
      return 'learn-admin';
    }
    if (targetUrl?.startsWith('https://play.grafana.org')) {
      return 'play-admin';
    }
    return undefined;
  },
  needsProvisioningFor: (targetUrl) => Boolean(targetUrl?.includes('grafana.')),
  runnerAuthFor: () => ({}),
};
const cloudStack: CloudStackProvisioningConfig = {
  accessPolicyTokenEnvVar: 'GRAFANA_TOKEN',
  accessPolicyToken: 'token',
  region: 'us',
  slugPrefix: 'pfe2e',
};

describe('cloudTargetsInChain', () => {
  it('deduplicates provisionable targets by URL', () => {
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

  it('leases a hot-pool stack before falling back to cold provisioning', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const packageMetaById = new Map<string, PackageMeta>([
      [
        'mutating',
        {
          packageId: 'mutating',
          tier: 'cloud',
          targetUrl: 'https://learn.grafana.net/',
          sideEffects: { level: 'mutating', reasons: [{ level: 'mutating', path: 'blocks[0]', message: 'save' }] },
        },
      ],
    ]);
    const lease = {
      provisionChain: () => ({ targetUrl: 'https://pool-a.grafana.net/', token: 'pool-token', stackSlug: 'pool-a' }),
      teardownChain: jest.fn(async () => undefined),
    };
    const pool = { lease: jest.fn(async () => lease) } as unknown as CloudStackPool;

    const provisioned = await provisionCloudTargetsForChain({
      targetUrls: ['https://learn.grafana.net/'],
      cloudAuth,
      chain: [{ id: 'mutating' }],
      packageMetaById,
      cloudStack,
      cloudStackPool: pool,
      verbose: false,
    });
    expect(pool.lease).toHaveBeenCalledWith('https://learn.grafana.net/');

    expect(CloudStackEnvironment).not.toHaveBeenCalled();
    expect(provisioned.targetUrlForGuide('mutating', 'https://learn.grafana.net/')).toBe('https://pool-a.grafana.net/');
    expect(provisioned.tokenForGuide('mutating', 'https://learn.grafana.net/')).toBe('pool-token');
    logSpy.mockRestore();
  });
});

describe('ProvisionedCloudTargets', () => {
  it('looks up minted tokens by origin and tears down all targets', async () => {
    const learnEnv = { teardownChain: jest.fn(async () => undefined) } as unknown as InstanceType<
      typeof CloudEnvironment
    >;
    const playEnv = { teardownChain: jest.fn(async () => undefined) } as unknown as InstanceType<
      typeof CloudEnvironment
    >;
    const stackEnv = { teardownChain: jest.fn(async () => undefined) };
    const provisioned = new ProvisionedCloudTargets();

    provisioned.add('https://learn.grafana.net/', { env: learnEnv, token: 'learn-token' });
    provisioned.add('https://play.grafana.org/', { env: playEnv, token: 'play-token' });
    provisioned.addForGuides(['cloud-guide'], {
      env: stackEnv,
      token: 'stack-token',
      targetUrl: 'https://ephemeral.grafana.net/',
    });

    expect(provisioned.tokenFor('https://learn.grafana.net/dashboards')).toBe('learn-token');
    expect(provisioned.tokenFor('https://play.grafana.org/a')).toBe('play-token');
    expect(provisioned.tokenFor('https://other.grafana.net/')).toBeUndefined();
    expect(provisioned.targetUrlForGuide('cloud-guide', 'https://learn.grafana.net/')).toBe(
      'https://ephemeral.grafana.net/'
    );
    expect(provisioned.tokenForGuide('cloud-guide', 'https://learn.grafana.net/')).toBe('stack-token');
    expect(provisioned.tokenForGuide('other-guide', 'https://learn.grafana.net/')).toBe('learn-token');

    await provisioned.teardownAll();
    expect(stackEnv.teardownChain).toHaveBeenCalledTimes(1);
    expect(learnEnv.teardownChain).toHaveBeenCalledTimes(1);
    expect(playEnv.teardownChain).toHaveBeenCalledTimes(1);
  });
});

describe('cloud stack routing helpers', () => {
  const unsafeMeta = new Map<string, PackageMeta>([
    [
      'mutating',
      {
        packageId: 'mutating',
        tier: 'cloud',
        targetUrl: 'https://learn.grafana.net/',
        sideEffects: { level: 'mutating', reasons: [{ level: 'mutating', path: 'blocks[0]', message: 'save' }] },
      },
    ],
  ]);
  const readonlyMeta = new Map<string, PackageMeta>([
    [
      'readonly',
      {
        packageId: 'readonly',
        tier: 'cloud',
        targetUrl: 'https://learn.grafana.net/',
        sideEffects: { level: 'readonly', reasons: [] },
      },
    ],
  ]);

  it('requires a stack for unsafe cloud guides when stack config is present', () => {
    expect(
      chainNeedsCloudStack({ chain: [{ id: 'mutating' }], packageMetaById: unsafeMeta, cloudAuth, cloudStack })
    ).toBe(true);
  });

  it('requires a stack for readonly cloud guides that lack shared auth', () => {
    expect(
      chainNeedsCloudStack({
        chain: [{ id: 'readonly' }],
        packageMetaById: readonlyMeta,
        cloudAuth: undefined,
        cloudStack,
      })
    ).toBe(true);
  });

  it('does not require a stack for readonly guides with shared auth', () => {
    expect(
      chainNeedsCloudStack({ chain: [{ id: 'readonly' }], packageMetaById: readonlyMeta, cloudAuth, cloudStack })
    ).toBe(false);
  });

  it('identifies unsafe cloud guides that would pollute a shared stack', () => {
    expect(unsafeCloudGuidesWithoutStack([{ id: 'mutating' }], unsafeMeta, undefined)).toEqual([{ id: 'mutating' }]);
    expect(unsafeCloudGuidesWithoutStack([{ id: 'mutating' }], unsafeMeta, cloudStack)).toEqual([]);
  });

  it('treats missing side-effect metadata on cloud guides as unsafe', () => {
    const missingMeta = new Map<string, PackageMeta>([
      ['missing', { packageId: 'missing', tier: 'cloud', targetUrl: 'https://learn.grafana.net/' }],
    ]);

    expect(unsafeCloudGuidesWithoutStack([{ id: 'missing' }], missingMeta, undefined)).toEqual([{ id: 'missing' }]);
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
      verbose: false,
    });

    expect(CloudEnvironment).toHaveBeenCalledWith('learn-admin', 'https://learn.grafana.net/', false);
    expect(CloudEnvironment).toHaveBeenCalledWith('play-admin', 'https://play.grafana.org/', false);
    expect(provisioned.tokenFor('https://learn.grafana.net/')).toBe('minted:https://learn.grafana.net/');
    expect(provisioned.tokenFor('https://play.grafana.org/')).toBe('minted:https://play.grafana.org/');
  });

  it('provisions one ephemeral stack for a cloud chain that needs stack isolation', async () => {
    const packageMetaById = new Map<string, PackageMeta>([
      [
        'mutating',
        {
          packageId: 'mutating',
          tier: 'cloud',
          targetUrl: 'https://learn.grafana.net/',
          sideEffects: { level: 'mutating', reasons: [{ level: 'mutating', path: 'blocks[0]', message: 'save' }] },
        },
      ],
    ]);

    const provisioned = await provisionCloudTargetsForChain({
      targetUrls: ['https://learn.grafana.net/'],
      cloudAuth,
      chain: [{ id: 'mutating' }],
      packageMetaById,
      cloudStack,
      verbose: false,
    });

    expect(CloudStackEnvironment).toHaveBeenCalledWith(cloudStack, false);
    expect(CloudEnvironment).not.toHaveBeenCalled();
    expect(provisioned.targetUrlForGuide('mutating', 'https://learn.grafana.net/')).toBe(
      'https://ephemeral.grafana.net/'
    );
    expect(provisioned.tokenForGuide('mutating', 'https://learn.grafana.net/')).toBe('ephemeral-token');
  });

  it('tears down already-provisioned targets when a later target fails', async () => {
    (CloudEnvironment as unknown as jest.Mock).mockImplementationOnce((adminToken: string, cloudUrl: string) => ({
      adminToken,
      cloudUrl,
      provisionChain: jest.fn(async () => `minted:${cloudUrl}`),
      teardownChain: jest.fn(async () => undefined),
      sweepOrphans: jest.fn(async () => undefined),
    }));
    (CloudEnvironment as unknown as jest.Mock).mockImplementationOnce((adminToken: string, cloudUrl: string) => ({
      adminToken,
      cloudUrl,
      provisionChain: jest.fn(async () => {
        throw new Error('boom');
      }),
      teardownChain: jest.fn(async () => undefined),
      sweepOrphans: jest.fn(async () => undefined),
    }));

    await expect(
      provisionCloudTargetsForChain({
        targetUrls: ['https://learn.grafana.net/', 'https://play.grafana.org/'],
        cloudAuth,
        verbose: false,
      })
    ).rejects.toThrow('boom');

    const first = (CloudEnvironment as unknown as jest.Mock).mock.results[0]?.value;
    const second = (CloudEnvironment as unknown as jest.Mock).mock.results[1]?.value;

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first!.teardownChain).toHaveBeenCalledTimes(1);
    expect(second!.teardownChain).not.toHaveBeenCalled();
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

    const first = (CloudEnvironment as unknown as jest.Mock).mock.results[0]?.value;
    const second = (CloudEnvironment as unknown as jest.Mock).mock.results[1]?.value;

    expect(CloudEnvironment).toHaveBeenCalledWith('learn-admin', 'https://learn.grafana.net/', true);
    expect(CloudEnvironment).toHaveBeenCalledWith('play-admin', 'https://play.grafana.org/', true);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first!.sweepOrphans).toHaveBeenCalledTimes(1);
    expect(second!.sweepOrphans).toHaveBeenCalledTimes(1);
  });
});
