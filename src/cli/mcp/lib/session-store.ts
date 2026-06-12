/**
 * Session store for the authoring sessions.
 *
 * Each session is keyed by an opaque session token (see `session-token.ts`)
 * and holds the authoring artifact (`content` + optional `manifest`) and a
 * monotonic `generation` number used for `ifGenerationMatch` optimistic
 * concurrency.
 *
 * `InMemorySessionStore` is the only implementation: the deployed MCP runs
 * as a single instance (see `docs/developer/MCP_SERVER.md`), so a
 * process-local map holds every session and a sliding TTL bounds growth.
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
 *   - `load` returns `null` for an unknown token; it never throws.
 *   - `save` throws `SessionPreconditionFailedError` on generation mismatch.
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
 * Sentinel `ifGenerationMatch` value meaning "create only if absent": a
 * save with this precondition rejects if a session already exists.
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
 * Thrown by `bindMcpSessionId` when an existing pin would be overwritten with
 * a different value. A create-time race on session mint, not a generation
 * precondition failure — it carries its own code rather than borrowing
 * synthetic generation numbers. The raw token stays off `.message` (it's a
 * bearer credential); callers that log it use `tokenLogPrefix`.
 */
export class SessionPinConflictError extends Error {
  readonly code = 'SESSION_PIN_CONFLICT' as const;
  readonly token: string;

  constructor(token: string) {
    super('Mcp-Session-Id pin is already bound to a different value for this session');
    this.name = 'SessionPinConflictError';
    this.token = token;
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
   *
   * `ifGenerationMatch` is accepted for forward-compatibility with a backend
   * that gates deletes on the observed generation; the in-memory store
   * ignores it (delete is unconditional).
   */
  delete(token: string, ifGenerationMatch?: number): Promise<void>;
}

/**
 * Transport-layer `Mcp-Session-Id` pinning, kept separate from artifact
 * storage so an artifact-only backend need not implement confidentiality
 * pinning. `InMemorySessionStore` implements both; `AuthoringSessionStore`
 * is the combined contract the MCP wires through.
 */
export interface SessionPinStore {
  /**
   * Persist a transport-layer `Mcp-Session-Id` pin against this session
   * token. Called on session mint so subsequent calls from a different MCP
   * transport session are rejected with `SESSION_NOT_FOUND` — the pin is a
   * confidentiality boundary, not an auth surface, so it surfaces as 404,
   * not 403.
   *
   * Idempotent for the same pin. Rebinding an existing pin to a different
   * value throws `SessionPinConflictError`. No production caller does this;
   * the failure is structured rather than a silent overwrite of a
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

/** The full session-store contract the MCP authoring tools wire through. */
export type AuthoringSessionStore = SessionStore & SessionPinStore;

export const MS_PER_HOUR = 60 * 60 * 1000;

/** Default sliding-window session lifetime: hours of inactivity before eviction. */
export const DEFAULT_SESSION_TTL_HOURS = 24;
export const DEFAULT_SESSION_TTL_MS = DEFAULT_SESSION_TTL_HOURS * MS_PER_HOUR;

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
export class InMemorySessionStore implements SessionStore, SessionPinStore {
  private readonly entries = new Map<string, ExpiringSession>();
  private readonly pins = new Map<string, string>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  /** Cumulative sessions evicted by the sliding TTL since process start. */
  private evictions = 0;

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
      this.evictions += 1;
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
        this.evictions += 1;
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

  async delete(token: string, _ifGenerationMatch?: number): Promise<void> {
    // _ifGenerationMatch is part of the interface for forward-compat; the
    // in-memory store deletes unconditionally.
    this.entries.delete(token);
    this.pins.delete(token);
  }

  async bindMcpSessionId(token: string, mcpSessionId: string): Promise<void> {
    // Refuse to overwrite an existing pin with a different value;
    // same-value rebinds are idempotent.
    const existing = this.pins.get(token);
    if (existing !== undefined && existing !== mcpSessionId) {
      throw new SessionPinConflictError(token);
    }
    this.pins.set(token, mcpSessionId);
  }

  async readMcpSessionPin(token: string): Promise<string | null> {
    return this.pins.get(token) ?? null;
  }

  /**
   * Snapshot of store cardinality and cumulative evictions, for the HTTP
   * access log. Sweeps first so `liveSessions` excludes already-expired
   * entries (the sweep itself may bump `evictions`). Concrete-only —
   * observability is an in-memory-backend concern, not a SessionStore contract.
   */
  stats(): { liveSessions: number; evictions: number } {
    this.sweepExpired();
    return { liveSessions: this.entries.size, evictions: this.evictions };
  }

  /** Test helper — number of live (unexpired) sessions. Not part of the public interface. */
  size(): number {
    this.sweepExpired();
    return this.entries.size;
  }
}
