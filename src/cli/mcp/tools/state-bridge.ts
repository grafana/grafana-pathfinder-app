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
 * P7 addition (`dispatchSessionMutation`): session-mode mutations load
 * the artifact from a `SessionStore` keyed by an opaque session token,
 * run the same tmpdir flow, and write the updated artifact back to the
 * store under an `ifGenerationMatch` precondition. The CLI runner is the
 * sole validator on both paths — the session dispatcher is `withArtifact`
 * with a load-before, save-after, and a retry-once-on-412 policy.
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
import { MCP_TMPDIR_PREFIX } from '../lib/constants';
import {
  SessionPreconditionFailedError,
  SessionStoreUnavailableError,
  type LoadedSession,
  type SessionStore,
} from '../lib/session-store';

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

export const SESSION_TOO_LARGE = 'SESSION_TOO_LARGE' as const;
export interface SessionTooLargeResult {
  ok: false;
  code: typeof SESSION_TOO_LARGE;
  artifactBytes: number;
  maxBytes: number;
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

/**
 * Run a directory-based runner against an in-memory artifact. Writes the
 * artifact to a per-call tmpdir, invokes the runner, reads the updated
 * artifact back, and cleans up.
 */
export async function withArtifact(
  artifact: ArtifactInput,
  runner: (dir: string) => Promise<CommandOutcome> | CommandOutcome
): Promise<ArtifactOutcome> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), MCP_TMPDIR_PREFIX));
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
  | StoreUnavailableResult;

/**
 * Pre-save size gate. Returns a structured SESSION_TOO_LARGE when the
 * artifact would exceed the per-session cap, or `null` to proceed.
 * Shared between the initial attempt and the post-412 retry.
 */
function checkSessionQuota(artifact: ArtifactInput): SessionTooLargeResult | null {
  const bytes = measureArtifactBytes(artifact);
  if (bytes > MAX_SESSION_ARTIFACT_BYTES) {
    return sessionTooLarge(bytes);
  }
  return null;
}

type LoadResult =
  | { kind: 'session'; session: LoadedSession }
  | { kind: 'absent' }
  | { kind: 'unavailable'; response: StoreUnavailableResult };

/**
 * Wrap `store.load` with the load-time `SessionStoreUnavailableError`
 * mapping shared by every dispatch entry point. Returns a discriminated
 * union so the caller can distinguish the three terminal states (live
 * session, absent session, store unavailable) without nesting try/catch.
 */
async function safeLoad(store: SessionStore, token: string): Promise<LoadResult> {
  try {
    const loaded = await store.load(token);
    return loaded === null ? { kind: 'absent' } : { kind: 'session', session: loaded };
  } catch (err) {
    if (err instanceof SessionStoreUnavailableError) {
      return { kind: 'unavailable', response: storeUnavailable(err) };
    }
    throw err;
  }
}

/**
 * Policy-free single mutation attempt against a loaded session. Runs the
 * runner through the tmpdir bridge, gates on the post-mutation quota, and
 * persists. Lets `SessionPreconditionFailedError` and
 * `SessionStoreUnavailableError` propagate — retry / store-unavailable
 * policy lives in `dispatchSessionMutation`.
 */
async function attemptMutation(
  session: LoadedSession,
  token: string,
  store: SessionStore,
  runner: (dir: string) => Promise<CommandOutcome> | CommandOutcome
): Promise<SessionOutcome | SessionTooLargeResult> {
  const result = await withArtifact(session.artifact, runner);
  if (result.outcome.status !== 'ok') {
    return { ...result, generation: undefined };
  }
  const quotaFailure = checkSessionQuota(result.artifact);
  if (quotaFailure) {
    return quotaFailure;
  }
  const saved = await store.save(token, result.artifact, session.generation);
  return { ...result, generation: saved.generation };
}

export async function dispatchSessionMutation(
  token: string,
  store: SessionStore,
  runner: (dir: string) => Promise<CommandOutcome> | CommandOutcome,
  options: SessionMutationOptions = {}
): Promise<DispatchSessionResult> {
  // First load — check the optional optimistic-concurrency claim.
  const first = await safeLoad(store, token);
  if (first.kind === 'unavailable') {
    return first.response;
  }
  if (first.kind === 'absent') {
    return SESSION_NOT_FOUND;
  }
  const loaded = first.session;
  if (options.expectedGeneration !== undefined && options.expectedGeneration !== loaded.generation) {
    return concurrentModification(options.expectedGeneration, loaded.generation);
  }

  try {
    return await attemptMutation(loaded, token, store, runner);
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
    const second = await safeLoad(store, token);
    if (second.kind === 'unavailable') {
      return second.response;
    }
    if (second.kind === 'absent') {
      // Another writer deleted the session between our save attempt and
      // this reload. Treat as not-found rather than concurrent-mod.
      return SESSION_NOT_FOUND;
    }
    const reloaded = second.session;
    try {
      return await attemptMutation(reloaded, token, store, runner);
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
