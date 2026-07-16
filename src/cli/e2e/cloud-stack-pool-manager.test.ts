import {
  CloudStackPoolManager,
  createCloudStackPoolManagerConfig,
  DEFAULT_CLOUD_STACK_POOL_ID,
  type CloudStackPoolManagerConfig,
} from './cloud-stack-pool-manager';
import type { PackageMeta } from './e2e-results';

const CONFIG: CloudStackPoolManagerConfig = {
  managerUrl: 'https://pool.example/',
  tokenEnvVar: 'POOL_MANAGER_TOKEN',
  token: 'manager-secret',
  poolId: 'nightly',
  maxWaitSeconds: 5,
};

function jsonResponse(body: unknown, status = 200, statusText = 'OK'): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: jest.fn(async () => JSON.stringify(body)),
  } as unknown as Response;
}

function leaseResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    leaseId: 'lease-1',
    grafanaUrl: 'https://leased.grafana.net/',
    runnerToken: 'runner-secret',
    poolId: 'nightly',
    stackSlug: 'leased',
    source: 'hot',
    expiresAt: '2026-07-07T22:00:00Z',
    waitMs: 10,
    provisioningMs: 0,
    ...overrides,
  };
}

describe('createCloudStackPoolManagerConfig', () => {
  it('returns undefined when manager leasing is not configured', () => {
    expect(createCloudStackPoolManagerConfig({ poolId: DEFAULT_CLOUD_STACK_POOL_ID, env: {} })).toBeUndefined();
  });

  it('loads the manager token and defaults the pool id', () => {
    expect(
      createCloudStackPoolManagerConfig({
        managerUrl: 'https://pool.example',
        tokenEnvVar: 'POOL_TOKEN',
        maxWaitSeconds: 10,
        env: { POOL_TOKEN: 'secret' },
      })
    ).toEqual({
      managerUrl: 'https://pool.example/',
      tokenEnvVar: 'POOL_TOKEN',
      token: 'secret',
      poolId: 'nightly',
      maxWaitSeconds: 10,
    });
  });

  it('rejects invalid or partial manager config', () => {
    expect(() => createCloudStackPoolManagerConfig({ managerUrl: 'https://pool.example', env: {} })).toThrow(
      /pool-manager-token/
    );
    expect(() =>
      createCloudStackPoolManagerConfig({ tokenEnvVar: 'POOL_TOKEN', env: { POOL_TOKEN: 'secret' } })
    ).toThrow(/pool-manager-url/);
    expect(() =>
      createCloudStackPoolManagerConfig({
        managerUrl: 'ftp://pool.example',
        tokenEnvVar: 'POOL_TOKEN',
        env: { POOL_TOKEN: 'secret' },
      })
    ).toThrow(/http or https/);
    expect(() =>
      createCloudStackPoolManagerConfig({
        managerUrl: 'https://pool.example',
        tokenEnvVar: '1_BAD',
        env: { '1_BAD': 'secret' },
      })
    ).toThrow(/Invalid/);
    expect(() =>
      createCloudStackPoolManagerConfig({
        managerUrl: 'https://pool.example',
        tokenEnvVar: 'POOL_TOKEN',
        maxWaitSeconds: -1,
        env: { POOL_TOKEN: 'secret' },
      })
    ).toThrow(/non-negative/);
  });
});

describe('CloudStackPoolManager', () => {
  it('creates and retires a lease with chain metadata', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(leaseResponse(), 201, 'Created'))
      .mockResolvedValueOnce(jsonResponse({ leaseId: 'lease-1', status: 'retired', cleanupWarnings: ['warning'] }));
    const manager = new CloudStackPoolManager(CONFIG, false, fetchImpl as unknown as typeof fetch);
    const packageMetaById = new Map<string, PackageMeta>([
      ['a', { packageId: 'a', sourceUrl: 'https://cdn.example/a/content.json' }],
      ['b', { packageId: 'b', sourceUrl: 'https://cdn.example/b/content.json' }],
    ]);

    const lease = await manager.leaseForChain({ chain: [{ id: 'a' }, { id: 'b' }], packageMetaById });
    await expect(lease.provisionChain()).resolves.toEqual({
      kind: 'pool',
      targetUrl: 'https://leased.grafana.net/',
      token: 'runner-secret',
      stackSlug: 'leased',
    });
    await expect(
      lease.teardownChain({ outcome: 'failed', used: true, summary: 'One or more guides failed' })
    ).resolves.toEqual(['warning']);

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://pool.example/v1/leases',
      expect.objectContaining({ method: 'POST' })
    );
    const createBody = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(createBody).toMatchObject({
      poolId: 'nightly',
      chainId: 'a>b',
      packageIds: ['a', 'b'],
      fallbackPolicy: 'hot_only',
      requiredPlugins: [],
      maxWaitSeconds: 5,
      metadata: {
        client: 'pathfinder-cli',
        sourceUrls: 'https://cdn.example/a/content.json,https://cdn.example/b/content.json',
      },
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://pool.example/v1/leases/lease-1/retire',
      expect.objectContaining({ method: 'POST' })
    );
    const retireBody = JSON.parse((fetchImpl.mock.calls[1]![1] as RequestInit).body as string);
    expect(retireBody).toMatchObject({
      outcome: 'failed',
      used: true,
      chainId: 'a>b',
      summary: 'One or more guides failed',
    });
    expect(retireBody).not.toHaveProperty('reportUrl');
  });

  it('collects requiredPlugins from packageMetaById, deduplicating across chain entries', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse(leaseResponse(), 201, 'Created'));
    const manager = new CloudStackPoolManager(CONFIG, false, fetchImpl as unknown as typeof fetch);
    const packageMetaById = new Map<string, PackageMeta>([
      ['a', { packageId: 'a', plugins: ['grafana-asserts-app', 'grafana-oncall-app'] }],
      ['b', { packageId: 'b', plugins: ['grafana-asserts-app'] }],
      ['c', { packageId: 'c' }],
    ]);

    await manager.leaseForChain({ chain: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], packageMetaById });

    const createBody = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(createBody.requiredPlugins).toEqual([{ slug: 'grafana-asserts-app' }, { slug: 'grafana-oncall-app' }]);
  });

  it('sends empty requiredPlugins when no guide in the chain declares plugins', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse(leaseResponse(), 201, 'Created'));
    const manager = new CloudStackPoolManager(CONFIG, false, fetchImpl as unknown as typeof fetch);

    await manager.leaseForChain({
      chain: [{ id: 'a' }],
      packageMetaById: new Map([['a', { packageId: 'a' }]]),
    });

    const createBody = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(createBody.requiredPlugins).toEqual([]);
  });

  it('surfaces no capacity errors without leaking the manager token', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: 'no_capacity', message: 'no hot stack is available manager-secret' } },
          503,
          'Service Unavailable'
        )
      );
    const manager = new CloudStackPoolManager(CONFIG, false, fetchImpl as unknown as typeof fetch);

    await expect(manager.leaseForChain({ chain: [{ id: 'a' }], packageMetaById: new Map() })).rejects.toThrow(
      'no_capacity: no hot stack is available [redacted]'
    );
  });

  it('rejects malformed lease responses', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(leaseResponse({ runnerToken: undefined }), 201, 'Created'));
    const manager = new CloudStackPoolManager(CONFIG, false, fetchImpl as unknown as typeof fetch);

    await expect(manager.leaseForChain({ chain: [{ id: 'a' }], packageMetaById: new Map() })).rejects.toThrow(
      'runnerToken'
    );
  });

  it('returns a redacted cleanup warning when retire fails', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(leaseResponse(), 201, 'Created'))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 'cleanup_failed', message: 'bad manager-secret and runner-secret' } },
          500,
          'Internal Server Error'
        )
      );
    const manager = new CloudStackPoolManager(CONFIG, false, fetchImpl as unknown as typeof fetch);

    const lease = await manager.leaseForChain({ chain: [{ id: 'a' }], packageMetaById: new Map() });

    await expect(lease.teardownChain({ outcome: 'cancelled', summary: 'Interrupted' })).resolves.toEqual([
      'Failed to retire Cloud stack lease lease-1: cleanup_failed: bad [redacted] and [redacted]',
    ]);
  });
});
