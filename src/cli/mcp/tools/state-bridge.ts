/**
 * Bridge between the MCP's stateless artifact model and the CLI's
 * directory-oriented runners.
 *
 * Each MCP mutation tool receives `{content, manifest}` from the client
 * and must return the updated artifact. The existing CLI `runX` functions
 * read and write a directory on disk. Rather than fork an in-memory
 * pathway across all 8 runners (substantial refactor with drift risk
 * because the runners contain CLI-strict guards we want the MCP to
 * inherit verbatim), we marshal the artifact through an ephemeral
 * tmpdir per call.
 *
 * **This is a documented deviation from the design's "no temporary
 * directory" property** (see HOSTED-AUTHORING-MCP.md). The deviation is
 * acceptable because:
 *
 *   1. The tmpdir is per-call and torn down before the tool returns —
 *      no cross-call state, the stateless artifact model still holds.
 *   2. We keep "the CLI is the sole validator" exactly: the MCP calls
 *      the actual `runX` function, so any CLI-strict guard the runner
 *      adds is automatically picked up by the MCP without code changes.
 *   3. Per-call cost is bounded — two small JSON file writes and reads
 *      against a tmpfs/ramdisk-backed `os.tmpdir()` on Linux.
 *
 * Follow-up: refactor `mutateAndValidate` and each `runX` to accept an
 * in-memory state mode so this bridge can collapse to a function call.
 * Tracked in P3 deviations.
 *
 * P7 addition (`withSession`): session-mode mutations load the artifact
 * from a `SessionStore` keyed by an opaque session token, run the same
 * tmpdir flow, and write the updated artifact back to the store under
 * an `ifGenerationMatch` precondition. The CLI runner is the sole
 * validator on both paths — `withSession` is `withArtifact` with a
 * load-before and save-after.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ContentJson, ManifestJson } from '../../../types/package.types';
import {
  buildArtifactSummary,
  readPackage,
  writePackage,
  type PackageState,
  type TreeNode,
} from '../../utils/package-io';
import type { CommandOutcome } from '../../utils/output';
import { SessionPreconditionFailedError, SessionStoreUnavailableError, type SessionStore } from '../lib/session-store';

export interface ArtifactInput {
  content: ContentJson;
  manifest?: ManifestJson;
}

export interface ArtifactOutcome {
  outcome: CommandOutcome;
  /** The updated artifact, present whether the runner succeeded or not (the runner only writes on success, so this reflects post-success state or the unchanged input on failure). */
  artifact: ArtifactInput;
  /**
   * Compact navigation tree of the (post-mutation) artifact. The agent reads
   * this instead of re-parsing `artifact.content` after every mutation —
   * strictly additive; the full artifact still ships alongside.
   */
  summary: TreeNode[];
}

export interface SessionOutcome extends ArtifactOutcome {
  /**
   * The session generation after a successful mutation. Present iff the
   * CLI runner succeeded AND the store write succeeded. On runner failure
   * the artifact is unchanged and no store write was attempted, so this
   * field is `undefined`. Callers that want to construct mutation acks
   * key off this to detect "the write actually happened."
   */
  generation: number | undefined;
}

/**
 * The result of a session lookup that did not find the session. Distinct
 * from a plain `null` so callers can branch without a second equality
 * check; mirrors the discriminated-union shape we use elsewhere in the
 * tool layer.
 */
export const SESSION_NOT_FOUND = { ok: false as const, code: 'SESSION_NOT_FOUND' as const };
export type SessionNotFound = typeof SESSION_NOT_FOUND;

/**
 * Hard cap on the JSON-serialized size of a session artifact (content +
 * manifest). Enforced server-side just before we persist a mutation,
 * AFTER the CLI runner has produced the post-mutation artifact. Sized
 * generously enough that any realistic authoring guide fits — the goal
 * is to bound abuse (~1 MB inbound bodies appended in a loop), not to
 * constrain real authoring.
 *
 * Why this exists: the deployed MCP runs with `--allow-unauthenticated`
 * and persists every successful mutation. The transport-level 1 MB cap
 * (see `transports/http.ts#MAX_REQUEST_BYTES`) bounds each request, but
 * NOT the cumulative artifact — block append/update tools can grow
 * `content.blocks[]` indefinitely. Without this cap, an attacker can
 * inflate one session's stored artifact unboundedly, which in turn
 * multiplies the cost of every previous-stage retention (see
 * `session-store-gcs.ts`).
 *
 * 4 MB is ~10× a realistic large guide and ~4× the per-request inbound
 * cap; a single mutation can never blow through it from a clean start
 * even if the request body is at the limit.
 */
export const MAX_SESSION_ARTIFACT_BYTES = 4_000_000;

/**
 * Hard cap on successful mutations per session per replica. Counted in
 * the same per-process `SessionHopCounter` (cf. `transports/instrumentation.ts`)
 * but keyed by session TOKEN rather than `Mcp-Session-Id`. Cross-replica
 * coordination is intentionally absent — Cloud Run replicas are
 * short-lived and each gets its own counter, so the realistic effective
 * cap is `MAX_SESSION_SAVES × replica-count`. This is defense-in-depth,
 * not a strict bound; the artifact-size cap above is the primary lever.
 *
 * 500 saves comfortably exceeds any realistic LLM-paced authoring run
 * (a guide reaches steady state in 20-50 mutations).
 */
export const MAX_SESSION_SAVES = 500;

export const SESSION_TOO_LARGE = 'SESSION_TOO_LARGE' as const;
export interface SessionTooLargeResult {
  ok: false;
  code: typeof SESSION_TOO_LARGE;
  artifactBytes: number;
  maxBytes: number;
  message: string;
}

export const SESSION_HOP_LIMIT = 'SESSION_HOP_LIMIT' as const;
export interface SessionHopLimitResult {
  ok: false;
  code: typeof SESSION_HOP_LIMIT;
  saves: number;
  maxSaves: number;
  message: string;
}

/**
 * Measure the JSON-serialized byte length of an artifact. Used to enforce
 * `MAX_SESSION_ARTIFACT_BYTES` before save. Mirrors the encoding the
 * GCS store will write so the cap is meaningful against actual storage.
 */
export function measureArtifactBytes(artifact: ArtifactInput): number {
  // content and manifest are stored as separate objects; the cap covers
  // their combined serialized size to match what the GCS layout actually
  // persists (and what an attacker would actually inflate).
  const contentBytes = Buffer.byteLength(JSON.stringify(artifact.content));
  const manifestBytes = artifact.manifest !== undefined ? Buffer.byteLength(JSON.stringify(artifact.manifest)) : 0;
  return contentBytes + manifestBytes;
}

function sessionTooLarge(bytes: number): SessionTooLargeResult {
  return {
    ok: false,
    code: SESSION_TOO_LARGE,
    artifactBytes: bytes,
    maxBytes: MAX_SESSION_ARTIFACT_BYTES,
    message: `Session artifact would exceed the ${MAX_SESSION_ARTIFACT_BYTES}-byte cap (got ${bytes} bytes after the mutation). Trim existing blocks before adding more — large authoring runs should be split across multiple guides.`,
  };
}

function sessionHopLimit(saves: number): SessionHopLimitResult {
  return {
    ok: false,
    code: SESSION_HOP_LIMIT,
    saves,
    maxSaves: MAX_SESSION_SAVES,
    message: `Session has reached the per-replica mutation cap (${MAX_SESSION_SAVES}). This is a hard guard against runaway agents; if you legitimately need more, start a fresh session with pathfinder_create_package.`,
  };
}

/**
 * Per-token mutation counter. Keyed by the session token so it tracks
 * authoring state across mcp-session-id transports (a client that
 * reconnects with a new header but the same token is still the same
 * session). The counter is per-replica in-memory — see the doc on
 * `MAX_SESSION_SAVES` for the reasoning.
 */
const sessionSaveCounts = new Map<string, number>();

/** Visible for tests. */
export function __resetSessionSaveCounts(): void {
  sessionSaveCounts.clear();
}

function bumpSaveCount(token: string): number {
  const next = (sessionSaveCounts.get(token) ?? 0) + 1;
  sessionSaveCounts.set(token, next);
  return next;
}

/**
 * Run a directory-based runner against an in-memory artifact. Writes the
 * artifact to a per-call tmpdir, invokes the runner, reads the updated
 * artifact back, and cleans up.
 */
export async function withArtifact(
  artifact: ArtifactInput,
  runner: (dir: string) => Promise<CommandOutcome> | CommandOutcome
): Promise<ArtifactOutcome> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pathfinder-cli-mcp-'));
  try {
    const state: PackageState = {
      content: artifact.content,
      manifest: artifact.manifest,
      manifestSchemaVersionAuthored: artifact.manifest !== undefined,
    };
    writePackage(dir, state);

    const outcome = await runner(dir);

    if (outcome.status !== 'ok') {
      return { outcome, artifact, summary: buildArtifactSummary(artifact.content) };
    }

    const updated = readPackage(dir);
    const updatedArtifact = { content: updated.content, manifest: updated.manifest };
    return {
      outcome,
      artifact: updatedArtifact,
      summary: buildArtifactSummary(updatedArtifact.content),
    };
  } finally {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // Tmpdir cleanup is best-effort. The OS will reclaim it on reboot.
    }
  }
}

/**
 * Run a directory-based runner against a session-stored artifact.
 *
 *   1. Load `{artifact, generation}` from the session store. If absent,
 *      return `SESSION_NOT_FOUND` — the caller decides whether that is
 *      an error (an agent passed a stale token) or a signal to mint
 *      (the create-package path uses `mintSession` in
 *      `tools/artifact-tools.ts` instead, so this branch is the
 *      agent-error branch).
 *   2. Invoke the existing tmpdir-based runner against the loaded
 *      artifact. The CLI is the sole validator.
 *   3. On runner success, persist the updated artifact back to the
 *      store under `ifGenerationMatch=generation`. A precondition
 *      failure here surfaces as `SessionPreconditionFailedError` to
 *      the caller (phase B's retry-once policy handles it).
 *   4. On runner failure, the store is NOT written — the failed
 *      mutation leaves the session in its prior valid state. This
 *      preserves the P3 "MCP performs no schema validation" contract
 *      verbatim: a CLI-detectable schema violation never lands.
 *
 * The returned `generation` is `undefined` when the runner failed (no
 * write happened) and the post-save generation otherwise.
 */
export async function withSession(
  token: string,
  store: SessionStore,
  runner: (dir: string) => Promise<CommandOutcome> | CommandOutcome
): Promise<SessionOutcome | SessionNotFound | SessionTooLargeResult | SessionHopLimitResult> {
  const loaded = await store.load(token);
  if (loaded === null) {
    return SESSION_NOT_FOUND;
  }

  const result = await withArtifact(loaded.artifact, runner);

  if (result.outcome.status !== 'ok') {
    return { ...result, generation: undefined };
  }

  // Size cap is enforced AFTER the CLI runner (so the size is the
  // post-mutation, post-validation size that would actually land in
  // storage). Skipping the cap on runner failure is intentional: a
  // failed mutation doesn't write to the store, so it can't grow the
  // persisted artifact.
  const bytes = measureArtifactBytes(result.artifact);
  if (bytes > MAX_SESSION_ARTIFACT_BYTES) {
    return sessionTooLarge(bytes);
  }

  const saves = bumpSaveCount(token);
  if (saves > MAX_SESSION_SAVES) {
    return sessionHopLimit(saves);
  }

  const saved = await store.save(token, result.artifact, loaded.generation);
  return { ...result, generation: saved.generation };
}

/**
 * `dispatchSessionMutation` is the entrypoint mutation tools call. It
 * wraps `withSession` with the P7 concurrency-control policy:
 *
 *   - If `expectedGeneration` is supplied AND it disagrees with the
 *     currently-stored generation, return CONCURRENT_MODIFICATION
 *     immediately — the agent has made a deliberate optimistic-
 *     concurrency claim that the server invalidated.
 *
 *   - If `expectedGeneration` is supplied AND matches, run the
 *     mutation. A `412` from the store on the save (someone wrote
 *     between our load and save) surfaces as CONCURRENT_MODIFICATION
 *     without retry — same rationale: the agent expressed an
 *     expectation, surface mismatches.
 *
 *   - If `expectedGeneration` is omitted, run the mutation. On `412`,
 *     reload and retry exactly once. If the second attempt also hits
 *     412, surface CONCURRENT_MODIFICATION carrying the observed
 *     generation. This is the design's default: agents that don't
 *     pass expectedGeneration don't have to think about concurrency.
 *
 * The return type is a discriminated union the tool layer maps onto
 * `outcomeResult`.
 */
export interface SessionMutationOptions {
  /**
   * When set, the dispatcher returns CONCURRENT_MODIFICATION on any
   * generation mismatch (pre-load or post-save). When omitted, the
   * dispatcher retries once on a post-save 412.
   */
  expectedGeneration?: number;
}

export interface ConcurrentModificationResult {
  ok: false;
  code: 'CONCURRENT_MODIFICATION';
  expected: number;
  actual: number;
  message: string;
}

export function concurrentModification(expected: number, actual: number): ConcurrentModificationResult {
  return {
    ok: false,
    code: 'CONCURRENT_MODIFICATION',
    expected,
    actual,
    message: `Session was modified by another writer (expected generation ${expected}, observed ${actual}). Re-fetch the session via pathfinder_inspect or pathfinder_list_blocks and retry the mutation against the current state.`,
  };
}

export interface StoreUnavailableResult {
  ok: false;
  code: 'SESSION_STORE_UNAVAILABLE';
  reason: 'rate_limited' | 'transient';
  message: string;
}

export function storeUnavailable(err: SessionStoreUnavailableError): StoreUnavailableResult {
  return {
    ok: false,
    code: 'SESSION_STORE_UNAVAILABLE',
    reason: err.reason,
    message: err.message,
  };
}

export type DispatchSessionResult =
  | SessionOutcome
  | SessionNotFound
  | ConcurrentModificationResult
  | SessionTooLargeResult
  | SessionHopLimitResult
  | StoreUnavailableResult;

/**
 * Quota check applied after the CLI runner produces an updated artifact
 * and before we attempt the store write. Returns a structured
 * SESSION_TOO_LARGE / SESSION_HOP_LIMIT response when a cap is exceeded,
 * or `null` to proceed with the save. Pulled out so both the initial
 * attempt and the post-412 retry share the same gating logic.
 *
 * Save-count bumping happens here, on the success path only, so a
 * failed runner attempt does not consume a save slot. Likewise the
 * 412-retry path re-runs the runner and re-enters this function, which
 * means the retry will bump the counter exactly once on its own success.
 */
function checkSessionQuota(
  token: string,
  artifact: ArtifactInput
): SessionTooLargeResult | SessionHopLimitResult | null {
  const bytes = measureArtifactBytes(artifact);
  if (bytes > MAX_SESSION_ARTIFACT_BYTES) {
    return sessionTooLarge(bytes);
  }
  const saves = bumpSaveCount(token);
  if (saves > MAX_SESSION_SAVES) {
    return sessionHopLimit(saves);
  }
  return null;
}

export async function dispatchSessionMutation(
  token: string,
  store: SessionStore,
  runner: (dir: string) => Promise<CommandOutcome> | CommandOutcome,
  options: SessionMutationOptions = {}
): Promise<DispatchSessionResult> {
  // First load — check the optional optimistic-concurrency claim.
  let loaded: Awaited<ReturnType<typeof store.load>>;
  try {
    loaded = await store.load(token);
  } catch (loadErr) {
    if (loadErr instanceof SessionStoreUnavailableError) {
      return storeUnavailable(loadErr);
    }
    throw loadErr;
  }
  if (loaded === null) {
    return SESSION_NOT_FOUND;
  }
  if (options.expectedGeneration !== undefined && options.expectedGeneration !== loaded.generation) {
    return concurrentModification(options.expectedGeneration, loaded.generation);
  }

  try {
    const result = await withArtifact(loaded.artifact, runner);
    if (result.outcome.status !== 'ok') {
      return { ...result, generation: undefined };
    }
    const quotaFailure = checkSessionQuota(token, result.artifact);
    if (quotaFailure) {
      return quotaFailure;
    }
    const saved = await store.save(token, result.artifact, loaded.generation);
    return { ...result, generation: saved.generation };
  } catch (err) {
    if (err instanceof SessionStoreUnavailableError) {
      return storeUnavailable(err);
    }
    if (!(err instanceof SessionPreconditionFailedError)) {
      throw err;
    }
    // Save-time 412. If the caller pinned expectedGeneration, surface
    // immediately so they see their explicit claim was invalidated.
    if (options.expectedGeneration !== undefined) {
      return concurrentModification(err.expected, err.actual);
    }
    // Default policy: retry once against the refetched state.
    let reloaded: Awaited<ReturnType<typeof store.load>>;
    try {
      reloaded = await store.load(token);
    } catch (reloadErr) {
      if (reloadErr instanceof SessionStoreUnavailableError) {
        return storeUnavailable(reloadErr);
      }
      throw reloadErr;
    }
    if (reloaded === null) {
      // Another writer deleted the session between our save attempt and
      // this reload. Treat as not-found rather than concurrent-mod.
      return SESSION_NOT_FOUND;
    }
    try {
      const result2 = await withArtifact(reloaded.artifact, runner);
      if (result2.outcome.status !== 'ok') {
        return { ...result2, generation: undefined };
      }
      const quotaFailure2 = checkSessionQuota(token, result2.artifact);
      if (quotaFailure2) {
        return quotaFailure2;
      }
      const saved2 = await store.save(token, result2.artifact, reloaded.generation);
      return { ...result2, generation: saved2.generation };
    } catch (err2) {
      if (err2 instanceof SessionStoreUnavailableError) {
        return storeUnavailable(err2);
      }
      if (err2 instanceof SessionPreconditionFailedError) {
        return concurrentModification(err2.expected, err2.actual);
      }
      throw err2;
    }
  }
}

export function isSessionNotFound(r: unknown): r is SessionNotFound {
  return typeof r === 'object' && r !== null && (r as SessionNotFound).code === 'SESSION_NOT_FOUND';
}

export function isConcurrentModification(r: unknown): r is ConcurrentModificationResult {
  return typeof r === 'object' && r !== null && (r as ConcurrentModificationResult).code === 'CONCURRENT_MODIFICATION';
}

export function isStoreUnavailable(r: unknown): r is StoreUnavailableResult {
  return typeof r === 'object' && r !== null && (r as StoreUnavailableResult).code === 'SESSION_STORE_UNAVAILABLE';
}

export function isSessionTooLarge(r: unknown): r is SessionTooLargeResult {
  return typeof r === 'object' && r !== null && (r as SessionTooLargeResult).code === SESSION_TOO_LARGE;
}

export function isSessionHopLimit(r: unknown): r is SessionHopLimitResult {
  return typeof r === 'object' && r !== null && (r as SessionHopLimitResult).code === SESSION_HOP_LIMIT;
}
