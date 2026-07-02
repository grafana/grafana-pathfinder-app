import { existsSync, readFileSync, statSync } from 'fs';

import {
  ColdCloudStackCleanupRegistry,
  ColdCloudStackEnvironment,
  createColdCloudStackProvisioningConfig,
  type ColdCloudStackProvisioningConfig,
  type CommandRunner,
} from './cold-cloud-stack-environment';

const CONFIG: ColdCloudStackProvisioningConfig = {
  accessPolicyTokenEnvVar: 'GRAFANA_CLOUD_ACCESS_POLICY_TOKEN',
  accessPolicyToken: 'secret-token',
  region: 'prod-us-east-0',
  slugPrefix: 'pfe2e',
  pluginVersion: '1.2.3',
};

function terraformOutput(token = 'glsa_stack'): string {
  return JSON.stringify({
    stack_url: { value: 'https://pfe2eabc.grafana.net/' },
    stack_slug: { value: 'pfe2eabc' },
    service_account_token: { value: token },
  });
}

function pluginProbe(status = 200): typeof fetch {
  return jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 404 ? 'Not Found' : 'Error',
  })) as unknown as typeof fetch;
}

describe('createColdCloudStackProvisioningConfig', () => {
  it('returns undefined when no stack options are present', () => {
    expect(createColdCloudStackProvisioningConfig({ env: {} })).toBeUndefined();
  });

  it('loads the Cloud Access Policy token from an env var and normalizes the slug prefix', () => {
    expect(
      createColdCloudStackProvisioningConfig({
        accessPolicyTokenEnvVar: 'TOKEN_ENV',
        region: 'prod-us-east-0',
        slugPrefix: 'Pathfinder E2E!',
        env: { TOKEN_ENV: 'token' },
      })
    ).toEqual({
      accessPolicyTokenEnvVar: 'TOKEN_ENV',
      accessPolicyToken: 'token',
      region: 'prod-us-east-0',
      slugPrefix: 'pathfindere2',
      pluginVersion: undefined,
    });
  });

  it('rejects partial or invalid stack config', () => {
    expect(() => createColdCloudStackProvisioningConfig({ region: 'prod-us-east-0', env: {} })).toThrow(
      /cloud-stack-access-policy-token/
    );
    expect(() =>
      createColdCloudStackProvisioningConfig({
        accessPolicyTokenEnvVar: 'TOKEN_ENV',
        region: 'prod-us-east-0',
        env: {},
      })
    ).toThrow(/TOKEN_ENV/);
    expect(() =>
      createColdCloudStackProvisioningConfig({
        accessPolicyTokenEnvVar: '1_BAD',
        region: 'prod-us-east-0',
        env: { '1_BAD': 'x' },
      })
    ).toThrow(/Invalid/);
    expect(() =>
      createColdCloudStackProvisioningConfig({
        accessPolicyTokenEnvVar: 'TOKEN_ENV',
        region: 'prod-us-east-0',
        slugPrefix: '123',
        env: { TOKEN_ENV: 'x' },
      })
    ).toThrow(/slug-prefix/);
  });
});

describe('ColdCloudStackCleanupRegistry', () => {
  it('tears down tracked stacks once and untracks them', async () => {
    const registry = new ColdCloudStackCleanupRegistry();
    const first = { teardownChain: jest.fn(async () => ['first warning']) };
    const second = { teardownChain: jest.fn(async () => []) };

    registry.track(first);
    registry.track(second);

    await expect(registry.teardownAll()).resolves.toEqual(['first warning']);
    await expect(registry.teardownAll()).resolves.toEqual([]);
    expect(first.teardownChain).toHaveBeenCalledTimes(1);
    expect(second.teardownChain).toHaveBeenCalledTimes(1);
  });

  it('returns a warning when a tracked stack teardown throws', async () => {
    const registry = new ColdCloudStackCleanupRegistry();
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

describe('ColdCloudStackEnvironment', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(2_000_000_000_000);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('skips the Terraform plugin resource when Pathfinder is already installed', async () => {
    const calls: Array<{ args: string[]; cwd: string; env: NodeJS.ProcessEnv }> = [];
    let generatedHcl = '';
    let moduleDir = '';
    const runner: CommandRunner = async (_command, args, options) => {
      calls.push({ args, cwd: options.cwd, env: options.env });
      moduleDir = options.cwd;
      if (args[0] === 'output') {
        generatedHcl = readFileSync(`${options.cwd}/main.tf`, 'utf-8');
        return { exitCode: 0, stdout: terraformOutput(), stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const fetchImpl = pluginProbe(200);
    const env = new ColdCloudStackEnvironment(CONFIG, false, runner, fetchImpl);
    const provisioned = await env.provisionChain();

    expect(provisioned).toEqual({
      targetUrl: 'https://pfe2eabc.grafana.net/',
      stackSlug: 'pfe2eabc',
      token: 'glsa_stack',
    });
    expect(calls.map((call) => call.args[0])).toEqual(['init', 'apply', 'output']);
    expect(calls.every((call) => call.env.TF_VAR_cloud_access_policy_token === 'secret-token')).toBe(true);
    expect(calls.every((call) => call.env.TF_VAR_cloud_stack_region === 'prod-us-east-0')).toBe(true);
    expect(calls.every((call) => call.env.TF_VAR_pathfinder_plugin_version === '1.2.3')).toBe(true);
    expect(generatedHcl).toContain('resource "grafana_cloud_stack" "e2e"');
    expect(generatedHcl).toContain('version = "~> 4.5"');
    expect(generatedHcl).toContain('"pathfinder-e2e-kind" = "cold-run"');
    expect(generatedHcl).not.toContain('resource "grafana_cloud_plugin_installation" "pathfinder"');
    expect(generatedHcl).not.toContain('secret-token');
    expect(statSync(moduleDir).mode & 0o777).toBe(0o700);
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
        return { exitCode: 0, stdout: terraformOutput(), stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const env = new ColdCloudStackEnvironment(CONFIG, false, runner, pluginProbe(404));
    await env.provisionChain();

    expect(calls).toEqual(['init', 'apply', 'output', 'apply', 'output']);
    expect(generatedHclByOutput[0]).not.toContain('grafana_cloud_plugin_installation');
    expect(generatedHclByOutput[1]).toContain('resource "grafana_cloud_plugin_installation" "pathfinder"');
    expect(generatedHclByOutput[1]).toContain('version = var.pathfinder_plugin_version');
  });

  it('passes operator-provided strings through Terraform variables instead of generated HCL', async () => {
    const unsafeConfig = {
      ...CONFIG,
      region: 'prod-us-east-0${bad}',
      pluginVersion: '1.2.3${bad}',
    };
    let generatedHcl = '';
    const envByCall: NodeJS.ProcessEnv[] = [];
    const runner: CommandRunner = async (_command, args, options) => {
      envByCall.push(options.env);
      if (args[0] === 'output') {
        generatedHcl = readFileSync(`${options.cwd}/main.tf`, 'utf-8');
        return { exitCode: 0, stdout: terraformOutput(), stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const env = new ColdCloudStackEnvironment(unsafeConfig, false, runner, pluginProbe(404));
    await env.provisionChain();
    expect(generatedHcl).toContain('region_slug = var.cloud_stack_region');
    expect(generatedHcl).toContain('version = var.pathfinder_plugin_version');
    expect(generatedHcl).not.toContain('${bad}');
    expect(envByCall.every((env) => env.TF_VAR_cloud_stack_region === 'prod-us-east-0${bad}')).toBe(true);
    expect(envByCall.every((env) => env.TF_VAR_pathfinder_plugin_version === '1.2.3${bad}')).toBe(true);
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

    const env = new ColdCloudStackEnvironment(CONFIG, false, runner, pluginProbe(200));

    await expect(env.provisionChain()).rejects.toThrow(/terraform output/);
    expect(calls).toEqual(['init', 'apply', 'output', 'destroy']);
  });

  it('destroys a partially-created stack when plugin probing fails', async () => {
    const calls: string[] = [];
    const runner: CommandRunner = async (_command, args) => {
      calls.push(args[0]!);
      if (args[0] === 'output') {
        return { exitCode: 0, stdout: terraformOutput(), stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const env = new ColdCloudStackEnvironment(CONFIG, false, runner, pluginProbe(500));

    await expect(env.provisionChain()).rejects.toThrow(/Pathfinder plugin probe failed/);
    expect(calls).toEqual(['init', 'apply', 'output', 'destroy']);
  });

  it('redacts the access token and minted token in Terraform errors', async () => {
    const runner: CommandRunner = async (_command, args) => {
      if (args[0] === 'output') {
        return { exitCode: 0, stdout: terraformOutput('glsa_minted'), stderr: '' };
      }
      if (args[0] === 'apply') {
        if (args.includes('-auto-approve')) {
          return { exitCode: 0, stdout: '', stderr: '' };
        }
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const failingRunner: CommandRunner = async (command, args, options) => {
      if (
        args[0] === 'apply' &&
        options.cwd &&
        readFileSync(`${options.cwd}/main.tf`, 'utf-8').includes('grafana_cloud_plugin_installation')
      ) {
        return { exitCode: 1, stdout: '', stderr: 'bad secret-token glsa_minted' };
      }
      return runner(command, args, options);
    };

    const env = new ColdCloudStackEnvironment(CONFIG, false, failingRunner, pluginProbe(404));

    await expect(env.provisionChain()).rejects.toThrow('bad [redacted] [redacted]');
  });

  it('returns warnings and cleans local state when destroy fails', async () => {
    let moduleDir = '';
    const runner: CommandRunner = async (_command, args, options) => {
      moduleDir = options.cwd;
      if (args[0] === 'destroy') {
        return { exitCode: 1, stdout: '', stderr: 'nope secret-token' };
      }
      if (args[0] === 'output') {
        return { exitCode: 0, stdout: terraformOutput(), stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const env = new ColdCloudStackEnvironment(CONFIG, false, runner, pluginProbe(200));
    await env.provisionChain();
    const warnings = await env.teardownChain();

    expect(warnings).toEqual([expect.stringContaining('Failed to destroy Cloud stack')]);
    expect(warnings[0]).toContain('[redacted]');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to destroy Cloud stack'));
    expect(existsSync(moduleDir)).toBe(false);
  });

  it('runs a single destroy when teardown is invoked concurrently', async () => {
    const calls: string[] = [];
    const runner: CommandRunner = async (_command, args) => {
      calls.push(args[0]!);
      if (args[0] === 'output') {
        return { exitCode: 0, stdout: terraformOutput(), stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const env = new ColdCloudStackEnvironment(CONFIG, false, runner, pluginProbe(200));
    await env.provisionChain();

    await Promise.all([env.teardownChain(), env.teardownChain()]);

    expect(calls.filter((arg) => arg === 'destroy')).toHaveLength(1);
  });
});
