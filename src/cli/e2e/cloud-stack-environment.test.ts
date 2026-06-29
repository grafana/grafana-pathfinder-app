import { existsSync, readFileSync } from 'fs';

import {
  CloudStackEnvironment,
  createCloudStackProvisioningConfig,
  sweepCloudStacks,
  type CommandRunner,
} from './cloud-stack-environment';

const CONFIG = {
  accessPolicyTokenEnvVar: 'GRAFANA_CLOUD_ACCESS_POLICY_TOKEN',
  accessPolicyToken: 'secret-token',
  region: 'prod-us-east-0',
  slugPrefix: 'pfe2e',
  pluginVersion: '1.2.3',
};

function pluginProbe(status = 200): typeof fetch {
  return jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 404 ? 'Not Found' : 'OK',
  })) as unknown as typeof fetch;
}

describe('createCloudStackProvisioningConfig', () => {
  it('returns undefined when no stack options are present', () => {
    expect(createCloudStackProvisioningConfig({ env: {} })).toBeUndefined();
  });

  it('loads the Cloud Access Policy token from an env var without changing manifest schema', () => {
    expect(
      createCloudStackProvisioningConfig({
        accessPolicyTokenEnvVar: 'TOKEN_ENV',
        region: 'us',
        slugPrefix: 'pathfinder-e2e',
        env: { TOKEN_ENV: 'token' },
      })
    ).toEqual({
      accessPolicyTokenEnvVar: 'TOKEN_ENV',
      accessPolicyToken: 'token',
      region: 'us',
      slugPrefix: 'pathfindere2',
      pluginVersion: undefined,
    });
  });

  it('rejects partial or invalid stack config', () => {
    expect(() => createCloudStackProvisioningConfig({ region: 'us', env: {} })).toThrow(
      /cloud-stack-access-policy-token/
    );
    expect(() =>
      createCloudStackProvisioningConfig({ accessPolicyTokenEnvVar: 'TOKEN_ENV', region: 'us', env: {} })
    ).toThrow(/TOKEN_ENV/);
    expect(() =>
      createCloudStackProvisioningConfig({ accessPolicyTokenEnvVar: '1_BAD', region: 'us', env: { '1_BAD': 'x' } })
    ).toThrow(/Invalid/);
  });
});

describe('CloudStackEnvironment', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(2_000_000_000_000);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('skips the Terraform plugin resource when Pathfinder is already installed', async () => {
    const calls: Array<{ args: string[]; cwd: string; token?: string }> = [];
    let generatedHcl = '';
    let moduleDir = '';
    const runner: CommandRunner = async (_command, args, options) => {
      calls.push({ args, cwd: options.cwd, token: options.env.TF_VAR_cloud_access_policy_token });
      moduleDir = options.cwd;
      if (args[0] === 'output') {
        generatedHcl = readFileSync(`${options.cwd}/main.tf`, 'utf-8');
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            stack_url: { value: 'https://pfe2eabc.grafana.net/' },
            stack_slug: { value: 'pfe2eabc' },
            service_account_token: { value: 'glsa_stack' },
          }),
          stderr: '',
        };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const fetchImpl = pluginProbe(200);
    const env = new CloudStackEnvironment(CONFIG, false, runner, fetchImpl);
    const provisioned = await env.provisionChain();

    expect(provisioned).toEqual({
      targetUrl: 'https://pfe2eabc.grafana.net/',
      stackSlug: 'pfe2eabc',
      token: 'glsa_stack',
    });
    expect(calls.map((call) => call.args[0])).toEqual(['init', 'apply', 'output']);
    expect(calls.every((call) => call.token === 'secret-token')).toBe(true);
    expect(generatedHcl).toContain('resource "grafana_cloud_stack" "e2e"');
    expect(generatedHcl).not.toContain('resource "grafana_cloud_plugin_installation" "pathfinder"');
    expect(generatedHcl).not.toContain('secret-token');
    expect(fetchImpl).toHaveBeenCalledWith('https://pfe2eabc.grafana.net/api/plugins/grafana-pathfinder-app/settings', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer glsa_stack',
        Accept: 'application/json',
      },
      signal: expect.any(AbortSignal),
    });

    await env.teardownChain();

    expect(calls.map((call) => call.args[0])).toEqual(['init', 'apply', 'output', 'destroy']);
    expect(existsSync(moduleDir)).toBe(false);
  });

  it('adds the Terraform plugin resource when Pathfinder is missing', async () => {
    const calls: string[] = [];
    const generatedHclByOutput: string[] = [];
    const runner: CommandRunner = async (_command, args, options) => {
      calls.push(args[0]!);
      if (args[0] === 'output') {
        generatedHclByOutput.push(readFileSync(`${options.cwd}/main.tf`, 'utf-8'));
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            stack_url: { value: 'https://pfe2eabc.grafana.net/' },
            stack_slug: { value: 'pfe2eabc' },
            service_account_token: { value: 'glsa_stack' },
          }),
          stderr: '',
        };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const env = new CloudStackEnvironment(CONFIG, false, runner, pluginProbe(404));
    await env.provisionChain();

    expect(calls).toEqual(['init', 'apply', 'output', 'apply', 'output']);
    expect(generatedHclByOutput[0]).not.toContain('grafana_cloud_plugin_installation');
    expect(generatedHclByOutput[1]).toContain('resource "grafana_cloud_plugin_installation" "pathfinder"');
    expect(generatedHclByOutput[1]).toContain('version    = "1.2.3"');
  });

  it('destroys any partially-created stack when Terraform output parsing fails', async () => {
    const calls: string[] = [];
    const runner: CommandRunner = async (_command, args) => {
      calls.push(args[0]!);
      if (args[0] === 'output') {
        return { exitCode: 0, stdout: JSON.stringify({}), stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const env = new CloudStackEnvironment(CONFIG, false, runner, pluginProbe(200));

    await expect(env.provisionChain()).rejects.toThrow(/terraform output/);
    expect(calls).toEqual(['init', 'apply', 'output', 'destroy']);
  });

  it('redacts the access token in Terraform errors', async () => {
    const runner: CommandRunner = async (_command, args) => {
      if (args[0] === 'apply') {
        return { exitCode: 1, stdout: '', stderr: 'bad secret-token' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const env = new CloudStackEnvironment(CONFIG, false, runner, pluginProbe(200));

    await expect(env.provisionChain()).rejects.toThrow('bad [redacted]');
  });

  it('logs and cleans local state when destroy fails', async () => {
    let moduleDir = '';
    const runner: CommandRunner = async (_command, args, options) => {
      moduleDir = options.cwd;
      if (args[0] === 'destroy') {
        return { exitCode: 1, stdout: '', stderr: 'nope' };
      }
      if (args[0] === 'output') {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            stack_url: { value: 'https://pfe2eabc.grafana.net/' },
            stack_slug: { value: 'pfe2eabc' },
            service_account_token: { value: 'glsa_stack' },
          }),
          stderr: '',
        };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const env = new CloudStackEnvironment(CONFIG, false, runner, pluginProbe(200));
    await env.provisionChain();
    await env.teardownChain();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to destroy Cloud stack'));
    expect(existsSync(moduleDir)).toBe(false);
  });
});

describe('sweepCloudStacks', () => {
  it('deletes only stale Pathfinder stacks matching the configured prefix', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      if ((init?.method ?? 'GET') === 'GET') {
        return {
          ok: true,
          json: async () => ({
            items: [
              {
                id: 1,
                slug: 'pfe2eold',
                labels: { 'pathfinder-e2e': 'true', 'pathfinder-e2e-created-at': '1000' },
              },
              {
                id: 2,
                slug: 'pfe2efresh',
                labels: { 'pathfinder-e2e': 'true', 'pathfinder-e2e-created-at': '1900' },
              },
              {
                id: 3,
                slug: 'otherold',
                labels: { 'pathfinder-e2e': 'true', 'pathfinder-e2e-created-at': '1000' },
              },
            ],
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;

    await sweepCloudStacks({ config: CONFIG, verbose: false, nowSeconds: 5_000, fetchImpl });

    expect(calls).toEqual([
      { url: 'https://grafana.com/api/instances', method: 'GET' },
      { url: 'https://grafana.com/api/instances/1', method: 'DELETE' },
    ]);
  });

  it('does not throw when sweeping fails', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchImpl = jest.fn(async () => ({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    })) as unknown as typeof fetch;

    await expect(sweepCloudStacks({ config: CONFIG, verbose: false, fetchImpl })).resolves.toBeUndefined();
    warnSpy.mockRestore();
  });
});
