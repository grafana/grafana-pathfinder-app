import { randomUUID } from 'crypto';
import type {
  CloudChainEnvironment,
  CloudChainRetireOutcome,
  CloudChainTeardownContext,
  ProvisionedCloudStack,
} from './cloud-chain-environment';
import type { PackageMeta } from './e2e-results';

const POOL_MANAGER_FETCH_TIMEOUT_MS = 15_000;
const FALLBACK_POLICY = 'hot_only';

export const DEFAULT_CLOUD_STACK_POOL_ID = 'nightly';

export interface CloudStackPoolManagerConfigInput {
  managerUrl?: string;
  tokenEnvVar?: string;
  poolId?: string;
  maxWaitSeconds?: number;
  env?: NodeJS.ProcessEnv;
}

export interface CloudStackPoolManagerConfig {
  managerUrl: string;
  tokenEnvVar: string;
  token: string;
  poolId: string;
  maxWaitSeconds?: number;
}

interface PlannedGuideRef {
  id: string;
}

interface LeaseForChainOptions {
  chain: PlannedGuideRef[];
  packageMetaById: Map<string, PackageMeta>;
}

interface PluginRequirement {
  slug: string;
  version?: string;
}

interface CreateLeaseRequest {
  poolId: string;
  runId: string;
  chainId: string;
  packageIds: string[];
  fallbackPolicy: typeof FALLBACK_POLICY;
  requiredPlugins: PluginRequirement[];
  metadata: Record<string, string>;
  maxWaitSeconds?: number;
}

interface CreateLeaseResponse {
  leaseId?: unknown;
  grafanaUrl?: unknown;
  runnerToken?: unknown;
  expiresAt?: unknown;
  poolId?: unknown;
  stackSlug?: unknown;
  region?: unknown;
  source?: unknown;
  pluginVersion?: unknown;
  waitMs?: unknown;
  provisioningMs?: unknown;
  diagnostics?: unknown;
}

interface RetireLeaseRequest {
  outcome: CloudChainRetireOutcome;
  used: boolean;
  runId: string;
  chainId: string;
  summary: string;
}

interface RetireLeaseResponse {
  leaseId?: unknown;
  status?: unknown;
  cleanupWarnings?: unknown;
  replacementQueued?: unknown;
}

interface ErrorResponse {
  error?: {
    code?: unknown;
    message?: unknown;
  };
}

export class CloudStackPoolManagerError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'CloudStackPoolManagerError';
  }
}

function hasAnyManagerConfig(input: CloudStackPoolManagerConfigInput): boolean {
  return Boolean(input.managerUrl || input.tokenEnvVar || input.maxWaitSeconds !== undefined);
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

function optionalNonEmptyOption(value: string | undefined, optionName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${optionName} must not be empty.`);
  }
  return trimmed;
}

function normalizeManagerUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid --cloud-stack-pool-manager-url value "${value}".`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('--cloud-stack-pool-manager-url must use http or https.');
  }
  parsed.search = '';
  parsed.hash = '';
  if (!parsed.pathname.endsWith('/')) {
    parsed.pathname = `${parsed.pathname}/`;
  }
  return parsed.toString();
}

function validateEnvVarName(value: string, optionName: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid ${optionName} env var "${value}".`);
  }
  return value;
}

function validateMaxWaitSeconds(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('--cloud-stack-max-wait-seconds must be a non-negative integer.');
  }
  return value;
}

function redact(text: string, secrets: string[]): string {
  return secrets.reduce((current, secret) => (secret ? current.split(secret).join('[redacted]') : current), text);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Pool manager lease response did not include ${field}.`);
  }
  return value;
}

function normalizeGrafanaUrl(value: unknown): string {
  const raw = stringField(value, 'grafanaUrl');
  try {
    return new URL('/', raw).toString();
  } catch {
    throw new Error('Pool manager lease response included an invalid grafanaUrl.');
  }
}

function chainIdFor(packageIds: string[]): string {
  return packageIds.length > 0 ? packageIds.join('>') : randomUUID();
}

function collectRequiredPlugins(
  chain: PlannedGuideRef[],
  packageMetaById: Map<string, PackageMeta>
): PluginRequirement[] {
  const seen = new Set<string>();
  const plugins: PluginRequirement[] = [];
  for (const planned of chain) {
    for (const slug of packageMetaById.get(planned.id)?.plugins ?? []) {
      if (!seen.has(slug)) {
        seen.add(slug);
        plugins.push({ slug });
      }
    }
  }
  return plugins;
}

function metadataFor(packageIds: string[], packageMetaById: Map<string, PackageMeta>): Record<string, string> {
  const sourceUrls = packageIds.flatMap((id) => {
    const sourceUrl = packageMetaById.get(id)?.sourceUrl;
    return sourceUrl ? [sourceUrl] : [];
  });
  return {
    client: 'pathfinder-cli',
    ...(sourceUrls.length > 0 ? { sourceUrls: sourceUrls.join(',') } : {}),
  };
}

function parseCleanupWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((warning) => (typeof warning === 'string' && warning ? [warning] : []));
}
async function postJson<T>(
  config: CloudStackPoolManagerConfig,
  fetchImpl: typeof fetch,
  path: string,
  body: unknown,
  errorPrefix: string,
  extraSecrets: string[] = []
): Promise<T> {
  const secrets = [config.token, ...extraSecrets];
  const url = new URL(path, config.managerUrl).toString();
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(POOL_MANAGER_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new CloudStackPoolManagerError(`Pool manager request failed: ${redact(errorMessage(err), secrets)}`);
  }

  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as T | ErrorResponse) : ({} as T);
  if (!response.ok) {
    const error = (parsed as ErrorResponse).error;
    const code = typeof error?.code === 'string' ? error.code : `http_${response.status}`;
    const message = typeof error?.message === 'string' ? error.message : response.statusText;
    throw new CloudStackPoolManagerError(`${errorPrefix}${code}: ${redact(message, secrets)}`, code, response.status);
  }
  return parsed as T;
}

export function createCloudStackPoolManagerConfig(
  input: CloudStackPoolManagerConfigInput
): CloudStackPoolManagerConfig | undefined {
  if (!hasAnyManagerConfig(input)) {
    return undefined;
  }

  const env = input.env ?? process.env;
  const managerUrl = normalizeManagerUrl(
    requireNonEmptyOption(input.managerUrl, '--cloud-stack-pool-manager-url is required for managed pool leasing')
  );
  const tokenEnvVar = validateEnvVarName(
    requireNonEmptyOption(input.tokenEnvVar, '--cloud-stack-pool-manager-token is required for managed pool leasing'),
    '--cloud-stack-pool-manager-token'
  );
  const token = env[tokenEnvVar];
  if (!token) {
    throw new Error(`--cloud-stack-pool-manager-token references unset or empty environment variable ${tokenEnvVar}.`);
  }
  const poolId = optionalNonEmptyOption(input.poolId, '--cloud-stack-pool-id') ?? DEFAULT_CLOUD_STACK_POOL_ID;
  const maxWaitSeconds = validateMaxWaitSeconds(input.maxWaitSeconds);

  return {
    managerUrl,
    tokenEnvVar,
    token,
    poolId,
    ...(maxWaitSeconds !== undefined ? { maxWaitSeconds } : {}),
  };
}

export class CloudStackPoolManager {
  private readonly runId = randomUUID();

  constructor(
    private readonly config: CloudStackPoolManagerConfig,
    private readonly verbose: boolean,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async leaseForChain(options: LeaseForChainOptions): Promise<CloudStackPoolManagerLease> {
    const packageIds = options.chain.map((planned) => planned.id);
    const chainId = chainIdFor(packageIds);
    const request: CreateLeaseRequest = {
      poolId: this.config.poolId,
      runId: this.runId,
      chainId,
      packageIds,
      fallbackPolicy: FALLBACK_POLICY,
      requiredPlugins: collectRequiredPlugins(options.chain, options.packageMetaById),
      metadata: metadataFor(packageIds, options.packageMetaById),
      ...(this.config.maxWaitSeconds !== undefined ? { maxWaitSeconds: this.config.maxWaitSeconds } : {}),
    };
    const response = await postJson<CreateLeaseResponse>(
      this.config,
      this.fetchImpl,
      '/v1/leases',
      request,
      `Pool manager could not lease a stack from pool "${this.config.poolId}": `
    );
    const lease = {
      leaseId: stringField(response.leaseId, 'leaseId'),
      targetUrl: normalizeGrafanaUrl(response.grafanaUrl),
      token: stringField(response.runnerToken, 'runnerToken'),
      stackSlug: stringField(response.stackSlug, 'stackSlug'),
      source: typeof response.source === 'string' ? response.source : 'hot',
      poolId: typeof response.poolId === 'string' ? response.poolId : this.config.poolId,
    };

    if (this.verbose) {
      console.log(`   ☁️ Leased ${lease.source} Cloud stack ${lease.stackSlug} from pool ${lease.poolId}`);
    }

    return new CloudStackPoolManagerLease(lease, this.config, this.runId, chainId, this.verbose, this.fetchImpl);
  }
}

interface ManagerLease {
  leaseId: string;
  targetUrl: string;
  token: string;
  stackSlug: string;
  source: string;
  poolId: string;
}

export class CloudStackPoolManagerLease implements CloudChainEnvironment {
  private teardownPromise: Promise<string[]> | null = null;
  private provisioned = false;

  constructor(
    private readonly lease: ManagerLease,
    private readonly config: CloudStackPoolManagerConfig,
    private readonly runId: string,
    private readonly chainId: string,
    private readonly verbose: boolean,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async provisionChain(): Promise<ProvisionedCloudStack> {
    this.provisioned = true;
    return {
      kind: 'pool',
      targetUrl: this.lease.targetUrl,
      token: this.lease.token,
      stackSlug: this.lease.stackSlug,
    };
  }

  teardownChain(context: CloudChainTeardownContext = {}): Promise<string[]> {
    return (this.teardownPromise ??= this.runTeardown(context));
  }

  private async runTeardown(context: CloudChainTeardownContext): Promise<string[]> {
    const request: RetireLeaseRequest = {
      outcome: context.outcome ?? 'runner_error',
      used: context.used ?? this.provisioned,
      runId: this.runId,
      chainId: this.chainId,
      summary: context.summary ?? 'Pathfinder CLI chain finished',
    };
    try {
      const response = await postJson<RetireLeaseResponse>(
        this.config,
        this.fetchImpl,
        `/v1/leases/${this.lease.leaseId}/retire`,
        request,
        '',
        [this.lease.token]
      );
      if (this.verbose) {
        const status = typeof response.status === 'string' ? response.status : 'retire_requested';
        console.log(`   🧹 Retired Cloud stack lease ${this.lease.leaseId} (${status})`);
      }
      return parseCleanupWarnings(response.cleanupWarnings);
    } catch (err) {
      return [`Failed to retire Cloud stack lease ${this.lease.leaseId}: ${errorMessage(err)}`];
    }
  }
}
