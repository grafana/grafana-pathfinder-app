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

const TOKEN_A = 'aaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_B = 'bbbbbbbbbbbbbbbbbbbbbb';

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

  async download(): Promise<[Buffer]> {
    const obj = this.objects.get(this.name);
    if (!obj || obj.body === null) {
      const err: any = new Error('Not Found');
      err.code = 404;
      throw err;
    }
    return [obj.body];
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

function newStore(): { store: GcsSessionStore; bucket: FakeBucket } {
  const storage = new FakeStorage();
  const store = new GcsSessionStore({ bucket: 'test-bucket' }, storage as unknown as GcsStorage);
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

  it('throws on corruption — content exists but generation file is missing', async () => {
    const { store, bucket } = newStore();
    // Directly write only content.json, skipping the generation pin.
    await bucket.file(`${TOKEN_A}/content.json`).save(JSON.stringify({ id: 'x', title: 't', blocks: [] }));
    await expect(store.load(TOKEN_A)).rejects.toThrow(/corruption.*generation.*missing/);
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
    expect(bucket.has(`${TOKEN_A}/content.json`)).toBe(true);
    expect(bucket.has(`${TOKEN_A}/generation`)).toBe(true);
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
    expect(bucket.list().filter((n) => n.startsWith(`${TOKEN_A}/`))).toEqual([]);
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
