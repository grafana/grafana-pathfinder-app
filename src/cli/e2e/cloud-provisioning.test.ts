jest.mock('./cloud-environment', () => ({
  CloudEnvironment: jest.fn().mockImplementation((adminToken: string, cloudUrl: string) => ({
    adminToken,
    cloudUrl,
    provisionChain: jest.fn(async () => `minted:${cloudUrl}`),
    teardownChain: jest.fn(async () => undefined),
    sweepOrphans: jest.fn(async () => undefined),
  })),
}));

import { CloudEnvironment } from './cloud-environment';
import {
  cloudTargetsInChain,
  provisionCloudTargetsForChain,
  ProvisionedCloudTargets,
  sweepCloudTargets,
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
});

describe('ProvisionedCloudTargets', () => {
  it('looks up minted tokens by origin and tears down all targets', async () => {
    const learnEnv = { teardownChain: jest.fn(async () => undefined) } as unknown as InstanceType<
      typeof CloudEnvironment
    >;
    const playEnv = { teardownChain: jest.fn(async () => undefined) } as unknown as InstanceType<
      typeof CloudEnvironment
    >;
    const provisioned = new ProvisionedCloudTargets();

    provisioned.add('https://learn.grafana.net/', { env: learnEnv, token: 'learn-token' });
    provisioned.add('https://play.grafana.org/', { env: playEnv, token: 'play-token' });

    expect(provisioned.tokenFor('https://learn.grafana.net/dashboards')).toBe('learn-token');
    expect(provisioned.tokenFor('https://play.grafana.org/a')).toBe('play-token');
    expect(provisioned.tokenFor('https://other.grafana.net/')).toBeUndefined();

    await provisioned.teardownAll();

    expect(learnEnv.teardownChain).toHaveBeenCalledTimes(1);
    expect(playEnv.teardownChain).toHaveBeenCalledTimes(1);
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
