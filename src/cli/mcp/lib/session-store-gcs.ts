/**
 * GCS-backed implementation of `SessionStore` (P7).
 *
 * Each session is stored as two objects under a token-prefixed directory:
 *
 *   gs://<bucket>/<token>/content.json
 *   gs://<bucket>/<token>/manifest.json   (optional)
 *
 * A third object, `gs://<bucket>/<token>/generation`, carries a single
 * decimal integer — the canonical generation number for the session.
 * We need it because GCS object generations are independent per-object,
 * but the session has a single logical generation that increments on
 * every save. Pinning it to one extra object lets us:
 *
 *   - Use that object's GCS generation as the `ifGenerationMatch`
 *     precondition for the whole save, with the same semantics as the
 *     in-memory store (0 = create-only, positive = update-only-if-current).
 *   - Avoid juggling two separate per-object generations for
 *     content.json + manifest.json.
 *   - Survive a save that touches only one of the two artifact files —
 *     the session generation moves regardless.
 *
 * Save order on update:
 *   1. content.json + manifest.json (best-effort parallel write — no
 *      ifGenerationMatch on these; the generation object is the lock).
 *   2. generation (with `ifGenerationMatch`). On precondition failure,
 *      the artifact writes from step 1 are stale-but-valid; the next
 *      save will overwrite them. No partial-state visibility issue
 *      because clients only ever access via this store, which always
 *      reads through the generation file.
 *
 * Load reads all three in parallel; if content.json is missing the
 * session does not exist (returns null). A missing generation file is
 * treated as a corruption and surfaces as an error rather than a silent
 * null — the only way to land in that state is a partial delete.
 *
 * Delete is `bucket.deleteFiles({ prefix: '<token>/' })`, idempotent on
 * 404. The 7-day bucket lifecycle rule (managed by
 * `scripts/deploy-mcp.sh`) is the safety net.
 *
 * The implementation does not configure project / credentials directly —
 * it relies on Application Default Credentials, which Cloud Run provides
 * via the service account configured by the deploy script. Locally, a
 * developer running with `PATHFINDER_SESSION_STORE=gcs` would need
 * `gcloud auth application-default login` first.
 */

import type { Bucket, Storage as GcsStorage } from '@google-cloud/storage';

import type { ContentJson, ManifestJson } from '../../../types/package.types';
import {
  SESSION_GENERATION_ABSENT,
  SessionPreconditionFailedError,
  type LoadedSession,
  type SaveResult,
  type SessionArtifact,
  type SessionStore,
} from './session-store';

const CONTENT_OBJECT = 'content.json';
const MANIFEST_OBJECT = 'manifest.json';
const GENERATION_OBJECT = 'generation';
const MCP_SESSION_PIN_OBJECT = '.pin';

interface GcsErrorLike {
  code?: number | string;
  errors?: Array<{ reason?: string }>;
}

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const e = err as GcsErrorLike;
  return e.code === 404 || e.code === '404';
}

function isPreconditionFailedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const e = err as GcsErrorLike;
  if (e.code === 412 || e.code === '412') {
    return true;
  }
  if (Array.isArray(e.errors)) {
    for (const inner of e.errors) {
      if (inner?.reason === 'conditionNotMet') {
        return true;
      }
    }
  }
  return false;
}

/**
 * GCS imposes a per-object write rate limit of ~1 mutation per second
 * (https://cloud.google.com/storage/docs/gcs429). Real agent flows are
 * LLM-paced and never approach this, but bursty smoke tests / racing
 * replicas can. Surface as 429 with reason `rateLimitExceeded`.
 */
function isRateLimitedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const e = err as GcsErrorLike;
  if (e.code === 429 || e.code === '429') {
    return true;
  }
  if (Array.isArray(e.errors)) {
    for (const inner of e.errors) {
      if (inner?.reason === 'rateLimitExceeded') {
        return true;
      }
    }
  }
  return false;
}

/**
 * Run `fn`, retrying on transient 429 (per-object rate limit) with
 * exponential backoff + jitter. Cap chosen so the worst case stays
 * well under the 30s per-call wallclock budget in `transports/http.ts`.
 * Non-429 errors propagate immediately so precondition-failed,
 * not-found, and auth errors still surface fast.
 */
export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

async function withRetryOn429<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const baseDelayMs = opts.baseDelayMs ?? 1100;
  const maxDelayMs = opts.maxDelayMs ?? 8000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimitedError(err)) {
        throw err;
      }
      lastErr = err;
      if (attempt === maxAttempts - 1) {
        break;
      }
      // Exponential backoff with full jitter: random in [baseDelay, min(max, base * 2^attempt)].
      const exp = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
      const wait = baseDelayMs + Math.random() * (exp - baseDelayMs);
      await sleep(wait);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export interface GcsSessionStoreOptions {
  /** Bucket name (no `gs://` prefix). */
  bucket: string;
  /**
   * Optional pre-constructed GCS client. Lets tests inject a stub. When
   * absent, the impl lazy-loads `@google-cloud/storage` and constructs a
   * default-credentials client.
   */
  storage?: GcsStorage;
  /**
   * Optional override for the 429-retry sleep function. Tests inject a
   * no-op so the retry path doesn't block on wallclock; production uses
   * the default `setTimeout`-backed implementation.
   */
  sleep?: (ms: number) => Promise<void>;
}

export class GcsSessionStore implements SessionStore {
  private readonly bucket: Bucket;
  private readonly retryOpts: RetryOptions;

  constructor(opts: GcsSessionStoreOptions, storage: GcsStorage) {
    this.bucket = storage.bucket(opts.bucket);
    this.retryOpts = opts.sleep ? { sleep: opts.sleep } : {};
  }

  /**
   * Factory that lazy-loads `@google-cloud/storage`. Use this from
   * production code; tests should call the constructor directly with a
   * stub storage client.
   */
  static async create(opts: GcsSessionStoreOptions): Promise<GcsSessionStore> {
    const storage = opts.storage ?? (await loadDefaultStorage());
    return new GcsSessionStore(opts, storage);
  }

  async load(token: string): Promise<LoadedSession | null> {
    const [contentResult, manifestResult, generationResult] = await Promise.allSettled([
      this.downloadJson<ContentJson>(`${token}/${CONTENT_OBJECT}`),
      this.downloadJson<ManifestJson>(`${token}/${MANIFEST_OBJECT}`),
      this.downloadText(`${token}/${GENERATION_OBJECT}`),
    ]);

    if (contentResult.status === 'rejected') {
      if (isNotFoundError(contentResult.reason)) {
        return null;
      }
      throw contentResult.reason;
    }
    if (contentResult.value === null) {
      // download succeeded with empty body — treat as absent
      return null;
    }

    let manifest: ManifestJson | undefined;
    if (manifestResult.status === 'fulfilled' && manifestResult.value !== null) {
      manifest = manifestResult.value;
    } else if (manifestResult.status === 'rejected' && !isNotFoundError(manifestResult.reason)) {
      throw manifestResult.reason;
    }

    if (generationResult.status === 'rejected') {
      if (isNotFoundError(generationResult.reason)) {
        throw new Error(
          `session store corruption: ${token}/${CONTENT_OBJECT} exists but ${GENERATION_OBJECT} is missing`
        );
      }
      throw generationResult.reason;
    }
    if (generationResult.value === null) {
      throw new Error(`session store corruption: ${token}/${GENERATION_OBJECT} is empty`);
    }
    const generation = Number.parseInt(generationResult.value.trim(), 10);
    if (!Number.isFinite(generation) || generation <= 0) {
      throw new Error(`session store corruption: ${token}/${GENERATION_OBJECT} is not a positive integer`);
    }

    return {
      artifact: { content: contentResult.value, manifest },
      generation,
    };
  }

  async save(token: string, artifact: SessionArtifact, ifGenerationMatch: number): Promise<SaveResult> {
    const nextGeneration = ifGenerationMatch === SESSION_GENERATION_ABSENT ? 1 : ifGenerationMatch + 1;

    // Write content.json and (optionally) manifest.json first. These have
    // no precondition; the generation object is the lock.
    const artifactWrites: Array<Promise<unknown>> = [this.uploadJson(`${token}/${CONTENT_OBJECT}`, artifact.content)];
    if (artifact.manifest !== undefined) {
      artifactWrites.push(this.uploadJson(`${token}/${MANIFEST_OBJECT}`, artifact.manifest));
    } else {
      // No manifest on this save. We do NOT remove an existing manifest —
      // P7's mutation flow always carries forward the full artifact, so
      // an undefined manifest on save means "no manifest authored", which
      // matches the artifact-mode contract. If a session has had a
      // manifest written previously and the caller now passes undefined,
      // that historic manifest stays put.
    }
    await Promise.all(artifactWrites);

    // Bump the generation last, with the precondition. A 412 here means
    // someone else moved the session generation since the caller read
    // it; the artifact writes above are then stale-but-valid (the next
    // save by the winner will overwrite them) and we propagate the
    // precondition failure.
    try {
      await this.uploadText(`${token}/${GENERATION_OBJECT}`, String(nextGeneration), ifGenerationMatch);
    } catch (err) {
      if (isPreconditionFailedError(err)) {
        const observed = await this.peekGeneration(token);
        throw new SessionPreconditionFailedError(ifGenerationMatch, observed);
      }
      throw err;
    }

    return { generation: nextGeneration };
  }

  async delete(token: string): Promise<void> {
    try {
      await this.bucket.deleteFiles({ prefix: `${token}/` });
    } catch (err) {
      if (isNotFoundError(err)) {
        return;
      }
      throw err;
    }
  }

  /**
   * P7 task 16. Persist the MCP transport session id as a sidecar object
   * at `<token>/.pin`. Plain text, no preconditions — the pin is written
   * exactly once (at session mint) and never updated by production
   * callers, so the "no precondition" relaxation is fine.
   */
  async bindMcpSessionId(token: string, mcpSessionId: string): Promise<void> {
    await withRetryOn429(
      () =>
        this.bucket.file(`${token}/${MCP_SESSION_PIN_OBJECT}`).save(mcpSessionId, {
          resumable: false,
          contentType: 'text/plain',
        }),
      this.retryOpts
    );
  }

  async readMcpSessionPin(token: string): Promise<string | null> {
    try {
      const text = await this.downloadText(`${token}/${MCP_SESSION_PIN_OBJECT}`);
      return text === null ? null : text.trim();
    } catch (err) {
      if (isNotFoundError(err)) {
        return null;
      }
      throw err;
    }
  }

  /** Read the current generation, or `0` if absent. */
  private async peekGeneration(token: string): Promise<number> {
    try {
      const text = await this.downloadText(`${token}/${GENERATION_OBJECT}`);
      if (text === null) {
        return SESSION_GENERATION_ABSENT;
      }
      const n = Number.parseInt(text.trim(), 10);
      return Number.isFinite(n) && n > 0 ? n : SESSION_GENERATION_ABSENT;
    } catch (err) {
      if (isNotFoundError(err)) {
        return SESSION_GENERATION_ABSENT;
      }
      throw err;
    }
  }

  private async downloadJson<T>(objectName: string): Promise<T | null> {
    const text = await this.downloadText(objectName);
    if (text === null) {
      return null;
    }
    return JSON.parse(text) as T;
  }

  private async downloadText(objectName: string): Promise<string | null> {
    const [buf] = await withRetryOn429(() => this.bucket.file(objectName).download(), this.retryOpts);
    if (buf.length === 0) {
      return null;
    }
    return buf.toString('utf8');
  }

  private async uploadJson(objectName: string, value: unknown): Promise<void> {
    await withRetryOn429(
      () =>
        this.bucket.file(objectName).save(JSON.stringify(value), {
          resumable: false,
          contentType: 'application/json',
        }),
      this.retryOpts
    );
  }

  private async uploadText(objectName: string, value: string, ifGenerationMatch: number): Promise<void> {
    // Note: the generation-bump write is NOT wrapped in 429 retry. A 429
    // on the generation object would race against the precondition logic
    // (we'd need to peek + re-decide between retries); easier to surface
    // it as a precondition-style failure for the caller to re-issue.
    await this.bucket.file(objectName).save(value, {
      resumable: false,
      contentType: 'text/plain',
      preconditionOpts: { ifGenerationMatch },
    });
  }
}

async function loadDefaultStorage(): Promise<GcsStorage> {
  const mod = await import('@google-cloud/storage');
  return new mod.Storage();
}
