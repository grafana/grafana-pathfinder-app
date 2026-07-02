import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CLOUD_STACK_FETCH_TIMEOUT_MS } from './shared-cloud-stack-environment';

const TERRAFORM_PROVIDER_VERSION = '~> 4.5';
const PLUGIN_ID = 'grafana-pathfinder-app';
const TOKEN_TTL_SECONDS = 3600;
export const DEFAULT_CLOUD_STACK_SLUG_PREFIX = 'pfe2e';

export interface ColdCloudStackConfigInput {
  accessPolicyTokenEnvVar?: string;
  region?: string;
  slugPrefix?: string;
  pluginVersion?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ColdCloudStackProvisioningConfig {
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

interface CloudStackTeardownTarget {
  teardownChain(): Promise<string[]>;
}

export class ColdCloudStackCleanupRegistry {
  private readonly targets = new Set<CloudStackTeardownTarget>();

  track(target: CloudStackTeardownTarget): void {
    this.targets.add(target);
  }

  untrack(target: CloudStackTeardownTarget): void {
    this.targets.delete(target);
  }

  async teardownAll(): Promise<string[]> {
    const warnings: string[] = [];
    const targets = [...this.targets];
    for (const target of targets) {
      try {
        warnings.push(...(await target.teardownChain()));
      } catch (err) {
        warnings.push(`Failed to tear down active Cloud stack: ${errorMessage(err)}`);
      } finally {
        this.untrack(target);
      }
    }
    return warnings;
  }
}

function hasAnyStackConfig(input: ColdCloudStackConfigInput): boolean {
  return Boolean(input.accessPolicyTokenEnvVar || input.region || input.slugPrefix || input.pluginVersion);
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

function requireNonEmptyOption(value: string | undefined, missingMessage: string): string {
  if (value === undefined) {
    throw new Error(missingMessage);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${missingMessage} The provided value must not be empty.`);
  }
  return trimmed;
}

export function createColdCloudStackProvisioningConfig(
  input: ColdCloudStackConfigInput
): ColdCloudStackProvisioningConfig | undefined {
  if (!hasAnyStackConfig(input)) {
    return undefined;
  }

  const env = input.env ?? process.env;
  const envVar = requireNonEmptyOption(
    input.accessPolicyTokenEnvVar,
    '--cloud-stack-access-policy-token is required when Cloud stack provisioning options are set'
  );
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envVar)) {
    throw new Error(`Invalid --cloud-stack-access-policy-token env var "${envVar}".`);
  }
  const accessPolicyToken = env[envVar];
  if (!accessPolicyToken) {
    throw new Error(`--cloud-stack-access-policy-token references unset or empty environment variable ${envVar}.`);
  }

  return {
    accessPolicyTokenEnvVar: envVar,
    accessPolicyToken,
    region: requireNonEmptyOption(
      input.region,
      '--cloud-stack-region is required when Cloud stack provisioning is enabled'
    ),
    slugPrefix: normalizeSlugPrefix(input.slugPrefix ?? DEFAULT_CLOUD_STACK_SLUG_PREFIX),
    pluginVersion: input.pluginVersion?.trim() || undefined,
  };
}

function generatedStackSlug(prefix: string): string {
  const suffix = `${Date.now().toString(36)}${randomUUID().replace(/-/g, '').slice(0, 6)}`;
  return `${prefix}${suffix}`.slice(0, 29);
}

function hclString(value: string): string {
  return JSON.stringify(value);
}

function hclStringMap(value: Record<string, string>): string {
  return Object.entries(value)
    .map(([key, mapValue]) => `    ${hclString(key)} = ${hclString(mapValue)}`)
    .join('\n');
}

function pathfinderPluginResource(): string {
  return `
resource "grafana_cloud_plugin_installation" "pathfinder" {
  provider = grafana.cloud
  stack_slug = grafana_cloud_stack.e2e.slug
  slug = ${hclString(PLUGIN_ID)}
  version = var.pathfinder_plugin_version
}
`;
}

function terraformModule(options: {
  slug: string;
  createdAtSeconds: number;
  runId: string;
  installPathfinderPlugin: boolean;
}): string {
  const labels = {
    'pathfinder-e2e': 'true',
    'pathfinder-e2e-kind': 'cold-run',
    'pathfinder-e2e-created-at': String(options.createdAtSeconds),
    'pathfinder-e2e-run-id': options.runId,
  };

  return `terraform {
  required_providers {
    grafana = {
      source = "grafana/grafana"
      version = ${hclString(TERRAFORM_PROVIDER_VERSION)}
    }
  }
}

variable "cloud_access_policy_token" {
  type = string
  sensitive = true
}

variable "cloud_stack_region" {
  type = string
}

variable "pathfinder_plugin_version" {
  type = string
}

provider "grafana" {
  alias = "cloud"
  cloud_access_policy_token = var.cloud_access_policy_token
}

resource "grafana_cloud_stack" "e2e" {
  provider = grafana.cloud
  name = ${hclString(options.slug)}
  slug = ${hclString(options.slug)}
  region_slug = var.cloud_stack_region
  delete_protection = false
  labels = {
${hclStringMap(labels)}
  }
}
${options.installPathfinderPlugin ? pathfinderPluginResource() : ''}

resource "grafana_cloud_stack_service_account" "e2e" {
  provider = grafana.cloud
  stack_slug = grafana_cloud_stack.e2e.slug
  name = "pathfinder-e2e"
  role = "Admin"
}

resource "grafana_cloud_stack_service_account_token" "e2e" {
  provider = grafana.cloud
  stack_slug = grafana_cloud_stack.e2e.slug
  name = "pathfinder-e2e"
  service_account_id = grafana_cloud_stack_service_account.e2e.id
  seconds_to_live = ${TOKEN_TTL_SECONDS}
}

output "stack_url" {
  value = grafana_cloud_stack.e2e.url
}

output "stack_slug" {
  value = grafana_cloud_stack.e2e.slug
}

output "service_account_token" {
  value = grafana_cloud_stack_service_account_token.e2e.key
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

function terraformEnv(config: ColdCloudStackProvisioningConfig): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TF_IN_AUTOMATION: '1',
    TF_VAR_cloud_access_policy_token: config.accessPolicyToken,
    TF_VAR_cloud_stack_region: config.region,
    TF_VAR_pathfinder_plugin_version: config.pluginVersion ?? 'latest',
  };
}

function parseTerraformOutput(text: string): ProvisionedCloudStack {
  const parsed = JSON.parse(text) as TerraformOutput;
  const targetUrl = parsed.stack_url?.value;
  const token = parsed.service_account_token?.value;
  const stackSlug = parsed.stack_slug?.value;
  if (typeof targetUrl !== 'string' || typeof token !== 'string' || typeof stackSlug !== 'string') {
    throw new Error('terraform output did not include stack_url, stack_slug, and service_account_token string values.');
  }
  return { targetUrl, token, stackSlug };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

export class ColdCloudStackEnvironment {
  private moduleDir: string | null = null;
  private currentStackSlug: string | null = null;
  private teardownPromise: Promise<string[]> | null = null;
  private readonly secrets: string[];

  constructor(
    private readonly config: ColdCloudStackProvisioningConfig,
    private readonly verbose: boolean,
    private readonly runner: CommandRunner = defaultCommandRunner,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.secrets = [config.accessPolicyToken];
  }

  async provisionChain(): Promise<ProvisionedCloudStack> {
    const slug = generatedStackSlug(this.config.slugPrefix);
    const moduleDir = mkdtempSync(join(tmpdir(), 'pathfinder-e2e-stack-'));
    chmodSync(moduleDir, 0o700);
    const createdAtSeconds = Math.floor(Date.now() / 1000);
    const runId = randomUUID();
    const modulePath = join(moduleDir, 'main.tf');

    this.moduleDir = moduleDir;
    this.currentStackSlug = slug;
    writeFileSync(modulePath, terraformModule({ slug, createdAtSeconds, runId, installPathfinderPlugin: false }));

    try {
      await this.runTerraform(['init', '-input=false', '-no-color'], 'init');
      await this.runTerraform(['apply', '-input=false', '-auto-approve', '-no-color'], 'apply');
      const output = await this.runTerraform(['output', '-json', '-no-color'], 'output');
      let provisioned = parseTerraformOutput(output.stdout);
      this.secrets.push(provisioned.token);

      if (!(await this.isPathfinderPluginInstalled(provisioned))) {
        writeFileSync(modulePath, terraformModule({ slug, createdAtSeconds, runId, installPathfinderPlugin: true }));
        await this.runTerraform(['apply', '-input=false', '-auto-approve', '-no-color'], 'apply');
        const updatedOutput = await this.runTerraform(['output', '-json', '-no-color'], 'output');
        provisioned = parseTerraformOutput(updatedOutput.stdout);
        this.secrets.push(provisioned.token);
      } else if (this.verbose) {
        console.log(`   ☁️ Pathfinder plugin already installed on ${provisioned.stackSlug}; skipping plugin install`);
      }

      if (this.verbose) {
        console.log(`   ☁️ Provisioned Cloud stack ${provisioned.stackSlug} (${provisioned.targetUrl})`);
      }
      return provisioned;
    } catch (err) {
      await this.teardownChain();
      throw new Error(redact(errorMessage(err), this.secrets));
    }
  }

  teardownChain(): Promise<string[]> {
    return (this.teardownPromise ??= this.runTeardown());
  }

  private async runTeardown(): Promise<string[]> {
    const moduleDir = this.moduleDir;
    if (!moduleDir) {
      return [];
    }

    const warnings: string[] = [];
    try {
      await this.runTerraform(
        ['destroy', '-input=false', '-auto-approve', '-lock-timeout=60s', '-no-color'],
        'destroy'
      );
      if (this.verbose && this.currentStackSlug) {
        console.log(`   🧹 Destroyed Cloud stack ${this.currentStackSlug}`);
      }
    } catch (err) {
      const slug = this.currentStackSlug ?? 'unknown';
      const warning = `Failed to destroy Cloud stack ${slug}: ${redact(errorMessage(err), this.secrets)}`;
      warnings.push(warning);
      console.warn(`   ⚠ ${warning}`);
    } finally {
      rmSync(moduleDir, { recursive: true, force: true });
      this.moduleDir = null;
      this.currentStackSlug = null;
    }
    return warnings;
  }

  async teardownAll(): Promise<string[]> {
    return this.teardownChain();
  }

  private async runTerraform(args: string[], action: string): Promise<CommandResult> {
    if (!this.moduleDir) {
      throw new Error('Terraform module directory has not been initialized.');
    }
    const result = await this.runner('terraform', args, { cwd: this.moduleDir, env: terraformEnv(this.config) });
    if (result.exitCode !== 0) {
      const detail = redact(result.stderr || result.stdout || `exit ${result.exitCode}`, this.secrets);
      throw new Error(`terraform ${action} failed: ${detail}`);
    }
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
      signal: AbortSignal.timeout(CLOUD_STACK_FETCH_TIMEOUT_MS),
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
