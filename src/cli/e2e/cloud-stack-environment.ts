import { spawn } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

const TERRAFORM_PROVIDER_VERSION = '>= 4.5.3';
const PLUGIN_ID = 'grafana-pathfinder-app';
const TOKEN_TTL_SECONDS = 3600;
const SWEEP_GRACE_SECONDS = 300;
export const DEFAULT_CLOUD_STACK_SLUG_PREFIX = 'pfe2e';

export interface CloudStackConfigInput {
  accessPolicyTokenEnvVar?: string;
  region?: string;
  slugPrefix?: string;
  pluginVersion?: string;
  env?: NodeJS.ProcessEnv;
}

export interface CloudStackProvisioningConfig {
  accessPolicyTokenEnvVar: string;
  accessPolicyToken: string;
  region: string;
  slugPrefix: string;
  pluginVersion?: string;
}

export interface ProvisionedCloudStack {
  targetUrl: string;
  token: string;
  stackSlug: string;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
) => Promise<CommandResult>;

interface TerraformOutput {
  stack_url?: { value?: unknown };
  stack_slug?: { value?: unknown };
  service_account_token?: { value?: unknown };
}

interface CloudStackListResponse {
  items?: Array<{ id?: string | number; slug?: string; labels?: Record<string, string> }>;
}

export function createCloudStackProvisioningConfig(
  input: CloudStackConfigInput
): CloudStackProvisioningConfig | undefined {
  if (!input.accessPolicyTokenEnvVar && !input.region && !input.pluginVersion) {
    return undefined;
  }
  const env = input.env ?? process.env;
  const envVar = input.accessPolicyTokenEnvVar;
  if (!envVar) {
    throw new Error('--cloud-stack-access-policy-token is required when Cloud stack provisioning options are set.');
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envVar)) {
    throw new Error(`Invalid --cloud-stack-access-policy-token env var "${envVar}".`);
  }
  const accessPolicyToken = env[envVar];
  if (!accessPolicyToken) {
    throw new Error(`--cloud-stack-access-policy-token references unset or empty environment variable ${envVar}.`);
  }
  if (!input.region) {
    throw new Error('--cloud-stack-region is required when Cloud stack provisioning is enabled.');
  }
  const slugPrefix = normalizeSlugPrefix(input.slugPrefix ?? DEFAULT_CLOUD_STACK_SLUG_PREFIX);
  return {
    accessPolicyTokenEnvVar: envVar,
    accessPolicyToken,
    region: input.region,
    slugPrefix,
    pluginVersion: input.pluginVersion,
  };
}

function normalizeSlugPrefix(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!/^[a-z][a-z0-9]*$/.test(normalized)) {
    throw new Error(
      '--cloud-stack-slug-prefix must contain at least one letter and only alphanumeric characters after normalization.'
    );
  }
  return normalized.slice(0, 12);
}

function stackSlug(prefix: string): string {
  const suffix = `${Date.now().toString(36)}${randomUUID().replace(/-/g, '').slice(0, 6)}`;
  return `${prefix}${suffix}`.slice(0, 29);
}

function pathfinderPluginResource(config: CloudStackProvisioningConfig): string {
  const pluginVersion = config.pluginVersion ?? '';
  return `
resource "grafana_cloud_plugin_installation" "pathfinder" {
  provider   = grafana.cloud
  stack_slug = grafana_cloud_stack.e2e.slug
  slug       = "${PLUGIN_ID}"
  version    = "${pluginVersion || 'latest'}"
}
`;
}

function terraformModule(
  config: CloudStackProvisioningConfig,
  slug: string,
  createdAtSeconds: number,
  installPathfinderPlugin: boolean
): string {
  return `terraform {
  required_providers {
    grafana = {
      source  = "grafana/grafana"
      version = "${TERRAFORM_PROVIDER_VERSION}"
    }
  }
}

variable "cloud_access_policy_token" {
  type      = string
  sensitive = true
}

provider "grafana" {
  alias                     = "cloud"
  cloud_access_policy_token = var.cloud_access_policy_token
}

resource "grafana_cloud_stack" "e2e" {
  provider          = grafana.cloud
  name              = "${slug}"
  slug              = "${slug}"
  region_slug       = "${config.region}"
  delete_protection = false
  labels = {
    "pathfinder-e2e"            = "true"
    "pathfinder-e2e-created-at" = "${createdAtSeconds}"
    "pathfinder-e2e-run-id"     = "${randomUUID()}"
  }
}
${installPathfinderPlugin ? pathfinderPluginResource(config) : ''}

resource "grafana_cloud_stack_service_account" "e2e" {
  provider   = grafana.cloud
  stack_slug = grafana_cloud_stack.e2e.slug
  name       = "pathfinder-e2e"
  role       = "Admin"
}

resource "grafana_cloud_stack_service_account_token" "e2e" {
  provider           = grafana.cloud
  stack_slug         = grafana_cloud_stack.e2e.slug
  name               = "pathfinder-e2e"
  service_account_id = grafana_cloud_stack_service_account.e2e.id
  seconds_to_live    = ${TOKEN_TTL_SECONDS}
}

output "stack_url" {
  value = grafana_cloud_stack.e2e.url
}

output "stack_slug" {
  value = grafana_cloud_stack.e2e.slug
}

output "service_account_token" {
  value     = grafana_cloud_stack_service_account_token.e2e.key
  sensitive = true
}
`;
}

async function defaultCommandRunner(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

function redact(text: string, secrets: string[]): string {
  return secrets.reduce((current, secret) => (secret ? current.split(secret).join('[redacted]') : current), text);
}

function assertTerraformSuccess(result: CommandResult, action: string, secrets: string[]): void {
  if (result.exitCode === 0) {
    return;
  }
  const detail = redact(result.stderr || result.stdout || `exit ${result.exitCode}`, secrets);
  throw new Error(`terraform ${action} failed: ${detail}`);
}

function terraformEnv(config: CloudStackProvisioningConfig): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TF_IN_AUTOMATION: '1',
    TF_VAR_cloud_access_policy_token: config.accessPolicyToken,
  };
}

function parseTerraformOutput(text: string): ProvisionedCloudStack {
  const parsed = JSON.parse(text) as TerraformOutput;
  const targetUrl = parsed.stack_url?.value;
  const token = parsed.service_account_token?.value;
  const stackSlugValue = parsed.stack_slug?.value;
  if (typeof targetUrl !== 'string' || typeof token !== 'string' || typeof stackSlugValue !== 'string') {
    throw new Error('terraform output did not include stack_url, stack_slug, and service_account_token string values.');
  }
  return { targetUrl, token, stackSlug: stackSlugValue };
}

export class CloudStackEnvironment {
  private moduleDir: string | null = null;
  private currentStackSlug: string | null = null;

  constructor(
    private readonly config: CloudStackProvisioningConfig,
    private readonly verbose: boolean,
    private readonly runner: CommandRunner = defaultCommandRunner,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async provisionChain(): Promise<ProvisionedCloudStack> {
    const slug = stackSlug(this.config.slugPrefix);
    const moduleDir = mkdtempSync(join(tmpdir(), 'pathfinder-e2e-stack-'));
    this.moduleDir = moduleDir;
    this.currentStackSlug = slug;
    const createdAtSeconds = Math.floor(Date.now() / 1000);
    const modulePath = join(moduleDir, 'main.tf');
    writeFileSync(modulePath, terraformModule(this.config, slug, createdAtSeconds, false));

    try {
      await this.runTerraform(['init', '-input=false', '-no-color'], 'init');
      await this.runTerraform(['apply', '-input=false', '-auto-approve', '-no-color'], 'apply');
      const output = await this.runTerraform(['output', '-json', '-no-color'], 'output');
      let provisioned = parseTerraformOutput(output.stdout);
      const pathfinderAlreadyInstalled = await this.isPathfinderPluginInstalled(provisioned);
      if (!pathfinderAlreadyInstalled) {
        writeFileSync(modulePath, terraformModule(this.config, slug, createdAtSeconds, true));
        await this.runTerraform(['apply', '-input=false', '-auto-approve', '-no-color'], 'apply');
        const updatedOutput = await this.runTerraform(['output', '-json', '-no-color'], 'output');
        provisioned = parseTerraformOutput(updatedOutput.stdout);
      } else if (this.verbose) {
        console.log(`   ☁️  Pathfinder plugin already installed on ${provisioned.stackSlug}; skipping plugin install`);
      }
      if (this.verbose) {
        console.log(`   ☁️  Provisioned Cloud stack ${provisioned.stackSlug} (${provisioned.targetUrl})`);
      }
      return provisioned;
    } catch (err) {
      await this.teardownChain();
      throw err;
    }
  }

  async teardownChain(): Promise<void> {
    const moduleDir = this.moduleDir;
    if (!moduleDir) {
      return;
    }
    try {
      await this.runTerraform(['destroy', '-input=false', '-auto-approve', '-no-color'], 'destroy');
      if (this.verbose && this.currentStackSlug) {
        console.log(`   🧹 Destroyed Cloud stack ${this.currentStackSlug}`);
      }
    } catch (err) {
      const slug = this.currentStackSlug ?? 'unknown';
      console.warn(
        `   ⚠ Failed to destroy Cloud stack ${slug}: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    } finally {
      rmSync(moduleDir, { recursive: true, force: true });
      this.moduleDir = null;
      this.currentStackSlug = null;
    }
  }

  async teardownAll(): Promise<void> {
    await this.teardownChain();
  }

  private async runTerraform(args: string[], action: string): Promise<CommandResult> {
    if (!this.moduleDir) {
      throw new Error('Terraform module directory has not been initialized.');
    }
    const result = await this.runner('terraform', args, {
      cwd: this.moduleDir,
      env: terraformEnv(this.config),
    });
    assertTerraformSuccess(result, action, [this.config.accessPolicyToken]);
    return result;
  }

  private async isPathfinderPluginInstalled(stack: ProvisionedCloudStack): Promise<boolean> {
    const url = new URL(`/api/plugins/${PLUGIN_ID}/settings`, stack.targetUrl).toString();
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${stack.token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      return true;
    }
    if (response.status === 404) {
      return false;
    }
    throw new Error(`Pathfinder plugin probe failed: HTTP ${response.status} ${response.statusText}`);
  }
}

export async function sweepCloudStacks(options: {
  config: CloudStackProvisioningConfig;
  verbose: boolean;
  nowSeconds?: number;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl('https://grafana.com/api/instances', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${options.config.accessPolicyToken}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as CloudStackListResponse;
    const stale = (data.items ?? []).filter((item) => {
      const createdAt = Number(item.labels?.['pathfinder-e2e-created-at']);
      return (
        item.labels?.['pathfinder-e2e'] === 'true' &&
        typeof item.slug === 'string' &&
        item.slug.startsWith(options.config.slugPrefix) &&
        Number.isFinite(createdAt) &&
        now - createdAt > TOKEN_TTL_SECONDS + SWEEP_GRACE_SECONDS
      );
    });
    for (const stack of stale) {
      const id = stack.id ?? stack.slug;
      if (id === undefined) {
        continue;
      }
      try {
        await fetchImpl(`https://grafana.com/api/instances/${encodeURIComponent(String(id))}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${options.config.accessPolicyToken}`,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        // Best effort.
      }
    }
    if (options.verbose && stale.length > 0) {
      console.log(`   🧹 Swept ${stale.length} stale Cloud stack(s)`);
    }
  } catch (err) {
    console.warn(`   ⚠ Could not sweep stale Cloud stacks: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}
