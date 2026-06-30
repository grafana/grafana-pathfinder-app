import { existsSync, readFileSync } from 'fs';

import { CloudStackPool, CloudStackPoolLease, createCloudStackPoolConfig } from './cloud-stack-pool';
import type { CommandRunner } from './cloud-stack-environment';

const CONFIG = {
  poolId: 'pool-1',
  accessPolicyToken: 'cloud-access-policy',
  region: 'prod-us-east-3',
};

function stackListFetch(items: unknown[]): typeof fetch {
  return jest.fn(async () => ({ ok: true, json: async () => ({ items }) })) as unknown as typeof fetch;
}

describe('createCloudStackPoolConfig', () => {
  it('returns undefined when no pool token is configured', () => {
    expect(createCloudStackPoolConfig({ env: {} })).toBeUndefined();
  });

  it('loads a default pool config from only a Cloud Access Policy token env var', () => {
    expect(
      createCloudStackPoolConfig({
        accessPolicyTokenEnvVar: 'CLOUD_TOKEN',
        env: { CLOUD_TOKEN: 'token' },
      })
    ).toEqual({ accessPolicyToken: 'token', verbose: undefined });
  });

  it('loads pool config from a Cloud Access Policy token env var', () => {
    expect(
      createCloudStackPoolConfig({
        poolId: 'pool-1',
        accessPolicyTokenEnvVar: 'CLOUD_TOKEN',
        env: { CLOUD_TOKEN: 'token' },
      })
    ).toEqual({ poolId: 'pool-1', accessPolicyToken: 'token', verbose: undefined });
  });

  it('requires a valid Cloud Access Policy token env var when pool id is set', () => {
    expect(() => createCloudStackPoolConfig({ poolId: 'pool-1', env: {} })).toThrow(/Cloud stack pool/);
    expect(() =>
      createCloudStackPoolConfig({ poolId: 'pool-1', accessPolicyTokenEnvVar: 'TOKEN_ENV', env: {} })
    ).toThrow(/TOKEN_ENV/);
  });
});

describe('CloudStackPool', () => {
  it('leases any pool stack when no pool id is configured', async () => {
    const runner: CommandRunner = async (_command, args) =>
      args[0] === 'output'
        ? { exitCode: 0, stdout: JSON.stringify({ service_account_token: { value: 'runner-token' } }), stderr: '' }
        : { exitCode: 0, stdout: '', stderr: '' };
    const fetchImpl = stackListFetch([
      { slug: 'pool-a', labels: { 'pathfinder-e2e-pool': 'true', 'pathfinder-e2e-pool-id': 'other' } },
    ]);
    const pool = new CloudStackPool({ accessPolicyToken: 'cloud-access-policy' }, runner, fetchImpl);

    const lease = await pool.lease(undefined);

    expect(lease?.provisionChain().stackSlug).toBe('pool-a');
  });

  it('hydrates missing labels from stack detail responses before filtering', async () => {
    const runner: CommandRunner = async (_command, args) =>
      args[0] === 'output'
        ? { exitCode: 0, stdout: JSON.stringify({ service_account_token: { value: 'runner-token' } }), stderr: '' }
        : { exitCode: 0, stdout: '', stderr: '' };
    const fetchImpl = jest.fn(async (url: string) => {
      if (url === 'https://grafana.com/api/instances') {
        return { ok: true, json: async () => ({ items: [{ slug: 'pool-a' }] }) } as Response;
      }
      if (url === 'https://grafana.com/api/instances/pool-a') {
        return {
          ok: true,
          json: async () => ({
            slug: 'pool-a',
            labels: { 'pathfinder-e2e-pool': 'true' },
          }),
        } as Response;
      }
      return { ok: false } as Response;
    }) as unknown as typeof fetch;
    const pool = new CloudStackPool({ accessPolicyToken: 'cloud-access-policy' }, runner, fetchImpl);

    const lease = await pool.lease(undefined);

    expect(lease?.provisionChain().stackSlug).toBe('pool-a');
    expect(pool.diagnostics()).toContain('1 had pathfinder-e2e-pool=true');
  });

  it('records diagnostics when no pool stack can be leased', async () => {
    const fetchImpl = stackListFetch([
      { slug: 'not-pool', labels: {} },
      { slug: 'leased', labels: { 'pathfinder-e2e-pool': 'true', 'pathfinder-e2e-state': 'leased' } },
    ]);
    const pool = new CloudStackPool({ accessPolicyToken: 'cloud-access-policy' }, jest.fn(), fetchImpl);

    expect(await pool.lease(undefined)).toBeUndefined();
    expect(pool.diagnostics()).toBe(
      'listed 2 stack(s); 1 had pathfinder-e2e-pool=true; 1 matched pool id any; 0 were available.'
    );
  });
  it('discovers labeled available stacks, mints a runner token, and leases once', async () => {
    const calls: Array<{ args: string[]; cwd: string; token?: string }> = [];
    let generatedHcl = '';
    const runner: CommandRunner = async (_command, args, options) => {
      calls.push({ args, cwd: options.cwd, token: options.env.TF_VAR_cloud_access_policy_token });
      if (args[0] === 'output') {
        generatedHcl = readFileSync(`${options.cwd}/main.tf`, 'utf-8');
        return {
          exitCode: 0,
          stdout: JSON.stringify({ service_account_token: { value: 'runner-token' } }),
          stderr: '',
        };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const fetchImpl = stackListFetch([
      {
        slug: 'pool-a',
        labels: {
          'pathfinder-e2e-pool': 'true',
          'pathfinder-e2e-pool-id': 'pool-1',
          'pathfinder-e2e-state': 'available',
        },
      },
      {
        slug: 'other',
        labels: { 'pathfinder-e2e-pool': 'true', 'pathfinder-e2e-pool-id': 'other' },
      },
    ]);
    const pool = new CloudStackPool(CONFIG, runner, fetchImpl);

    const lease = await pool.lease(undefined);

    expect(lease?.provisionChain()).toEqual({
      targetUrl: 'https://pool-a.grafana.net/',
      token: 'runner-token',
      stackSlug: 'pool-a',
    });
    expect(calls.map((call) => call.args[0])).toEqual(['init', 'apply', 'output']);
    expect(calls.every((call) => call.token === 'cloud-access-policy')).toBe(true);
    expect(generatedHcl).toContain('stack_slug = "pool-a"');

    await lease?.teardownChain();

    expect(calls.map((call) => call.args[0])).toEqual(['init', 'apply', 'output', 'destroy', 'init', 'apply']);
    expect(existsSync(calls[0]!.cwd)).toBe(false);
    expect(await pool.lease(undefined)).toBeUndefined();
  });

  it('prefers a pool stack matching the requested origin', async () => {
    const runner: CommandRunner = async (_command, args) =>
      args[0] === 'output'
        ? { exitCode: 0, stdout: JSON.stringify({ service_account_token: { value: 'runner-token' } }), stderr: '' }
        : { exitCode: 0, stdout: '', stderr: '' };
    const fetchImpl = stackListFetch([
      { slug: 'pool-a', labels: { 'pathfinder-e2e-pool': 'true', 'pathfinder-e2e-pool-id': 'pool-1' } },
      { slug: 'pool-b', labels: { 'pathfinder-e2e-pool': 'true', 'pathfinder-e2e-pool-id': 'pool-1' } },
    ]);
    const pool = new CloudStackPool(CONFIG, runner, fetchImpl);

    const lease = await pool.lease('https://pool-b.grafana.net/');

    expect(lease?.provisionChain().stackSlug).toBe('pool-b');
  });

  it('returns undefined when no matching available stacks exist', async () => {
    const fetchImpl = stackListFetch([
      {
        slug: 'leased',
        labels: {
          'pathfinder-e2e-pool': 'true',
          'pathfinder-e2e-pool-id': 'pool-1',
          'pathfinder-e2e-state': 'leased',
        },
      },
      { slug: 'other', labels: { 'pathfinder-e2e-pool': 'true', 'pathfinder-e2e-pool-id': 'other' } },
    ]);
    const pool = new CloudStackPool(CONFIG, jest.fn(), fetchImpl);

    expect(await pool.lease(undefined)).toBeUndefined();
  });
});

describe('CloudStackPoolLease', () => {
  it('deletes the leased stack by default', async () => {
    const calls: Array<{ url: string; method: string; auth: string | undefined }> = [];
    const runner: CommandRunner = jest.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      calls.push({ url, method: init?.method ?? 'GET', auth: headers?.Authorization });
      return { ok: true } as Response;
    }) as unknown as typeof fetch;
    const lease = new CloudStackPoolLease(
      { targetUrl: 'https://pool-a.grafana.net/', token: 'runner-token', stackSlug: 'pool-a' },
      '/tmp/not-used',
      'cloud-access-policy',
      { region: 'prod-us-east-3' },
      runner,
      fetchImpl
    );

    await lease.teardownChain();

    expect(calls).toEqual([
      {
        url: 'https://grafana.com/api/instances/pool-a',
        method: 'DELETE',
        auth: 'Bearer cloud-access-policy',
      },
    ]);
    expect((runner as jest.Mock).mock.calls.map((call) => call[1][0])).toEqual(['destroy', 'init', 'apply']);
  });
});
