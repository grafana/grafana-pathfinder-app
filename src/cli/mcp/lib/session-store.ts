/**
 * Session store for the P7 GCS-backed authoring sessions.
 *
 * Each session is a directory under the storage backend keyed by an opaque
 * session token (see `session-token.ts`). The store holds the authoring
 * artifact (`content` + optional `manifest`) and a monotonic `generation`
 * number used for `ifGenerationMatch` optimistic concurrency.
 *
 * The interface intentionally mirrors the subset of the Google Cloud
 * Storage object API we need. The GCS-backed implementation lands in
 * `session-store-gcs.ts`; the in-memory implementation here is the default
 * for local dev and unit tests, and is the fallback when
 * `PATHFINDER_SESSION_STORE` is unset or set to `memory`.
 *
 * Concurrency model:
 *   - Every `save` requires an `ifGenerationMatch` value.
 *     - `0` means "create only if absent" (first write of a new session).
 *     - Any positive value means "replace only if the current generation
 *       matches exactly".
 *   - A mismatch throws `SessionPreconditionFailedError`, carrying the
 *     observed and expected generations so the caller can decide between
 *     retry-with-refetch and surface-to-agent. The structured error is
 *     what wires P7 task 13's "server retries 412 once, then surfaces"
 *     behavior cleanly.
 *
 * Failure-mode contract:
 *   - `load` returns `null` for an unknown token (never throws).
 *   - `save` throws `SessionPreconditionFailedError` on generation
 *     mismatch and may throw transport errors from the backing store.
 *   - `delete` is idempotent: deleting an unknown token resolves
 *     successfully.
 */

import type { ContentJson, ManifestJson } from '../../../types/package.types';

export interface SessionArtifact {
  content: ContentJson;
  manifest?: ManifestJson;
}

export interface LoadedSession {
  artifact: SessionArtifact;
  /** Monotonically increasing generation number for optimistic concurrency. */
  generation: number;
}

export interface SaveResult {
  /** The new generation after the write. Strictly greater than the precondition. */
  generation: number;
}

/**
 * Sentinel `ifGenerationMatch` value meaning "create only if absent".
 * Mirrors GCS semantics where `ifGenerationMatch=0` rejects updates to
 * an existing object.
 */
export const SESSION_GENERATION_ABSENT = 0;

export class SessionPreconditionFailedError extends Error {
  readonly code = 'PRECONDITION_FAILED' as const;
  readonly expected: number;
  readonly actual: number;

  constructor(expected: number, actual: number) {
    super(`session generation mismatch: expected ${expected}, actual ${actual}`);
    this.name = 'SessionPreconditionFailedError';
    this.expected = expected;
    this.actual = actual;
  }
}

export interface SessionStore {
  /**
   * Returns the current artifact and generation for `token`, or `null` if
   * no session is stored under that token. Never throws for the absent
   * case.
   */
  load(token: string): Promise<LoadedSession | null>;

  /**
   * Atomically writes the artifact under `token`. Throws
   * `SessionPreconditionFailedError` if the current generation does not
   * match `ifGenerationMatch`. Returns the new generation.
   *
   * - Pass `SESSION_GENERATION_ABSENT` (0) to create a new session and
   *   reject if one already exists.
   * - Pass the generation returned by a previous `load` or `save` to
   *   update only if no one else has written since.
   */
  save(token: string, artifact: SessionArtifact, ifGenerationMatch: number): Promise<SaveResult>;

  /**
   * Removes the session under `token`. Idempotent — resolves successfully
   * even if no session is stored under that token.
   */
  delete(token: string): Promise<void>;

  /**
   * Persist a transport-layer `Mcp-Session-Id` pin against this session
   * token. P7 task 16: called on session mint so subsequent calls from a
   * different MCP transport session are rejected with `SESSION_NOT_FOUND`
   * (per design — the pin is a confidentiality boundary, not an auth
   * surface, so it surfaces as 404, not 403).
   *
   * Idempotent for the same pin; overwriting an existing pin with a
   * different value is implementation-defined (in practice the in-memory
   * and GCS impls both overwrite, but no production caller does this —
   * we only ever bind once at mint).
   */
  bindMcpSessionId(token: string, mcpSessionId: string): Promise<void>;

  /**
   * Read the pinned `Mcp-Session-Id` for this token, or `null` if none was
   * ever bound (legacy session, stdio transport that doesn't have a
   * session id, or a client that never sent the header).
   */
  readMcpSessionPin(token: string): Promise<string | null>;
}

/**
 * In-memory `SessionStore` implementation. The map is per-instance, so
 * tests get isolation by constructing a fresh store; the production
 * default for local stdio MCP is a process-singleton via `getDefaultStore`.
 *
 * Concurrency: a single read-modify-write cycle is non-atomic at the
 * JavaScript level, but the `ifGenerationMatch` check inside `save`
 * guards against lost updates by comparing the stored generation against
 * the precondition before mutating the map. Two concurrent `save` calls
 * with the same precondition will see the same generation; whichever
 * runs first wins, the loser throws `PRECONDITION_FAILED`.
 *
 * The artifact is stored by reference. Callers that need defensive
 * copying should clone before passing in or after pulling out — the
 * mutation flow used by P7 always writes fresh objects from the CLI
 * runner so this has not been needed.
 */
export class InMemorySessionStore implements SessionStore {
  private readonly entries = new Map<string, LoadedSession>();
  private readonly pins = new Map<string, string>();

  async load(token: string): Promise<LoadedSession | null> {
    const entry = this.entries.get(token);
    if (!entry) {
      return null;
    }
    return entry;
  }

  async save(token: string, artifact: SessionArtifact, ifGenerationMatch: number): Promise<SaveResult> {
    const current = this.entries.get(token);
    const actual = current ? current.generation : SESSION_GENERATION_ABSENT;
    if (actual !== ifGenerationMatch) {
      throw new SessionPreconditionFailedError(ifGenerationMatch, actual);
    }
    const nextGeneration = actual + 1;
    this.entries.set(token, { artifact, generation: nextGeneration });
    return { generation: nextGeneration };
  }

  async delete(token: string): Promise<void> {
    this.entries.delete(token);
    this.pins.delete(token);
  }

  async bindMcpSessionId(token: string, mcpSessionId: string): Promise<void> {
    this.pins.set(token, mcpSessionId);
  }

  async readMcpSessionPin(token: string): Promise<string | null> {
    return this.pins.get(token) ?? null;
  }

  /** Test helper — number of live sessions. Not part of the public interface. */
  size(): number {
    return this.entries.size;
  }
}
