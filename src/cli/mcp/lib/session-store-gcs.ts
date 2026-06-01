/**
 * GCS-backed implementation of `SessionStore`.
 *
 * Layout (per session token):
 *
 *   gs://<bucket>/<prefix>/generation              ← canonical pointer (JSON)
 *   gs://<bucket>/<prefix>/<stage>/content.json    ← immutable per save attempt
 *   gs://<bucket>/<prefix>/<stage>/manifest.json   ← optional, immutable per save attempt
 *   gs://<bucket>/<prefix>/.pin                    ← Mcp-Session-Id pin
 *
 * `<prefix>` is `tokenObjectPrefix(token)` — sha-256 hex of the token, NOT
 * the token itself. The raw token is a bearer credential; using it as the
 * object name would leak it into bucket listings, Cloud Audit Logs (Data
 * Access events log object names), SDK error stack traces, and Cloud
 * Console. Hashing keeps the layout deterministic for the same token
 * without exposing the credential through GCS-side surfaces.
 *
 * The `generation` pointer body is `{"generation": <N>, "stage": "<id>"}`
 * — both fields together name the live artifact for this session. The
 * stage id is a random per-save-attempt nonce (NOT derived from the
 * generation number).
 *
 * Why per-attempt nonces? Generation-keyed staging (`g-<N>/`) has a
 * collision: two writers targeting the same next generation both write to
 * `g-<N>/`, the second's body overwrites the first's, and a 412 loser's
 * cleanup of `g-<N>/` would wipe the winner. Per-attempt nonces give each
 * writer a private staging area; only the pointer flip is contended, and
 * that's gated by GCS's atomic `ifGenerationMatch` precondition.
 *
 * Save (atomic, no torn state visible to readers):
 *   1. Mint a fresh `stage` nonce.
 *   2. Upload `<token>/<stage>/content.json` (+ optional manifest.json).
 *      No precondition — the path is unique to this attempt.
 *   3. Peek the old pointer to capture its `stage` for later cleanup
 *      (only on an update; creates have nothing to clean up).
 *   4. Write `<token>/generation` with body `{generation: nextGen, stage}`
 *      under `ifGenerationMatch: <prev>`. THIS is the atomic flip — until
 *      it lands, no reader sees the new stage.
 *   5. On 412: best-effort delete `<token>/<our-stage>/`. Throw
 *      `SessionPreconditionFailedError`. A loser's stage is never
 *      reachable through any pointer, so no reader can be racing with
 *      this cleanup.
 *   6. On success: NO cleanup of the previous stage — a concurrent
 *      `load()` may still be mid-read of `<previousStage>/content.json`
 *      when we get here. Stages from prior generations accumulate
 *      until the session's overall TTL fires (the 7-day bucket
 *      lifecycle rule reaps the whole token prefix). Authoring
 *      sessions are short-lived enough that this is negligible.
 *
 * Load (single-snapshot, no torn-read window):
 *   1. Read `<token>/generation`. If absent → null (no session).
 *   2. Parse `{generation, stage}` (structural problems → corruption).
 *   3. Read `<token>/<stage>/content.json` (+ manifest) in parallel.
 *      These are immutable per attempt, so the pointer read in step 1
 *      pins exactly the bytes step 3 sees — no race.
 *   4. Content missing under a live pointer → corruption.
 *
 * Manifest carry-forward: if the caller's artifact has no manifest but
 * the previous generation did, the manifest is copied forward into the
 * new staging dir. Preserves the artifact-mode contract ("undefined
 * manifest on save = no manifest authored on this call, not
 * delete-the-historic-one"). Production callers always carry the full
 * artifact, so this only matters defensively.
 *
 * Delete: `deleteFiles({ prefix: '<token>/' })`, idempotent on 404. The
 * 7-day bucket lifecycle rule (managed by `scripts/deploy-mcp.sh`) is
 * the safety net for staged dirs that didn't get reaped (e.g. process
 * crash between the pointer flip and the cleanup step).
 *
 * The implementation does not configure project / credentials directly —
 * it relies on Application Default Credentials, which Cloud Run provides
 * via the service account configured by the deploy script. Locally, a
 * developer running with `PATHFINDER_SESSION_STORE=gcs` would need
 * `gcloud auth application-default login` first.
 */

import { randomBytes } from 'node:crypto';

import type { Bucket, Storage as GcsStorage } from '@google-cloud/storage';

import type { ContentJson, ManifestJson } from '../../../types/package.types';
import { crockfordBase32 } from './session-token';
import {
  SESSION_GENERATION_ABSENT,
  SessionPreconditionFailedError,
  SessionStoreCorruptedError,
  type LoadedSession,
  type SaveResult,
  type SessionArtifact,
  type SessionStore,
} from './session-store';
import {
  GENERATION_OBJECT,
  contentObjectName,
  generationObjectName,
  manifestObjectName,
  pinObjectName,
  sessionPrefix,
  stagedPrefix,
} from './gcs/paths';
import { isNotFoundError, isPreconditionFailedError, wrapStorageErrors } from './gcs/errors';
import { type RetryOptions, withRetryOn429 } from './gcs/retry';

interface GenerationPointer {
  generation: number;
  stage: string;
}

interface PointerSnapshot {
  pointer: GenerationPointer;
  /** GCS object generation backing the pointer (for ifGenerationMatch). */
  gcsGeneration: number;
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
  /**
   * Optional override for the per-attempt stage-id generator. Production
   * uses a random base32 nonce; tests that want a deterministic layout
   * inject a counter. Must produce a fresh id on every call.
   */
  generateStageId?: () => string;
}

/**
 * Parse and validate the JSON body of a `generation` pointer object.
 * Shared between the bare-download path (`readGenerationPointer`) and the
 * metadata-pinned snapshot path (`downloadPointerSnapshot`) so the two
 * cannot drift on validation thresholds or corruption messages.
 *
 * `objectName` is woven into every error so operator logs name the exact
 * GCS object whose body failed validation.
 */
function parseGenerationPointer(text: string, objectName: string): GenerationPointer {
  if (text.length === 0) {
    throw new SessionStoreCorruptedError(`session store corruption: ${objectName} is empty`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new SessionStoreCorruptedError(
      `session store corruption: ${objectName} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as GenerationPointer).generation !== 'number' ||
    typeof (parsed as GenerationPointer).stage !== 'string'
  ) {
    throw new SessionStoreCorruptedError(
      `session store corruption: ${objectName} is missing required fields (got ${JSON.stringify(parsed)})`
    );
  }
  const { generation, stage } = parsed as GenerationPointer;
  if (!Number.isFinite(generation) || generation <= 0 || !Number.isInteger(generation)) {
    throw new SessionStoreCorruptedError(
      `session store corruption: ${objectName}.generation is not a positive integer (got ${generation})`
    );
  }
  if (stage.length === 0) {
    throw new SessionStoreCorruptedError(`session store corruption: ${objectName}.stage is empty`);
  }
  return { generation, stage };
}

export class GcsSessionStore implements SessionStore {
  private readonly bucket: Bucket;
  private readonly retryOpts: RetryOptions;
  private readonly generateStageId: () => string;

  constructor(opts: GcsSessionStoreOptions, storage: GcsStorage) {
    this.bucket = storage.bucket(opts.bucket);
    this.retryOpts = opts.sleep ? { sleep: opts.sleep } : {};
    this.generateStageId = opts.generateStageId ?? defaultStageIdGenerator;
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
    return wrapStorageErrors(() => this.loadInner(token));
  }

  private async loadInner(token: string): Promise<LoadedSession | null> {
    // Step 1: read the generation pointer. Its presence defines whether
    // the session exists; its value names the staged prefix to read.
    // Single point-in-time snapshot — what we read next is immutable.
    const pointer = await this.readGenerationPointer(token);
    if (pointer === null) {
      return null;
    }

    // Step 2: read the staged artifact under <token>/<stage>/. These
    // objects are immutable per attempt: a later save writes to a
    // fresh <stage'>/ and only flips the pointer when its uploads
    // complete. So no torn-state window exists between the pointer
    // read and these reads.
    const [contentResult, manifestResult] = await Promise.allSettled([
      this.downloadJson<ContentJson>(contentObjectName(token, pointer.stage)),
      this.downloadJson<ManifestJson>(manifestObjectName(token, pointer.stage)),
    ]);

    if (contentResult.status === 'rejected') {
      if (isNotFoundError(contentResult.reason)) {
        throw new SessionStoreCorruptedError(
          `session store corruption: ${GENERATION_OBJECT} points at stage ${pointer.stage} but ${contentObjectName(
            token,
            pointer.stage
          )} is missing`
        );
      }
      throw contentResult.reason;
    }
    if (contentResult.value === null) {
      throw new SessionStoreCorruptedError(
        `session store corruption: ${contentObjectName(token, pointer.stage)} is empty`
      );
    }

    let manifest: ManifestJson | undefined;
    if (manifestResult.status === 'fulfilled' && manifestResult.value !== null) {
      manifest = manifestResult.value;
    } else if (manifestResult.status === 'rejected' && !isNotFoundError(manifestResult.reason)) {
      throw manifestResult.reason;
    }

    return {
      artifact: { content: contentResult.value, manifest },
      generation: pointer.generation,
    };
  }

  /**
   * Read `<prefix>/generation` and parse the JSON body. Returns `null`
   * when the pointer is absent (session does not exist). Throws
   * `SessionStoreCorruptedError` for malformed contents.
   *
   * Corruption messages reference the hashed prefix (the literal GCS
   * object name) rather than the raw token — the messages may end up in
   * operator logs and the raw token is a bearer credential.
   */
  private async readGenerationPointer(token: string): Promise<GenerationPointer | null> {
    const objectName = generationObjectName(token);
    let text: string | null;
    try {
      text = await this.downloadText(objectName);
    } catch (err) {
      if (isNotFoundError(err)) {
        return null;
      }
      throw err;
    }
    return parseGenerationPointer(text ?? '', objectName);
  }

  async save(token: string, artifact: SessionArtifact, ifGenerationMatch: number): Promise<SaveResult> {
    return wrapStorageErrors(() => this.saveInner(token, artifact, ifGenerationMatch));
  }

  private async saveInner(token: string, artifact: SessionArtifact, ifGenerationMatch: number): Promise<SaveResult> {
    const isCreate = ifGenerationMatch === SESSION_GENERATION_ABSENT;
    const nextGeneration = isCreate ? 1 : ifGenerationMatch + 1;
    const newStage = this.generateStageId();

    // For updates, capture the previous pointer (session-gen + stage)
    // together with the GCS object generation behind it. The GCS-gen is
    // what gates the pointer flip (GCS preconditions use opaque per-
    // object generations, not user-controlled counters); the session-gen
    // lets us pre-validate the caller's `ifGenerationMatch` and surface
    // a structured PRECONDITION_FAILED locally instead of waiting on a
    // 412 we couldn't classify.
    //
    // The read is internally atomic: `downloadPointerSnapshot` uses
    // metadata + body pinned to the same GCS-gen, so the session-gen
    // we validate and the GCS-gen we use as the precondition are
    // guaranteed to describe the same pointer state.
    let previousSnapshot: PointerSnapshot | null = null;
    if (!isCreate) {
      previousSnapshot = await this.downloadPointerSnapshot(token);
      if (previousSnapshot === null) {
        throw new SessionPreconditionFailedError(ifGenerationMatch, SESSION_GENERATION_ABSENT);
      }
      if (previousSnapshot.pointer.generation !== ifGenerationMatch) {
        throw new SessionPreconditionFailedError(ifGenerationMatch, previousSnapshot.pointer.generation);
      }
    }

    // Manifest carry-forward: an update with no manifest preserves the
    // previous generation's manifest (the artifact-mode contract treats
    // undefined as "no manifest authored on this call", not "delete").
    // Production callers always carry the full artifact through the
    // tmpdir-based runner, so this only matters defensively.
    let manifestToWrite = artifact.manifest;
    if (manifestToWrite === undefined && previousSnapshot !== null) {
      manifestToWrite = await this.readManifestIfPresent(token, previousSnapshot.pointer.stage);
    }

    // Step 1: upload the artifact into our private staged prefix. The
    // path is unique to this attempt (per-attempt nonce), so a 412
    // loser cannot clobber a winner's bytes.
    const artifactWrites: Array<Promise<unknown>> = [
      this.uploadJson(contentObjectName(token, newStage), artifact.content),
    ];
    if (manifestToWrite !== undefined) {
      artifactWrites.push(this.uploadJson(manifestObjectName(token, newStage), manifestToWrite));
    }
    await Promise.all(artifactWrites);

    // Step 2: flip the generation pointer atomically. The `ifGenerationMatch`
    // we pass to GCS is the per-object GCS generation captured during the
    // snapshot read above (or 0 for create-only). A 412 here means another
    // writer beat us to the flip between our snapshot read and this write.
    // Our staged dir is now garbage — best-effort cleanup so it doesn't
    // wait for the 7-day lifecycle reap.
    const pointerBody: GenerationPointer = { generation: nextGeneration, stage: newStage };
    const gcsPrecondition = isCreate ? 0 : previousSnapshot!.gcsGeneration;
    try {
      await this.uploadJsonWithPrecondition(generationObjectName(token), pointerBody, gcsPrecondition);
    } catch (err) {
      if (isPreconditionFailedError(err)) {
        await this.cleanupStagedPrefix(token, newStage);
        const observed = await this.peekGeneration(token);
        throw new SessionPreconditionFailedError(ifGenerationMatch, observed);
      }
      throw err;
    }

    // No on-success cleanup of the previous stage. A concurrent
    // `load()` may still be mid-read of `<previousStage>/content.json`
    // when we get here, and a cleanup race would surface as a spurious
    // corruption error on the reader. The previous stage's storage is
    // bounded by the session's overall TTL (the 7-day bucket lifecycle
    // rule reaps the whole token prefix), and authoring sessions are
    // short-lived enough that intra-session stage accumulation is
    // negligible. Loser-cleanup on the 412 path above IS safe because
    // a loser's stage is never reachable through any pointer, so no
    // reader can be looking at it.

    return { generation: nextGeneration };
  }

  /**
   * Read the manifest from a given stage dir, or undefined if absent.
   * Used by `save` to carry the manifest forward when the caller
   * passes none.
   */
  private async readManifestIfPresent(token: string, stage: string): Promise<ManifestJson | undefined> {
    try {
      const value = await this.downloadJson<ManifestJson>(manifestObjectName(token, stage));
      return value === null ? undefined : value;
    } catch (err) {
      if (isNotFoundError(err)) {
        return undefined;
      }
      throw err;
    }
  }

  /**
   * Atomically capture the pointer body + its GCS object generation.
   *
   * The read uses GCS's `generation:` pin: we first fetch object
   * metadata to learn the current `gcsGeneration`, then download the
   * body pinned to that exact generation. If a concurrent writer
   * advances the pointer between the two calls, our pinned download
   * either returns the older body (matching our `gcsGeneration`) or
   * fails — but it cannot return a body that doesn't correspond to
   * the captured `gcsGeneration`. So the pair we return is always
   * internally consistent.
   *
   * Returns `null` when the pointer is absent (no session).
   */
  private async downloadPointerSnapshot(token: string): Promise<PointerSnapshot | null> {
    const objectName = generationObjectName(token);
    const file = this.bucket.file(objectName);

    let gcsGeneration: number;
    try {
      const [metadata] = await withRetryOn429(() => file.getMetadata(), this.retryOpts);
      const raw = (metadata as { generation?: string | number }).generation;
      if (raw === undefined || raw === null) {
        return null;
      }
      const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
      }
      gcsGeneration = parsed;
    } catch (err) {
      if (isNotFoundError(err)) {
        return null;
      }
      throw err;
    }

    let body: string;
    try {
      const [buf] = await withRetryOn429(() => file.download(), this.retryOpts);
      body = buf.toString('utf8');
    } catch (err) {
      if (isNotFoundError(err)) {
        // Object was deleted between getMetadata and download. Treat as
        // absent — the caller will surface PRECONDITION_FAILED with
        // actual=0.
        return null;
      }
      throw err;
    }
    // The body and gcsGeneration may have been captured at slightly
    // different points in time if another writer raced between the
    // two calls. That's harmless: if the body we parsed shows a
    // session-gen that doesn't match the caller's `ifGenerationMatch`,
    // we surface PRECONDITION_FAILED before we ever use the captured
    // gcsGeneration. If the session-gen DOES match (so we proceed),
    // the gcsGeneration we captured is no later than the body — so
    // the subsequent pointer-flip write with that gcsGeneration will
    // see 412 from any racing writer that advanced past it.

    const pointer = parseGenerationPointer(body, objectName);
    return { pointer, gcsGeneration };
  }

  /**
   * Best-effort delete of `<token>/<stage>/`. Used to clean up a
   * loser's staged uploads on 412 and to reap the previous attempt's
   * staged dir after a successful save. All errors are swallowed —
   * the 7-day bucket lifecycle rule is the safety net.
   */
  private async cleanupStagedPrefix(token: string, stage: string): Promise<void> {
    try {
      await this.bucket.deleteFiles({ prefix: `${stagedPrefix(token, stage)}/` });
    } catch {
      // Intentionally silent. See method doc.
    }
  }

  async delete(token: string): Promise<void> {
    return wrapStorageErrors(async () => {
      try {
        await this.bucket.deleteFiles({ prefix: `${sessionPrefix(token)}/` });
      } catch (err) {
        if (isNotFoundError(err)) {
          return;
        }
        throw err;
      }
    });
  }

  /**
   * Persist the MCP transport session id as a sidecar object at
   * `<prefix>/.pin`. Written with `ifGenerationMatch=0`, so a second bind
   * cannot silently overwrite the first. On 412 we read the existing pin
   * and:
   *   - if it matches the new value, treat as idempotent no-op (covers
   *     retry-after-network-hiccup on the mint path);
   *   - if it differs, throw `SessionPreconditionFailedError`. No
   *     production caller does this; surfacing it loudly is preferable
   *     to silent overwrite of a confidentiality field.
   */
  async bindMcpSessionId(token: string, mcpSessionId: string): Promise<void> {
    return wrapStorageErrors(async () => {
      try {
        await withRetryOn429(
          () =>
            this.bucket.file(pinObjectName(token)).save(mcpSessionId, {
              resumable: false,
              contentType: 'text/plain',
              preconditionOpts: { ifGenerationMatch: 0 },
            }),
          this.retryOpts
        );
      } catch (err) {
        if (!isPreconditionFailedError(err)) {
          throw err;
        }
        const existing = await this.readMcpSessionPin(token);
        if (existing === mcpSessionId) {
          return;
        }
        // Pin already bound to a different value — refuse to overwrite.
        // The actual generation isn't meaningful to the caller here; the
        // structured error tells them this was a precondition failure.
        throw new SessionPreconditionFailedError(SESSION_GENERATION_ABSENT, 1);
      }
    });
  }

  async readMcpSessionPin(token: string): Promise<string | null> {
    return wrapStorageErrors(async () => {
      try {
        const text = await this.downloadText(pinObjectName(token));
        return text === null ? null : text.trim();
      } catch (err) {
        if (isNotFoundError(err)) {
          return null;
        }
        throw err;
      }
    });
  }

  /** Read the current session generation, or `0` if absent / unparseable. */
  private async peekGeneration(token: string): Promise<number> {
    try {
      const pointer = await this.readGenerationPointer(token);
      return pointer === null ? SESSION_GENERATION_ABSENT : pointer.generation;
    } catch {
      // peekGeneration is only called on the 412 error path to populate
      // the structured `actual` field. A corruption error here would
      // mask the original PRECONDITION_FAILED — swallow and report 0.
      return SESSION_GENERATION_ABSENT;
    }
  }

  private async downloadJson<T>(objectName: string): Promise<T | null> {
    const text = await this.downloadText(objectName);
    if (text === null) {
      return null;
    }
    try {
      return JSON.parse(text) as T;
    } catch (err) {
      // The load contract says "absent → null, otherwise transport
      // error or SessionStoreCorruptedError." An unparseable artifact
      // is corruption, not absence — surface it structured so the
      // operator can intervene rather than leaving callers to guess
      // from an unstructured 500.
      throw new SessionStoreCorruptedError(
        `session store corruption: ${objectName} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
      );
    }
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

  /**
   * JSON upload with a precondition on the GCS object generation (NOT
   * the session generation). Used by `save` to atomically flip the
   * pointer. NOT wrapped in 429 retry — a 429 on the pointer write
   * would race against the precondition logic (we'd have to re-peek
   * and re-decide between retries). Easier to surface a 429 here as
   * a transient failure for the caller to re-issue.
   */
  private async uploadJsonWithPrecondition(
    objectName: string,
    value: unknown,
    ifGenerationMatch: number
  ): Promise<void> {
    await this.bucket.file(objectName).save(JSON.stringify(value), {
      resumable: false,
      contentType: 'application/json',
      preconditionOpts: { ifGenerationMatch },
    });
  }
}

/**
 * Default stage-id generator: 16 chars of Crockford base32 (~80 bits of
 * entropy). Two concurrent saves on the same token will, in practice,
 * never collide — and even if they did, the only consequence is that one
 * writer's content uploads land in the other writer's staging dir, which
 * is still gated by the pointer-flip precondition (so one of them sees
 * 412 and cleans up).
 */
function defaultStageIdGenerator(): string {
  return crockfordBase32(randomBytes(10), 16);
}

async function loadDefaultStorage(): Promise<GcsStorage> {
  const mod = await import('@google-cloud/storage');
  return new mod.Storage();
}
