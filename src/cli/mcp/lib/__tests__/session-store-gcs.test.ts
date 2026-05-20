/**
 * @jest-environment node
 *
 * Tests for `GcsSessionStore` using an in-memory fake that emulates the
 * subset of the `@google-cloud/storage` surface we depend on. The fake
 * tracks per-object generations and rejects writes with the wrong
 * `ifGenerationMatch` using the same `code: 412` shape the real SDK uses.
 */

import type { Storage as GcsStorage } from '@google-cloud/storage';

import type { ContentJson } from '../../../../types/package.types';
import { SESSION_GENERATION_ABSENT, SessionPreconditionFailedError, type SessionArtifact } from '../session-store';
import { GcsSessionStore } from '../session-store-gcs';
import { tokenObjectPrefix } from '../session-token';

const TOKEN_A = 'aaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_B = 'bbbbbbbbbbbbbbbbbbbbbb';
// Object-name prefix derived from the bearer token. The store hashes
// the token before using it as a GCS path, so every assertion that
// references object names must hash through this helper rather than
// embedding the raw token. See `session-token.ts#tokenObjectPrefix`.
const PREFIX_A = tokenObjectPrefix(TOKEN_A);

function makeArtifact(title: string, withManifest = false): SessionArtifact {
  const content: ContentJson = { id: 'fixture', title, blocks: [] };
  if (withManifest) {
    return { content, manifest: { id: 'fixture', type: 'guide', description: title } };
  }
  return { content };
}

// ---------------------------------------------------------------------------
// Minimal in-memory GCS fake.
//
// Each "object" carries a body + monotonic generation, mirroring the real
// GCS object metadata. `save(..., { preconditionOpts: { ifGenerationMatch } })`
// throws an ApiError-shape with code: 412 on mismatch — exactly what our
// production code branches on via `isPreconditionFailedError`.
// ---------------------------------------------------------------------------

class FakeObject {
  body: Buffer | null = null;
  generation = 0;
}

class FakeBucket {
  private readonly objects = new Map<string, FakeObject>();

  file(name: string): FakeFile {
    return new FakeFile(this.objects, name);
  }

  async deleteFiles({ prefix }: { prefix: string }): Promise<void> {
    for (const name of Array.from(this.objects.keys())) {
      if (name.startsWith(prefix)) {
        this.objects.delete(name);
      }
    }
  }

  // Test helpers
  has(name: string): boolean {
    return this.objects.has(name);
  }

  list(): string[] {
    return Array.from(this.objects.keys());
  }
}

class FakeFile {
  constructor(
    private readonly objects: Map<string, FakeObject>,
    private readonly name: string
  ) {}

  async save(data: string | Buffer, opts?: { preconditionOpts?: { ifGenerationMatch?: number } }): Promise<void> {
    const existing = this.objects.get(this.name);
    const currentGeneration = existing ? existing.generation : 0;
    const requested = opts?.preconditionOpts?.ifGenerationMatch;
    if (requested !== undefined && requested !== currentGeneration) {
      const err: any = new Error('Precondition Failed');
      err.code = 412;
      err.errors = [{ reason: 'conditionNotMet' }];
      throw err;
    }
    const next = existing ?? new FakeObject();
    next.body = typeof data === 'string' ? Buffer.from(data) : data;
    next.generation = currentGeneration + 1;
    this.objects.set(this.name, next);
  }

  async download(opts?: { generation?: number }): Promise<[Buffer]> {
    const obj = this.objects.get(this.name);
    if (!obj || obj.body === null) {
      const err: any = new Error('Not Found');
      err.code = 404;
      throw err;
    }
    // GCS `generation:` pin — if the caller specified a generation
    // that doesn't match the current object generation, surface 404
    // (the object at that generation no longer exists).
    if (opts?.generation !== undefined && opts.generation !== obj.generation) {
      const err: any = new Error('Not Found (generation mismatch)');
      err.code = 404;
      throw err;
    }
    return [obj.body];
  }

  async getMetadata(): Promise<[{ generation: number }]> {
    const obj = this.objects.get(this.name);
    if (!obj || obj.body === null) {
      const err: any = new Error('Not Found');
      err.code = 404;
      throw err;
    }
    return [{ generation: obj.generation }];
  }
}

class FakeStorage {
  readonly buckets = new Map<string, FakeBucket>();

  bucket(name: string): FakeBucket {
    const existing = this.buckets.get(name);
    if (existing) {
      return existing;
    }
    const fresh = new FakeBucket();
    this.buckets.set(name, fresh);
    return fresh;
  }
}

function newStore(stageIds?: string[]): { store: GcsSessionStore; bucket: FakeBucket } {
  const storage = new FakeStorage();
  // Deterministic stage-id generator for tests. If a list is passed,
  // pull from it in order; otherwise produce sequential `stage-0`,
  // `stage-1`, ... ids. This is the only test-time difference from
  // production (random base32).
  let counter = 0;
  const generateStageId = stageIds
    ? () => {
        const next = stageIds.shift();
        if (next === undefined) {
          throw new Error('test stage-id pool exhausted');
        }
        return next;
      }
    : () => `stage-${counter++}`;
  const store = new GcsSessionStore(
    // Inject a no-op sleep so the 429 retry backoff doesn't burn wallclock
    // in tests. Production omits this and gets the default setTimeout-backed
    // backoff (~1.1s base, exponential up to 8s).
    { bucket: 'test-bucket', sleep: () => Promise.resolve(), generateStageId },
    storage as unknown as GcsStorage
  );
  return { store, bucket: storage.bucket('test-bucket') };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GcsSessionStore.load', () => {
  it('returns null for an unknown token', async () => {
    const { store } = newStore();
    expect(await store.load(TOKEN_A)).toBeNull();
  });

  it('throws on corruption when the generation pointer references a missing staged dir', async () => {
    const { store, bucket } = newStore();
    // Write a generation pointer that names a stage we never staged.
    await bucket.file(`${PREFIX_A}/generation`).save(JSON.stringify({ generation: 1, stage: 'nonexistent-stage' }));
    await expect(store.load(TOKEN_A)).rejects.toThrow(/corruption.*missing/);
  });

  it('throws on corruption when the generation pointer body is malformed', async () => {
    const { store, bucket } = newStore();
    await bucket.file(`${PREFIX_A}/generation`).save('not-json-at-all');
    await expect(store.load(TOKEN_A)).rejects.toThrow(/corruption.*not valid JSON/);
  });

  it('loads content without manifest when manifest was never written', async () => {
    const { store } = newStore();
    await store.save(TOKEN_A, makeArtifact('v1'), SESSION_GENERATION_ABSENT);
    const loaded = await store.load(TOKEN_A);
    expect(loaded?.artifact.content.title).toBe('v1');
    expect(loaded?.artifact.manifest).toBeUndefined();
    expect(loaded?.generation).toBe(1);
  });

  it('loads content + manifest when both were written', async () => {
    const { store } = newStore();
    await store.save(TOKEN_A, makeArtifact('v1', /* manifest */ true), SESSION_GENERATION_ABSENT);
    const loaded = await store.load(TOKEN_A);
    expect(loaded?.artifact.manifest).toEqual({ id: 'fixture', type: 'guide', description: 'v1' });
  });
});

describe('GcsSessionStore.save', () => {
  it('writes a fresh session at generation 1 when ifGenerationMatch=0', async () => {
    const { store, bucket } = newStore();
    const result = await store.save(TOKEN_A, makeArtifact('v1'), SESSION_GENERATION_ABSENT);
    expect(result.generation).toBe(1);
    expect(bucket.has(`${PREFIX_A}/generation`)).toBe(true);
    // Content lives under a per-attempt stage prefix, not the top level.
    expect(bucket.list().some((n) => n.startsWith(`${PREFIX_A}/`) && n.endsWith('/content.json'))).toBe(true);
    // Raw bearer token must never appear in object names — that's the
    // whole point of routing through `tokenObjectPrefix`.
    expect(bucket.list().some((n) => n.includes(TOKEN_A))).toBe(false);
  });

  it('rejects a create when a session already exists (412 -> typed precondition error)', async () => {
    const { store } = newStore();
    await store.save(TOKEN_A, makeArtifact('v1'), SESSION_GENERATION_ABSENT);
    await expect(store.save(TOKEN_A, makeArtifact('v1-again'), SESSION_GENERATION_ABSENT)).rejects.toBeInstanceOf(
      SessionPreconditionFailedError
    );
  });

  it('carries expected vs actual through a precondition failure', async () => {
    const { store } = newStore();
    const created = await store.save(TOKEN_A, makeArtifact('v1'), SESSION_GENERATION_ABSENT);
    await store.save(TOKEN_A, makeArtifact('v2'), created.generation); // -> 2
    try {
      await store.save(TOKEN_A, makeArtifact('v3-stale'), /* stale */ created.generation);
      fail('expected SessionPreconditionFailedError');
    } catch (e) {
      if (!(e instanceof SessionPreconditionFailedError)) {
        throw e;
      }
      expect(e.code).toBe('PRECONDITION_FAILED');
      expect(e.expected).toBe(created.generation);
      expect(e.actual).toBe(2);
    }
  });

  it('updates generation monotonically', async () => {
    const { store } = newStore();
    let g = (await store.save(TOKEN_A, makeArtifact('v1'), SESSION_GENERATION_ABSENT)).generation;
    expect(g).toBe(1);
    g = (await store.save(TOKEN_A, makeArtifact('v2'), g)).generation;
    expect(g).toBe(2);
    g = (await store.save(TOKEN_A, makeArtifact('v3'), g)).generation;
    expect(g).toBe(3);
    expect((await store.load(TOKEN_A))?.generation).toBe(3);
  });

  it('does NOT remove an existing manifest when later save omits it', async () => {
    // P7 design: an undefined manifest on save is interpreted as "no
    // manifest authored on this call", not "delete the historic manifest".
    const { store } = newStore();
    const created = await store.save(TOKEN_A, makeArtifact('v1', true), SESSION_GENERATION_ABSENT);
    await store.save(TOKEN_A, makeArtifact('v2'), created.generation);
    const loaded = await store.load(TOKEN_A);
    expect(loaded?.artifact.manifest).toEqual({ id: 'fixture', type: 'guide', description: 'v1' });
    expect(loaded?.artifact.content.title).toBe('v2');
  });
});

describe('GcsSessionStore.delete', () => {
  it('removes all objects under the session prefix', async () => {
    const { store, bucket } = newStore();
    await store.save(TOKEN_A, makeArtifact('v1', true), SESSION_GENERATION_ABSENT);
    await store.delete(TOKEN_A);
    expect(bucket.list().filter((n) => n.startsWith(`${PREFIX_A}/`))).toEqual([]);
    expect(await store.load(TOKEN_A)).toBeNull();
  });

  it('is idempotent for unknown tokens', async () => {
    const { store } = newStore();
    await expect(store.delete(TOKEN_A)).resolves.toBeUndefined();
  });

  it('does not affect other sessions', async () => {
    const { store } = newStore();
    await store.save(TOKEN_A, makeArtifact('A1'), SESSION_GENERATION_ABSENT);
    await store.save(TOKEN_B, makeArtifact('B1'), SESSION_GENERATION_ABSENT);
    await store.delete(TOKEN_A);
    expect(await store.load(TOKEN_A)).toBeNull();
    expect((await store.load(TOKEN_B))?.artifact.content.title).toBe('B1');
  });
});

describe('GcsSessionStore Mcp-Session-Id pin (P7 task 16)', () => {
  it('returns null when no pin has ever been bound', async () => {
    const { store } = newStore();
    await store.save(TOKEN_A, makeArtifact('v1'), SESSION_GENERATION_ABSENT);
    expect(await store.readMcpSessionPin(TOKEN_A)).toBeNull();
  });

  it('persists the pin as a sidecar object at <prefix>/.pin', async () => {
    const { store, bucket } = newStore();
    await store.save(TOKEN_A, makeArtifact('v1'), SESSION_GENERATION_ABSENT);
    await store.bindMcpSessionId(TOKEN_A, 'transport-session-A');
    expect(bucket.has(`${PREFIX_A}/.pin`)).toBe(true);
    expect(await store.readMcpSessionPin(TOKEN_A)).toBe('transport-session-A');
  });

  it('delete() removes the pin object along with the rest of the session', async () => {
    const { store } = newStore();
    await store.save(TOKEN_A, makeArtifact('v1'), SESSION_GENERATION_ABSENT);
    await store.bindMcpSessionId(TOKEN_A, 'transport-session-A');
    await store.delete(TOKEN_A);
    expect(await store.readMcpSessionPin(TOKEN_A)).toBeNull();
  });

  it('keeps pins scoped to their token (no leak across sessions)', async () => {
    const { store } = newStore();
    await store.save(TOKEN_A, makeArtifact('A'), SESSION_GENERATION_ABSENT);
    await store.save(TOKEN_B, makeArtifact('B'), SESSION_GENERATION_ABSENT);
    await store.bindMcpSessionId(TOKEN_A, 'session-A');
    expect(await store.readMcpSessionPin(TOKEN_B)).toBeNull();
  });
});

describe('GcsSessionStore 429 rate-limit retry (P7 hardening — gcs429)', () => {
  /**
   * Wrap a FakeBucket so the next N save calls to `objectName` throw
   * a GCS-shaped 429. The (N+1)th call succeeds. Lets us assert the
   * retry-with-backoff helper actually retries — under jest's fake
   * timers so we don't wait wallclock seconds.
   */
  function rateLimitOnce(bucket: FakeBucket, suffix: string, failures: number): void {
    // Stage paths are randomised in production; match by suffix so the
    // test can target "the content.json upload" without knowing the
    // exact stage id. Path collisions across tests aren't a concern
    // because each test gets a fresh FakeBucket.
    const origFile = bucket.file.bind(bucket);
    let remaining = failures;
    bucket.file = (name: string) => {
      const f = origFile(name);
      if (!name.endsWith(suffix)) {
        return f;
      }
      const origSave = f.save.bind(f);
      f.save = async (...args: Parameters<typeof origSave>) => {
        if (remaining > 0) {
          remaining -= 1;
          const err: any = new Error(
            `The object pathfinder-test/${name} exceeded the rate limit for object mutation operations`
          );
          err.code = 429;
          err.errors = [{ reason: 'rateLimitExceeded' }];
          throw err;
        }
        return origSave(...args);
      };
      return f;
    };
  }

  it('retries through a transient 429 on uploadJson and eventually writes', async () => {
    {
      const { store, bucket } = newStore();
      // Two 429s then success — bounded well under the 5-attempt default.
      rateLimitOnce(bucket, '/manifest.json', 2);
      await store.save(TOKEN_A, makeArtifact('v1', /* manifest */ true), SESSION_GENERATION_ABSENT);
      expect(bucket.list().some((n) => n.endsWith('/manifest.json'))).toBe(true);
      expect((await store.load(TOKEN_A))?.artifact.manifest).toBeDefined();
    }
  });

  it('eventually surfaces the 429 after exhausting retries', async () => {
    {
      const { store, bucket } = newStore();
      // 10 forced failures > 5-attempt default → propagates the 429.
      rateLimitOnce(bucket, '/content.json', 10);
      await expect(store.save(TOKEN_A, makeArtifact('v1'), SESSION_GENERATION_ABSENT)).rejects.toMatchObject({
        code: 429,
      });
    }
  });

  it('non-429 errors propagate immediately without retry', async () => {
    const { store, bucket } = newStore();
    const origFile = bucket.file.bind(bucket);
    let saveCalls = 0;
    bucket.file = (name: string) => {
      const f = origFile(name);
      if (name.endsWith('/content.json')) {
        f.save = async () => {
          saveCalls += 1;
          const err: any = new Error('Forbidden');
          err.code = 403;
          throw err;
        };
      }
      return f;
    };
    await expect(store.save(TOKEN_A, makeArtifact('v1'), SESSION_GENERATION_ABSENT)).rejects.toMatchObject({
      code: 403,
    });
    expect(saveCalls).toBe(1);
  });
});

describe('GcsSessionStore concurrency (precondition fan-out)', () => {
  it('only one of two racing creates wins', async () => {
    const { store } = newStore();
    const results = await Promise.allSettled([
      store.save(TOKEN_A, makeArtifact('racer-1'), SESSION_GENERATION_ABSENT),
      store.save(TOKEN_A, makeArtifact('racer-2'), SESSION_GENERATION_ABSENT),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    const failure = rejected[0];
    expect(failure).toBeDefined();
    expect(failure?.reason).toBeInstanceOf(SessionPreconditionFailedError);
  });

  it('only one of two racing updates against the same generation wins', async () => {
    const { store } = newStore();
    const created = await store.save(TOKEN_A, makeArtifact('v1'), SESSION_GENERATION_ABSENT);
    const results = await Promise.allSettled([
      store.save(TOKEN_A, makeArtifact('writer-A'), created.generation),
      store.save(TOKEN_A, makeArtifact('writer-B'), created.generation),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((await store.load(TOKEN_A))?.generation).toBe(2);
  });
});

describe('GcsSessionStore atomicity (BL-01 / BL-02 regression)', () => {
  // BL-01 was: artifact uploads happened in shared paths before the
  // generation pointer flip, so a 412 loser could clobber the winner's
  // content bytes. After the fix, each save has a private stage prefix
  // and the loser's cleanup only touches its own stage.

  it('a 412 loser does NOT clobber the winner content (BL-01)', async () => {
    const { store } = newStore(['seed-stage', 'writer-A-stage', 'writer-B-stage']);
    await store.save(TOKEN_A, makeArtifact('seed'), SESSION_GENERATION_ABSENT);
    // Two writers race against generation 1. Pre-WR-01 layout, the
    // loser's content.json upload would have already clobbered the
    // winner's at this point — the test would assert content !== seed
    // AND match exactly one of the writer titles.
    const results = await Promise.allSettled([
      store.save(TOKEN_A, makeArtifact('writer-A-content'), 1),
      store.save(TOKEN_A, makeArtifact('writer-B-content'), 1),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

    // The winner's content survives intact. Whichever of A or B won,
    // load() returns their content — not a mash, not the seed.
    const loaded = await store.load(TOKEN_A);
    expect(loaded?.generation).toBe(2);
    expect(loaded?.artifact.content.title).toMatch(/^writer-(A|B)-content$/);
    expect(loaded?.artifact.content.title).not.toBe('seed');
  });

  it('a 412 loser cleans up its own stage prefix (BL-01)', async () => {
    const { store, bucket } = newStore(['init', 'winner', 'loser']);
    await store.save(TOKEN_A, makeArtifact('seed'), SESSION_GENERATION_ABSENT);
    // Winner save first (sequential — guarantees the loser is the one
    // that gets the 412 against gen=1).
    await store.save(TOKEN_A, makeArtifact('winner'), 1);
    await expect(store.save(TOKEN_A, makeArtifact('loser'), 1)).rejects.toBeInstanceOf(SessionPreconditionFailedError);
    // The loser's staged dir must not linger in the bucket.
    expect(bucket.list().some((n) => n.startsWith(`${PREFIX_A}/loser/`))).toBe(false);
    // The winner's staged dir is still live (pointer references it).
    expect(bucket.list().some((n) => n.startsWith(`${PREFIX_A}/winner/`))).toBe(true);
  });

  it('load returns the artifact named by the current pointer, not a torn pair (BL-02)', async () => {
    // Even after many sequential writes — each producing a new stage —
    // load must follow the pointer to the live stage. Previous stages
    // are not cleaned up on success (intentional, to avoid racing with
    // in-flight readers), so the bucket holds multiple stages; load
    // must not return any but the live one.
    const { store } = newStore(['s1', 's2', 's3', 's4']);
    await store.save(TOKEN_A, makeArtifact('gen-1'), SESSION_GENERATION_ABSENT);
    await store.save(TOKEN_A, makeArtifact('gen-2'), 1);
    await store.save(TOKEN_A, makeArtifact('gen-3'), 2);
    await store.save(TOKEN_A, makeArtifact('gen-4'), 3);
    const loaded = await store.load(TOKEN_A);
    expect(loaded?.generation).toBe(4);
    expect(loaded?.artifact.content.title).toBe('gen-4');
  });

  it('load throws PRECONDITION_FAILED when the caller stale-saves against an old generation (BL-02 boundary)', async () => {
    const { store } = newStore(['s1', 's2', 's3']);
    await store.save(TOKEN_A, makeArtifact('v1'), SESSION_GENERATION_ABSENT);
    await store.save(TOKEN_A, makeArtifact('v2'), 1);
    // Caller's view is still at gen=1.
    try {
      await store.save(TOKEN_A, makeArtifact('stale'), 1);
      fail('expected SessionPreconditionFailedError');
    } catch (err) {
      if (!(err instanceof SessionPreconditionFailedError)) {
        throw err;
      }
      expect(err.expected).toBe(1);
      expect(err.actual).toBe(2);
    }
  });
});
