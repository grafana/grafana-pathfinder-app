/**
 * Per-chain ephemeral Grafana service accounts for cloud-tier e2e runs.
 *
 * Mirrors `CleanEnvironment`'s provision/teardown lifecycle, but for cloud:
 * before a chain of cloud-tier guides runs, a fresh service account and token
 * are minted on the cloud stack; after the chain they are deleted. A bootstrap
 * admin token (with `serviceaccounts:write`) authorizes the create/delete calls.
 *
 * Scope: this isolates per-identity state (preferences, stars, sessions)
 * between chains. It does NOT reset org-global data (dashboards, data sources,
 * folders) created by guides — unsafe guides require isolated stack execution.
 *
 * One SharedCloudStackEnvironment owns service-account lifecycle for one existing
 * cloud stack. Multi-instance runs create one per target origin with configured
 * shared-stack admin auth.
 */

import { randomUUID } from 'crypto';

/** Prefix for provisioned SAs — used for identification and orphan cleanup. */
const SA_NAME_PREFIX = 'pathfinder-e2e-';
/** Token TTL: a safety net so a leaked token expires even if teardown never runs. */
const TOKEN_TTL_SECONDS = 3600;
const SWEEP_GRACE_SECONDS = 300;
/** Role granted to the ephemeral SA. Admin so guide steps can exercise any action.
 * This is a requirement for guides that require the Admin role to succeed.
 */
const SA_ROLE = 'Admin';
export const CLOUD_STACK_FETCH_TIMEOUT_MS = 15_000;

interface CreatedServiceAccount {
  id: number;
  name: string;
}

interface ServiceAccountSearchResult {
  serviceAccounts?: Array<{ id: number; name: string }>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function serviceAccountName(runId: string): string {
  return `${SA_NAME_PREFIX}${nowSeconds()}-${runId}-${randomUUID().slice(0, 8)}`;
}

function provisionedAtSeconds(name: string): number | undefined {
  const match = name.match(new RegExp(`^${SA_NAME_PREFIX}(\\d+)-[a-f0-9-]+-[a-f0-9]+$`));
  if (!match?.[1]) {
    return undefined;
  }
  return Number(match[1]);
}

function isStaleOrphan(name: string): boolean {
  const provisionedAt = provisionedAtSeconds(name);
  return provisionedAt !== undefined && nowSeconds() - provisionedAt > TOKEN_TTL_SECONDS + SWEEP_GRACE_SECONDS;
}

/**
 * Owns the per-chain ephemeral service-account lifecycle on a cloud stack. Only
 * one SA is live at a time (chains run sequentially), tracked in `currentSaId`
 * so teardown — including from signal handlers — can always find it.
 */
export class SharedCloudStackEnvironment {
  private currentSaId: number | null = null;
  private readonly runId = randomUUID().slice(0, 8);

  constructor(
    private readonly adminToken: string,
    private readonly cloudUrl: string,
    private readonly verbose: boolean
  ) {}

  /** Delete stale service accounts left over from crashed runs. */
  async sweepOrphans(): Promise<void> {
    try {
      const result = await this.api<ServiceAccountSearchResult>(
        'GET',
        `/api/serviceaccounts/search?query=${encodeURIComponent(SA_NAME_PREFIX)}&perpage=100`
      );
      const orphans = (result.serviceAccounts ?? []).filter((sa) => isStaleOrphan(sa.name));
      for (const orphan of orphans) {
        try {
          await this.api('DELETE', `/api/serviceaccounts/${orphan.id}`);
        } catch {
          // Best-effort; the token TTL bounds the lifetime of anything we miss.
        }
      }
      if (this.verbose && orphans.length > 0) {
        console.log(`   🧹 Swept ${orphans.length} orphaned service account(s)`);
      }
    } catch (err) {
      console.warn(`   ⚠ Could not sweep orphaned service accounts: ${errorMessage(err)}`);
    }
  }

  /**
   * Mint a fresh service account + token for a chain and return the token.
   * Tracks the SA id before requesting the token so a failure mid-provision
   * still leaves the SA discoverable for teardown. Throws on failure (a bad
   * admin token is a setup error, not something to silently skip).
   */
  async provisionChain(): Promise<string> {
    const name = serviceAccountName(this.runId);
    const sa = await this.api<CreatedServiceAccount>('POST', '/api/serviceaccounts', { name, role: SA_ROLE });
    this.currentSaId = sa.id;
    if (this.verbose) {
      console.log(`   🔑 Provisioned service account "${name}" (id ${sa.id})`);
    }
    try {
      const token = await this.api<{ key: string }>('POST', `/api/serviceaccounts/${sa.id}/tokens`, {
        name,
        secondsToLive: TOKEN_TTL_SECONDS,
      });
      return token.key;
    } catch (err) {
      // Don't leave the SA behind if token creation fails.
      await this.teardownChain();
      throw err;
    }
  }

  /**
   * Delete the chain's service account (and its tokens). Best-effort: the token
   * TTL bounds the damage if the delete fails, and `sweepOrphans` cleans up later.
   */
  async teardownChain(): Promise<void> {
    if (this.currentSaId === null) {
      return;
    }
    const id = this.currentSaId;
    this.currentSaId = null;
    try {
      await this.api('DELETE', `/api/serviceaccounts/${id}`);
      if (this.verbose) {
        console.log(`   🧹 Deleted service account id ${id}`);
      }
    } catch (err) {
      console.warn(`   ⚠ Failed to delete service account id ${id} (it will expire via TTL): ${errorMessage(err)}`);
    }
  }

  /** Tear down the currently live service account, if any. */
  async teardownAll(): Promise<void> {
    await this.teardownChain();
  }

  /**
   * Authenticated request against the cloud stack's Grafana HTTP API. Throws on
   * network errors and non-2xx responses. Never logs the admin token or any
   * minted token.
   */
  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = new URL(path, this.cloudUrl).toString();
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.adminToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(CLOUD_STACK_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`${method} ${path} failed: HTTP ${response.status} ${response.statusText}`);
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  }
}
