jest.mock('./shared-cloud-stack-environment', () => ({
  SharedCloudStackEnvironment: jest.fn().mockImplementation((adminToken: string, cloudUrl: string) => ({
    adminToken,
    cloudUrl,
    provisionChain: jest.fn(async () => `minted:${cloudUrl}`),
    teardownChain: jest.fn(async () => undefined),
    sweepOrphans: jest.fn(async () => undefined),
  })),
}));
jest.mock('./cold-cloud-stack-environment', () => ({
  ColdCloudStackEnvironment: jest.fn().mockImplementation(() => ({
    provisionChain: jest.fn(async () => ({
      targetUrl: 'https://isolated.grafana.net/',
      token: 'isolated-token',
      stackSlug: 'isolated',
    })),
    teardownChain: jest.fn(async () => ['cleanup warning']),
  })),
}));

import { SharedCloudStackEnvironment } from './shared-cloud-stack-environment';
import { ColdCloudStackEnvironment, type ColdCloudStackProvisioningConfig } from './cold-cloud-stack-environment';
import {
  chainNeedsCloudStack,
  cloudTargetsInChain,
  provisionCloudTargetsForChain,
  ProvisionedCloudTargets,
  sweepCloudTargets,
} from './cloud-provisioning';
import type { CloudAuthPolicy } from './cloud-auth';
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

const cloudStack: ColdCloudStackProvisioningConfig = {
  accessPolicyTokenEnvVar: 'GRAFANA_CLOUD_ACCESS_POLICY_TOKEN',
  accessPolicyToken: 'cloud-access-token',
  region: 'prod-us-east-0',
  slugPrefix: 'pfe2e',
};

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
    const learnEnv = { teardownChain: jest.fn(async () => undefined) } as unknown as InstanceType<
      typeof SharedCloudStackEnvironment
    >;
    const playEnv = { teardownChain: jest.fn(async () => undefined) } as unknown as InstanceType<
      typeof SharedCloudStackEnvironment
    >;
    const provisioned = new ProvisionedCloudTargets();

    provisioned.add('https://learn.grafana.net/', { env: learnEnv, token: 'learn-token' });
    provisioned.add('https://play.grafana.org/', { env: playEnv, token: 'play-token' });

    expect(provisioned.tokenFor('https://learn.grafana.net/dashboards')).toBe('learn-token');
    expect(provisioned.tokenFor('https://play.grafana.org/a')).toBe('play-token');
    expect(provisioned.tokenFor('https://other.grafana.net/')).toBeUndefined();

    await expect(provisioned.teardownAll()).resolves.toEqual([]);
    expect(learnEnv.teardownChain).toHaveBeenCalledTimes(1);
    expect(playEnv.teardownChain).toHaveBeenCalledTimes(1);
  });

  it('looks up isolated target URLs and tokens by guide id', async () => {
    const env = { teardownChain: jest.fn(async () => ['warning']) };
    const provisioned = new ProvisionedCloudTargets();

    provisioned.addForGuides(['a', 'b'], {
      env,
      token: 'isolated-token',
      targetUrl: 'https://isolated.grafana.net/',
    });

    expect(provisioned.targetUrlForGuide('a', 'https://learn.grafana.net/')).toBe('https://isolated.grafana.net/');
    expect(provisioned.tokenForGuide('b', 'https://learn.grafana.net/')).toBe('isolated-token');
    expect(provisioned.targetUrlForGuide('c', 'https://learn.grafana.net/')).toBe('https://learn.grafana.net/');

    await expect(provisioned.teardownAll()).resolves.toEqual(['warning']);
    expect(env.teardownChain).toHaveBeenCalledTimes(1);
  });
});

describe('chainNeedsCloudStack', () => {
  it('requires a cold stack for unsafe cloud guides when stack config is available', () => {
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

    expect(chainNeedsCloudStack({ chain: [{ id: 'readonly' }], packageMetaById, cloudAuth, cloudStack })).toBe(false);
    expect(chainNeedsCloudStack({ chain: [{ id: 'mutating' }], packageMetaById, cloudAuth, cloudStack })).toBe(true);
  });

  it('uses a cold stack for cloud guides that lack shared-stack auth', () => {
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

    expect(chainNeedsCloudStack({ chain: [{ id: 'readonly' }], packageMetaById, cloudAuth, cloudStack })).toBe(true);
  });

  it('does not require a cold stack when no stack config exists', () => {
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
      chainNeedsCloudStack({ chain: [{ id: 'mutating' }], packageMetaById, cloudAuth, cloudStack: undefined })
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
        provisionChain: jest.fn(async () => `minted:${cloudUrl}`),
        teardownChain: jest.fn(async () => undefined),
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
        teardownChain: jest.fn(async () => undefined),
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

  it('provisions one isolated stack for an unsafe cloud chain', async () => {
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

    const provisioned = await provisionCloudTargetsForChain({
      targetUrls: ['https://learn.grafana.net/'],
      cloudAuth,
      chain: [{ id: 'mutating' }, { id: 'dependent' }],
      packageMetaById,
      cloudStack,
      verbose: false,
    });

    expect(ColdCloudStackEnvironment).toHaveBeenCalledWith(cloudStack, false);
    expect(SharedCloudStackEnvironment).not.toHaveBeenCalled();
    expect(provisioned.targetUrlForGuide('mutating', 'https://learn.grafana.net/')).toBe(
      'https://isolated.grafana.net/'
    );
    expect(provisioned.targetUrlForGuide('dependent', 'https://learn.grafana.net/')).toBe(
      'https://isolated.grafana.net/'
    );
    expect(provisioned.tokenForGuide('mutating', 'https://learn.grafana.net/')).toBe('isolated-token');
    await expect(provisioned.teardownAll()).resolves.toEqual(['cleanup warning']);
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
