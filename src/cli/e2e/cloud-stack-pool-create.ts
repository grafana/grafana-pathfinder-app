import { spawn } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

import type { CommandResult, CommandRunner } from './cloud-stack-environment';

const TERRAFORM_PROVIDER_VERSION = '>= 4.5.3';
const DEFAULT_SLUG_PREFIX = 'pfe2epool';

export interface CreateCloudStackPoolStackOptions {
  accessPolicyToken: string;
  region: string;
  poolId?: string;
  slugPrefix?: string;
  verbose?: boolean;
  runner?: CommandRunner;
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

function terraformEnv(accessPolicyToken: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TF_IN_AUTOMATION: '1',
    TF_VAR_cloud_access_policy_token: accessPolicyToken,
  };
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

function normalizeSlugPrefix(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!/^[a-z][a-z0-9]*$/.test(normalized)) {
    throw new Error(
      '--slug-prefix must contain at least one letter and only alphanumeric characters after normalization.'
    );
  }
  return normalized.slice(0, 12);
}

function generatedSlug(prefix: string): string {
  const suffix = `${Date.now().toString(36)}${randomUUID().replace(/-/g, '').slice(0, 6)}`;
  return `${prefix}${suffix}`.slice(0, 29);
}

function poolStackLabels(poolId: string | undefined, createdAtSeconds: number): Record<string, string> {
  return {
    'pathfinder-e2e-pool': 'true',
    ...(poolId ? { 'pathfinder-e2e-pool-id': poolId } : {}),
    'pathfinder-e2e-state': 'available',
    'pathfinder-e2e-created-at': String(createdAtSeconds),
  };
}

function hclStringMap(value: Record<string, string>): string {
  return Object.entries(value)
    .map(([key, mapValue]) => `    "${key}" = "${mapValue}"`)
    .join('\n');
}

function poolStackModule(options: CreateCloudStackPoolStackOptions, slug: string): string {
  const labels = poolStackLabels(options.poolId, Math.floor(Date.now() / 1000));
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

resource "grafana_cloud_stack" "pool" {
  provider          = grafana.cloud
  name              = "${slug}"
  slug              = "${slug}"
  region_slug       = "${options.region}"
  delete_protection = false
  labels = {
${hclStringMap(labels)}
  }
}
`;
}

export async function createCloudStackPoolStack(options: CreateCloudStackPoolStackOptions): Promise<string> {
  const runner = options.runner ?? defaultCommandRunner;
  const slug = generatedSlug(normalizeSlugPrefix(options.slugPrefix ?? DEFAULT_SLUG_PREFIX));
  const moduleDir = mkdtempSync(join(tmpdir(), 'pathfinder-e2e-pool-maintain-'));
  try {
    writeFileSync(join(moduleDir, 'main.tf'), poolStackModule(options, slug));
    const env = terraformEnv(options.accessPolicyToken);
    for (const args of [
      ['init', '-input=false', '-no-color'],
      ['apply', '-input=false', '-auto-approve', '-no-color'],
    ]) {
      const result = await runner('terraform', args, { cwd: moduleDir, env });
      assertCommandSuccess(result, args[0]!, options.accessPolicyToken);
    }
    return slug;
  } finally {
    rmSync(moduleDir, { recursive: true, force: true });
  }
}
