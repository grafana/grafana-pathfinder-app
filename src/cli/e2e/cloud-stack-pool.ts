import { spawn } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

import { sameOrigin } from './e2e-targets';
import type { CommandResult, CommandRunner, ProvisionedCloudStack } from './cloud-stack-environment';
import { createCloudStackPoolStack } from './cloud-stack-pool-create';

const TOKEN_TTL_SECONDS = 3600;
const TERRAFORM_PROVIDER_VERSION = '>= 4.5.3';

export interface CloudStackPoolConfigInput {
  poolId?: string;
  accessPolicyTokenEnvVar?: string;
  region?: string;
  slugPrefix?: string;
  verbose?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface CloudStackPoolConfig {
  poolId?: string;
  accessPolicyToken: string;
  region?: string;
  slugPrefix?: string;
  verbose?: boolean;
}

interface CloudStackListResponse {
  items?: CloudStackListItem[];
}

interface CloudStackListItem {
  id?: string | number;
  slug?: string;
  url?: string;
  region?: string;
  regionSlug?: string;
  labels?: Record<string, string>;
}

interface TerraformOutput {
  service_account_token?: { value?: unknown };
}

export function createCloudStackPoolConfig(input: CloudStackPoolConfigInput): CloudStackPoolConfig | undefined {
  if (!input.poolId && !input.accessPolicyTokenEnvVar) {
    return undefined;
  }
  const accessPolicyToken = parseAccessPolicyToken(input.accessPolicyTokenEnvVar, input.env ?? process.env);
  return {
    poolId: input.poolId,
    accessPolicyToken,
    region: input.region,
    slugPrefix: input.slugPrefix,
    verbose: input.verbose,
  };
}

function parseAccessPolicyToken(envVar: string | undefined, env: NodeJS.ProcessEnv): string {
  if (!envVar) {
    throw new Error('--cloud-stack-access-policy-token is required to use a Cloud stack pool.');
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envVar)) {
    throw new Error(`Invalid --cloud-stack-access-policy-token env var "${envVar}".`);
  }
  const token = env[envVar];
  if (!token) {
    throw new Error(`--cloud-stack-access-policy-token references unset or empty environment variable ${envVar}.`);
  }
  return token;
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

function runnerEnv(accessPolicyToken: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TF_IN_AUTOMATION: '1',
    TF_VAR_cloud_access_policy_token: accessPolicyToken,
  };
}

function tokenModule(stackSlug: string): string {
  const name = `pathfinder-e2e-${randomUUID().slice(0, 8)}`;
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

resource "grafana_cloud_stack_service_account" "runner" {
  provider   = grafana.cloud
  stack_slug = "${stackSlug}"
  name       = "${name}"
  role       = "Admin"
}

resource "grafana_cloud_stack_service_account_token" "runner" {
  provider           = grafana.cloud
  stack_slug         = "${stackSlug}"
  name               = "${name}"
  service_account_id = grafana_cloud_stack_service_account.runner.id
  seconds_to_live    = ${TOKEN_TTL_SECONDS}
}

output "service_account_token" {
  value     = grafana_cloud_stack_service_account_token.runner.key
  sensitive = true
}
`;
}

function stackUrl(stack: CloudStackListItem): string | undefined {
  if (stack.url) {
    return new URL('/', stack.url).toString();
  }
  if (stack.slug) {
    return `https://${stack.slug}.grafana.net/`;
  }
  return undefined;
}

function isAvailablePoolStack(stack: CloudStackListItem, poolId: string | undefined): boolean {
  const labels = stack.labels ?? {};
  const state = labels['pathfinder-e2e-state'];
  return (
    labels['pathfinder-e2e-pool'] === 'true' &&
    (poolId === undefined || labels['pathfinder-e2e-pool-id'] === poolId) &&
    (!state || state === 'available') &&
    typeof stack.slug === 'string'
  );
}

function redact(text: string, secret: string): string {
  return secret ? text.split(secret).join('[redacted]') : text;
}

function assertCommandSuccess(result: CommandResult, action: string, accessPolicyToken: string): void {
  if (result.exitCode === 0) {
    return;
  }
  const detail = redact(result.stderr || result.stdout || `exit ${result.exitCode}`, accessPolicyToken);
  throw new Error(`terraform ${action} failed: ${detail}`);
}

function parseTokenOutput(text: string): string {
  const parsed = JSON.parse(text) as TerraformOutput;
  const token = parsed.service_account_token?.value;
  if (typeof token !== 'string') {
    throw new Error('terraform output did not include service_account_token string value.');
  }
  return token;
}

interface LeasablePoolStack {
  targetUrl: string;
  stackSlug: string;
  region?: string;
}

export class CloudStackPool {
  private readonly leasedSlugs = new Set<string>();
  private lastDiagnostics: string | undefined;

  constructor(
    private readonly config: CloudStackPoolConfig,
    private readonly runner: CommandRunner = defaultCommandRunner,
    private readonly fetchImpl?: typeof fetch
  ) {}

  async lease(targetUrl: string | undefined): Promise<CloudStackPoolLease | undefined> {
    const candidates = await this.availableStacks();
    const matchingIndex = targetUrl
      ? candidates.findIndex((candidate) => sameOrigin(candidate.targetUrl, targetUrl))
      : -1;
    const target = candidates[matchingIndex >= 0 ? matchingIndex : 0];
    if (!target) {
      return undefined;
    }
    this.leasedSlugs.add(target.stackSlug);
    const moduleDir = mkdtempSync(join(tmpdir(), 'pathfinder-e2e-pool-'));
    writeFileSync(join(moduleDir, 'main.tf'), tokenModule(target.stackSlug));
    const env = runnerEnv(this.config.accessPolicyToken);

    try {
      await this.runTerraform(moduleDir, ['init', '-input=false', '-no-color'], 'init', env);
      await this.runTerraform(moduleDir, ['apply', '-input=false', '-auto-approve', '-no-color'], 'apply', env);
      const output = await this.runTerraform(moduleDir, ['output', '-json', '-no-color'], 'output', env);
      const token = parseTokenOutput(output.stdout);
      return new CloudStackPoolLease(
        { ...target, token },
        moduleDir,
        this.config.accessPolicyToken,
        {
          region: target.region ?? this.config.region,
          poolId: this.config.poolId,
          slugPrefix: this.config.slugPrefix,
          verbose: this.config.verbose,
        },
        this.runner,
        this.fetchImpl
      );
    } catch (err) {
      rmSync(moduleDir, { recursive: true, force: true });
      this.leasedSlugs.delete(target.stackSlug);
      throw err;
    }
  }

  diagnostics(): string | undefined {
    return this.lastDiagnostics;
  }

  private async availableStacks(): Promise<LeasablePoolStack[]> {
    const fetchImpl = this.fetchImpl ?? fetch;
    const headers = {
      Authorization: `Bearer ${this.config.accessPolicyToken}`,
      Accept: 'application/json',
    };
    const response = await fetchImpl('https://grafana.com/api/instances', {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const poolLabel = this.config.poolId ?? 'default';
      throw new Error(`Could not list Cloud stack pool "${poolLabel}": HTTP ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as CloudStackListResponse;
    const items = await hydrateStackDetails(data.items ?? [], headers, fetchImpl);
    const poolStacks = items.filter((stack) => stack.labels?.['pathfinder-e2e-pool'] === 'true');
    const poolLabel = this.config.poolId ?? 'any';
    const matchingPoolId = poolStacks.filter((stack) =>
      this.config.poolId === undefined ? true : stack.labels?.['pathfinder-e2e-pool-id'] === this.config.poolId
    );
    const available = matchingPoolId.filter((stack) => {
      const state = stack.labels?.['pathfinder-e2e-state'];
      return !state || state === 'available';
    });
    this.lastDiagnostics = `listed ${items.length} stack(s); ${poolStacks.length} had pathfinder-e2e-pool=true; ${matchingPoolId.length} matched pool id ${poolLabel}; ${available.length} were available.`;
    if (this.config.verbose) {
      console.log(`   ☁️  Cloud stack pool: ${this.lastDiagnostics}`);
    }
    return items
      .filter((stack) => isAvailablePoolStack(stack, this.config.poolId))
      .filter((stack) => !this.leasedSlugs.has(stack.slug!))
      .flatMap((stack) => {
        const targetUrl = stackUrl(stack);
        const region = stack.regionSlug ?? stack.region;
        return targetUrl && stack.slug ? [{ targetUrl, stackSlug: stack.slug, region }] : [];
      });
  }

  private async runTerraform(
    cwd: string,
    args: string[],
    action: string,
    env: NodeJS.ProcessEnv
  ): Promise<CommandResult> {
    const result = await this.runner('terraform', args, { cwd, env });
    assertCommandSuccess(result, action, this.config.accessPolicyToken);
    return result;
  }
}

async function hydrateStackDetails(
  stacks: CloudStackListItem[],
  headers: Record<string, string>,
  fetchImpl: typeof fetch
): Promise<CloudStackListItem[]> {
  return Promise.all(
    stacks.map(async (stack) => {
      if (stack.labels !== undefined || !stack.slug) {
        return stack;
      }
      try {
        const response = await fetchImpl(`https://grafana.com/api/instances/${encodeURIComponent(stack.slug)}`, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
          return stack;
        }
        const detail = (await response.json()) as CloudStackListItem;
        return { ...stack, ...detail };
      } catch {
        return stack;
      }
    })
  );
}

export class CloudStackPoolLease {
  constructor(
    private readonly stack: ProvisionedCloudStack,
    private readonly moduleDir: string,
    private readonly accessPolicyToken: string,
    private readonly replacement: {
      region?: string;
      poolId?: string;
      slugPrefix?: string;
      verbose?: boolean;
    },
    private readonly runner: CommandRunner = defaultCommandRunner,
    private readonly fetchImpl?: typeof fetch
  ) {}

  provisionChain(): ProvisionedCloudStack {
    return this.stack;
  }

  async teardownChain(): Promise<void> {
    try {
      const result = await this.runner('terraform', ['destroy', '-input=false', '-auto-approve', '-no-color'], {
        cwd: this.moduleDir,
        env: runnerEnv(this.accessPolicyToken),
      });
      assertCommandSuccess(result, 'destroy', this.accessPolicyToken);
    } catch (err) {
      console.warn(
        `   ⚠ Failed to remove runner token for Cloud stack pool lease ${this.stack.stackSlug}: ${
          err instanceof Error ? err.message : 'Unknown error'
        }`
      );
    } finally {
      rmSync(this.moduleDir, { recursive: true, force: true });
    }

    try {
      const fetchImpl = this.fetchImpl ?? fetch;
      const response = await fetchImpl(
        `https://grafana.com/api/instances/${encodeURIComponent(this.stack.stackSlug)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${this.accessPolicyToken}`,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(15_000),
        }
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      if (!this.replacement.region) {
        console.warn(
          `   ⚠ Cloud stack pool lease ${this.stack.stackSlug} was retired, but no region was available to create a replacement. Pass --cloud-stack-region to replenish immediately.`
        );
        return;
      }
      const replacementSlug = await createCloudStackPoolStack({
        accessPolicyToken: this.accessPolicyToken,
        region: this.replacement.region,
        poolId: this.replacement.poolId,
        slugPrefix: this.replacement.slugPrefix,
        verbose: this.replacement.verbose,
        runner: this.runner,
      });
      if (this.replacement.verbose) {
        console.log(`   ☁️  Replaced retired pool stack ${this.stack.stackSlug} with ${replacementSlug}`);
      }
    } catch (err) {
      console.warn(
        `   ⚠ Failed to retire Cloud stack pool lease ${this.stack.stackSlug}: ${
          err instanceof Error ? err.message : 'Unknown error'
        }`
      );
    }
  }
}
