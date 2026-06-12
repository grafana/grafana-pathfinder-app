/**
 * In-memory session store for the authoring tools. The deployed MCP runs as a
 * single instance, so a process-local map holds every session; a sliding TTL
 * bounds growth. `save` uses `ifGenerationMatch` optimistic concurrency
 * (`0` = create-if-absent); a mismatch throws `SessionPreconditionFailedError`.
 */

import type { ContentJson, ManifestJson } from '../../../types/package.types';

export interface SessionArtifact {
  content: ContentJson;
  manifest?: ManifestJson;
}

export interface LoadedSession {
  artifact: SessionArtifact;
  /** Monotonic generation for optimistic concurrency. */
  generation: number;
}

export interface SaveResult {
  generation: number;
}

/** `ifGenerationMatch` sentinel: create only if absent. */
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
 * Thrown by `bindMcpSessionId` when a pin would be overwritten with a different
 * value. The raw token stays off `.message` (it's a bearer credential).
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
  /** Current artifact + generation, or `null` if absent. Never throws for the absent case. */
  load(token: string): Promise<LoadedSession | null>;

  /** Write the artifact; throws `SessionPreconditionFailedError` if the current generation ≠ `ifGenerationMatch` (`0` = create-only). */
  save(token: string, artifact: SessionArtifact, ifGenerationMatch: number): Promise<SaveResult>;

  /** Remove the session; idempotent. `ifGenerationMatch` is reserved for a future precondition-gated backend (in-memory ignores it). */
  delete(token: string, ifGenerationMatch?: number): Promise<void>;
}

/**
 * Mcp-Session-Id pinning, kept separate from artifact storage so an
 * artifact-only backend need not implement it. `InMemorySessionStore`
 * implements both; `AuthoringSessionStore` is the combined contract.
 */
export interface SessionPinStore {
  /**
   * Pin the session to an `Mcp-Session-Id` at mint; a later call from a
   * different transport session gets `SESSION_NOT_FOUND` (404, not 403 — the
   * pin is a confidentiality boundary, not auth). Idempotent for the same
   * value; a different value throws `SessionPinConflictError`.
   */
  bindMcpSessionId(token: string, mcpSessionId: string): Promise<void>;

  /** The pinned `Mcp-Session-Id`, or `null` if never bound (stdio / no header). */
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
 * Concurrency: `save`'s generation check guards against lost updates even
 * though the read-modify-write is not atomic at the JS level — the loser
 * throws `PRECONDITION_FAILED`. Artifacts are stored by reference (the CLI
 * runner always writes fresh objects, so no defensive copy is needed).
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

  /** Entry for `token` if present and unexpired; evicts and returns null otherwise. */
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

  /** Drop every session idle past its TTL. */
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
    this.entries.delete(token);
    this.pins.delete(token);
  }

  async bindMcpSessionId(token: string, mcpSessionId: string): Promise<void> {
    const existing = this.pins.get(token);
    if (existing !== undefined && existing !== mcpSessionId) {
      throw new SessionPinConflictError(token);
    }
    this.pins.set(token, mcpSessionId);
  }

  async readMcpSessionPin(token: string): Promise<string | null> {
    return this.pins.get(token) ?? null;
  }

  /** Cardinality + cumulative evictions for the access log; sweeps first so `liveSessions` excludes expired. Concrete-only (not a `SessionStore` method). */
  stats(): { liveSessions: number; evictions: number } {
    this.sweepExpired();
    return { liveSessions: this.entries.size, evictions: this.evictions };
  }

  /** Test helper — number of live (unexpired) sessions. */
  size(): number {
    this.sweepExpired();
    return this.entries.size;
  }
}
