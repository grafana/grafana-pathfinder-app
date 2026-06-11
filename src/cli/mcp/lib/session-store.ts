/**
 * Session store for the authoring sessions.
 *
 * Each session is keyed by an opaque session token (see `session-token.ts`)
 * and holds the authoring artifact (`content` + optional `manifest`) and a
 * monotonic `generation` number used for `ifGenerationMatch` optimistic
 * concurrency.
 *
 * `InMemorySessionStore` is the only implementation. The deployed MCP runs
 * as a single Cloud Run instance (see `scripts/deploy-mcp.sh`), so one
 * process-local map holds every session. Sessions are ephemeral: a redeploy
 * or instance recycle drops in-flight sessions, which is acceptable for the
 * short-lived authoring loop. A sliding TTL evicts abandoned sessions so the
 * map can't grow unbounded.
 *
 * Concurrency model:
 *   - Every `save` requires an `ifGenerationMatch` value.
 *     - `0` means "create only if absent" (first write of a new session).
 *     - Any positive value means "replace only if the current generation
 *       matches exactly".
 *   - A mismatch throws `SessionPreconditionFailedError`, carrying the
 *     observed and expected generations so the caller can decide between
 *     retry-with-refetch and surface-to-agent. The structured error is
 *     what wires the "server retries 412 once, then surfaces" behavior
 *     cleanly.
 *
 * Failure-mode contract:
 *   - `load` returns `null` for an unknown token. It may throw
 *     `SessionStoreCorruptedError` when the backing store holds a
 *     malformed artifact (unparseable JSON, missing-generation, etc),
 *     and transport errors from the backing store. It never throws
 *     for the absent-session case.
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

/**
 * Raised by `load` when the backing store contains a session whose
 * artifacts are unreadable as JSON or otherwise malformed. The HTTP
 * transport surfaces this as a structured 500 so an operator can
 * inspect the bucket; agents see an INTERNAL-class error rather than
 * a silent SESSION_NOT_FOUND (which would mask the corruption).
 */
export class SessionStoreCorruptedError extends Error {
  readonly code = 'SESSION_CORRUPTED' as const;

  constructor(message: string) {
    super(message);
    this.name = 'SessionStoreCorruptedError';
  }
}

/**
 * Raised when the backing store rejected the operation for a reason that
 * isn't precondition-failure or corruption — typically a GCS 429 that
 * exhausted retries, a transient network blip, or an auth/permission
 * failure. The HTTP transport must surface this as a structured
 * CommandOutcome (code `SESSION_STORE_UNAVAILABLE`) rather than a raw
 * 500, so well-behaved clients see well-formed JSON and can retry.
 *
 * `reason` lets the dispatch layer choose a more specific client-facing
 * message ("rate-limited; retry" vs "session storage temporarily
 * unavailable"). The original error is preserved via `cause` so the
 * unsanitized provider message stays out of the wire response but
 * remains in server logs.
 */
export class SessionStoreUnavailableError extends Error {
  readonly code = 'SESSION_STORE_UNAVAILABLE' as const;
  readonly reason: 'rate_limited' | 'transient';
  readonly cause?: unknown;

  constructor(reason: 'rate_limited' | 'transient', message: string, options?: { cause?: unknown }) {
    // Assigning `cause` manually instead of passing it through `Error()`'s
    // ES2022 options bag — the CLI tsconfig targets ES2020 so the typed
    // 2-arg constructor isn't visible to the type checker. The runtime
    // (node ≥ 16.9) supports the property either way; this assignment
    // keeps it accessible to consumers without bumping the build target.
    super(message);
    this.name = 'SessionStoreUnavailableError';
    this.reason = reason;
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
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
   * token. Called on session mint so subsequent calls from a different MCP
   * transport session are rejected with `SESSION_NOT_FOUND` — the pin is a
   * confidentiality boundary, not an auth surface, so it surfaces as 404,
   * not 403.
   *
   * Idempotent for the same pin. Rebinding an existing pin to a different
   * value throws `SessionPreconditionFailedError`. No production caller does
   * this; the failure is structured rather than a silent overwrite of a
   * confidentiality field.
   */
  bindMcpSessionId(token: string, mcpSessionId: string): Promise<void>;

  /**
   * Read the pinned `Mcp-Session-Id` for this token, or `null` if none was
   * ever bound (legacy session, stdio transport that doesn't have a
   * session id, or a client that never sent the header).
   */
  readMcpSessionPin(token: string): Promise<string | null>;
}

/** Default sliding-window session lifetime: 24h of inactivity before eviction. */
export const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

interface ExpiringSession extends LoadedSession {
  expiresAt: number;
}

/**
 * In-memory `SessionStore` implementation. The map is per-instance, so
 * tests get isolation by constructing a fresh store; the production default
 * is a process-singleton via `getDefaultSessionStore`.
 *
 * Concurrency: a single read-modify-write cycle is non-atomic at the
 * JavaScript level, but the `ifGenerationMatch` check inside `save`
 * guards against lost updates by comparing the stored generation against
 * the precondition before mutating the map. Two concurrent `save` calls
 * with the same precondition will see the same generation; whichever
 * runs first wins, the loser throws `PRECONDITION_FAILED`.
 *
 * Retention: each access (`load`/`save`) refreshes a sliding TTL, and a
 * full sweep on `save` evicts sessions idle past the window.
 *
 * The artifact is stored by reference. Callers that need defensive
 * copying should clone before passing in or after pulling out — the
 * mutation flow always writes fresh objects from the CLI runner so this
 * has not been needed.
 */
export class InMemorySessionStore implements SessionStore {
  private readonly entries = new Map<string, ExpiringSession>();
  private readonly pins = new Map<string, string>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options?: { ttlMs?: number; now?: () => number }) {
    this.ttlMs = options?.ttlMs ?? DEFAULT_SESSION_TTL_MS;
    this.now = options?.now ?? (() => Date.now());
  }

  /** Return the entry for `token` if present and unexpired; evict and return null otherwise. */
  private liveEntry(token: string): ExpiringSession | null {
    const entry = this.entries.get(token);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(token);
      this.pins.delete(token);
      return null;
    }
    return entry;
  }

  /** Drop every session idle past its TTL. Bounds map growth on write activity. */
  private sweepExpired(): void {
    const now = this.now();
    for (const [token, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(token);
        this.pins.delete(token);
      }
    }
  }

  async load(token: string): Promise<LoadedSession | null> {
    const entry = this.liveEntry(token);
    if (!entry) {
      return null;
    }
    entry.expiresAt = this.now() + this.ttlMs;
    return { artifact: entry.artifact, generation: entry.generation };
  }

  async save(token: string, artifact: SessionArtifact, ifGenerationMatch: number): Promise<SaveResult> {
    this.sweepExpired();
    const current = this.liveEntry(token);
    const actual = current ? current.generation : SESSION_GENERATION_ABSENT;
    if (actual !== ifGenerationMatch) {
      throw new SessionPreconditionFailedError(ifGenerationMatch, actual);
    }
    const nextGeneration = actual + 1;
    this.entries.set(token, { artifact, generation: nextGeneration, expiresAt: this.now() + this.ttlMs });
    return { generation: nextGeneration };
  }

  async delete(token: string): Promise<void> {
    this.entries.delete(token);
    this.pins.delete(token);
  }

  async bindMcpSessionId(token: string, mcpSessionId: string): Promise<void> {
    // Parity with GCS: refuse to overwrite an existing pin with a different
    // value; same-value rebinds are idempotent.
    const existing = this.pins.get(token);
    if (existing !== undefined && existing !== mcpSessionId) {
      throw new SessionPreconditionFailedError(SESSION_GENERATION_ABSENT, 1);
    }
    this.pins.set(token, mcpSessionId);
  }

  async readMcpSessionPin(token: string): Promise<string | null> {
    return this.pins.get(token) ?? null;
  }

  /** Test helper — number of live (unexpired) sessions. Not part of the public interface. */
  size(): number {
    this.sweepExpired();
    return this.entries.size;
  }
}
