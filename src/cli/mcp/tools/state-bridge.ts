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
import { SESSION_GENERATION_ABSENT, SessionPreconditionFailedError, type SessionStore } from '../lib/session-store';

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
 *      (the create-package path uses `withFreshSession` instead, so
 *      this branch is the agent-error branch).
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
): Promise<SessionOutcome | SessionNotFound> {
  const loaded = await store.load(token);
  if (loaded === null) {
    return SESSION_NOT_FOUND;
  }

  const result = await withArtifact(loaded.artifact, runner);

  if (result.outcome.status !== 'ok') {
    return { ...result, generation: undefined };
  }

  const saved = await store.save(token, result.artifact, loaded.generation);
  return { ...result, generation: saved.generation };
}

/**
 * Variant for the create-package path: mint a fresh session by writing
 * the runner's output under `ifGenerationMatch=0`. The runner is invoked
 * against an empty package-shaped scratch dir; the CLI runner is
 * responsible for producing valid output.
 *
 * Returns the post-save generation alongside the artifact. On runner
 * failure no store write is attempted and `generation` is `undefined`.
 */
export async function withFreshSession(
  token: string,
  store: SessionStore,
  seed: ArtifactInput,
  runner: (dir: string) => Promise<CommandOutcome> | CommandOutcome
): Promise<SessionOutcome> {
  const result = await withArtifact(seed, runner);

  if (result.outcome.status !== 'ok') {
    return { ...result, generation: undefined };
  }

  const saved = await store.save(token, result.artifact, SESSION_GENERATION_ABSENT);
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

export type DispatchSessionResult = SessionOutcome | SessionNotFound | ConcurrentModificationResult;

export async function dispatchSessionMutation(
  token: string,
  store: SessionStore,
  runner: (dir: string) => Promise<CommandOutcome> | CommandOutcome,
  options: SessionMutationOptions = {}
): Promise<DispatchSessionResult> {
  // First load — check the optional optimistic-concurrency claim.
  const loaded = await store.load(token);
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
    const saved = await store.save(token, result.artifact, loaded.generation);
    return { ...result, generation: saved.generation };
  } catch (err) {
    if (!(err instanceof SessionPreconditionFailedError)) {
      throw err;
    }
    // Save-time 412. If the caller pinned expectedGeneration, surface
    // immediately so they see their explicit claim was invalidated.
    if (options.expectedGeneration !== undefined) {
      return concurrentModification(err.expected, err.actual);
    }
    // Default policy: retry once against the refetched state.
    const reloaded = await store.load(token);
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
      const saved2 = await store.save(token, result2.artifact, reloaded.generation);
      return { ...result2, generation: saved2.generation };
    } catch (err2) {
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
