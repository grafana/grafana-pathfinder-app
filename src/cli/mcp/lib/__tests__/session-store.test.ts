/**
 * @jest-environment node
 *
 * Tests for the SessionStore interface against the in-memory
 * implementation — the only backend. Behavior here is the store contract:
 * generation-checked writes, idempotent delete, Mcp-Session-Id pinning,
 * and sliding-TTL eviction.
 */

import type { ContentJson } from '../../../../types/package.types';
import {
  InMemorySessionStore,
  SESSION_GENERATION_ABSENT,
  SessionPreconditionFailedError,
  type SessionArtifact,
} from '../session-store';

function makeArtifact(title: string): SessionArtifact {
  const content: ContentJson = {
    id: 'fixture-package',
    title,
    blocks: [],
  };
  return { content };
}

const TOKEN_A = 'aaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_B = 'bbbbbbbbbbbbbbbbbbbbbb';

describe('InMemorySessionStore', () => {
  describe('load', () => {
    it('returns null for an unknown token', async () => {
      const store = new InMemorySessionStore();
      expect(await store.load(TOKEN_A)).toBeNull();
    });
  });

  describe('save (create path)', () => {
    it('writes a fresh session at generation 1 when ifGenerationMatch=0', async () => {
      const store = new InMemorySessionStore();
      const result = await store.save(TOKEN_A, makeArtifact('first'), SESSION_GENERATION_ABSENT);
      expect(result.generation).toBe(1);
      const loaded = await store.load(TOKEN_A);
      expect(loaded).not.toBeNull();
      expect(loaded?.generation).toBe(1);
      expect(loaded?.artifact.content.title).toBe('first');
    });

    it('rejects a create when a session already exists', async () => {
      const store = new InMemorySessionStore();
      await store.save(TOKEN_A, makeArtifact('first'), SESSION_GENERATION_ABSENT);
      await expect(store.save(TOKEN_A, makeArtifact('second'), SESSION_GENERATION_ABSENT)).rejects.toBeInstanceOf(
        SessionPreconditionFailedError
      );
    });

    it('surfaces expected vs actual on a create collision', async () => {
      const store = new InMemorySessionStore();
      await store.save(TOKEN_A, makeArtifact('first'), SESSION_GENERATION_ABSENT);
      try {
        await store.save(TOKEN_A, makeArtifact('second'), SESSION_GENERATION_ABSENT);
        fail('expected SessionPreconditionFailedError');
      } catch (e) {
        if (!(e instanceof SessionPreconditionFailedError)) {
          throw e;
        }
        expect(e.code).toBe('PRECONDITION_FAILED');
        expect(e.expected).toBe(0);
        expect(e.actual).toBe(1);
      }
    });
  });

  describe('save (update path)', () => {
    it('updates an existing session when the precondition matches', async () => {
      const store = new InMemorySessionStore();
      const created = await store.save(TOKEN_A, makeArtifact('v1'), SESSION_GENERATION_ABSENT);
      const updated = await store.save(TOKEN_A, makeArtifact('v2'), created.generation);
      expect(updated.generation).toBe(2);
      expect((await store.load(TOKEN_A))?.artifact.content.title).toBe('v2');
    });

    it('rejects an update when the precondition does not match', async () => {
      const store = new InMemorySessionStore();
      const created = await store.save(TOKEN_A, makeArtifact('v1'), SESSION_GENERATION_ABSENT);
      const stale = created.generation;
      await store.save(TOKEN_A, makeArtifact('v2'), stale); // bumps to 2
      await expect(store.save(TOKEN_A, makeArtifact('v3-stale'), stale)).rejects.toBeInstanceOf(
        SessionPreconditionFailedError
      );
    });

    it('does not mutate state on a failed save', async () => {
      const store = new InMemorySessionStore();
      await store.save(TOKEN_A, makeArtifact('v1'), SESSION_GENERATION_ABSENT);
      await expect(store.save(TOKEN_A, makeArtifact('v2'), /* wrong */ 42)).rejects.toBeInstanceOf(
        SessionPreconditionFailedError
      );
      const loaded = await store.load(TOKEN_A);
      expect(loaded?.generation).toBe(1);
      expect(loaded?.artifact.content.title).toBe('v1');
    });
  });

  describe('delete', () => {
    it('removes a session', async () => {
      const store = new InMemorySessionStore();
      await store.save(TOKEN_A, makeArtifact('v1'), SESSION_GENERATION_ABSENT);
      await store.delete(TOKEN_A);
      expect(await store.load(TOKEN_A)).toBeNull();
    });

    it('is idempotent for unknown tokens', async () => {
      const store = new InMemorySessionStore();
      await expect(store.delete(TOKEN_A)).resolves.toBeUndefined();
    });

    it('after delete, create-with-precondition-0 succeeds again', async () => {
      const store = new InMemorySessionStore();
      await store.save(TOKEN_A, makeArtifact('v1'), SESSION_GENERATION_ABSENT);
      await store.delete(TOKEN_A);
      const recreated = await store.save(TOKEN_A, makeArtifact('reborn'), SESSION_GENERATION_ABSENT);
      expect(recreated.generation).toBe(1);
    });
  });

  describe('isolation', () => {
    it('keeps distinct tokens independent', async () => {
      const store = new InMemorySessionStore();
      await store.save(TOKEN_A, makeArtifact('A1'), SESSION_GENERATION_ABSENT);
      await store.save(TOKEN_B, makeArtifact('B1'), SESSION_GENERATION_ABSENT);
      expect((await store.load(TOKEN_A))?.artifact.content.title).toBe('A1');
      expect((await store.load(TOKEN_B))?.artifact.content.title).toBe('B1');
    });
  });

  describe('concurrency', () => {
    it('only one of two racing creates wins, the other gets PRECONDITION_FAILED', async () => {
      const store = new InMemorySessionStore();
      const results = await Promise.allSettled([
        store.save(TOKEN_A, makeArtifact('racer-1'), SESSION_GENERATION_ABSENT),
        store.save(TOKEN_A, makeArtifact('racer-2'), SESSION_GENERATION_ABSENT),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const failure = rejected[0] as PromiseRejectedResult;
      expect(failure.reason).toBeInstanceOf(SessionPreconditionFailedError);
    });

    it('only one of two racing updates against the same generation wins', async () => {
      const store = new InMemorySessionStore();
      const created = await store.save(TOKEN_A, makeArtifact('v1'), SESSION_GENERATION_ABSENT);
      const results = await Promise.allSettled([
        store.save(TOKEN_A, makeArtifact('writer-A'), created.generation),
        store.save(TOKEN_A, makeArtifact('writer-B'), created.generation),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      const loaded = await store.load(TOKEN_A);
      expect(loaded?.generation).toBe(2);
    });
  });

  describe('TTL / expiry', () => {
    it('evicts a session once it is idle past the TTL', async () => {
      let now = 1_000;
      const store = new InMemorySessionStore({ ttlMs: 100, now: () => now });
      await store.save(TOKEN_A, makeArtifact('v1'), SESSION_GENERATION_ABSENT);
      now += 101;
      expect(await store.load(TOKEN_A)).toBeNull();
      expect(store.size()).toBe(0);
    });

    it('slides the window forward on each access', async () => {
      let now = 1_000;
      const store = new InMemorySessionStore({ ttlMs: 100, now: () => now });
      await store.save(TOKEN_A, makeArtifact('v1'), SESSION_GENERATION_ABSENT);
      now += 60; // within window — load refreshes expiry
      expect(await store.load(TOKEN_A)).not.toBeNull();
      now += 60; // 120ms since create, only 60ms since last access — still live
      expect(await store.load(TOKEN_A)).not.toBeNull();
    });

    it('sweeps other expired sessions on save', async () => {
      let now = 1_000;
      const store = new InMemorySessionStore({ ttlMs: 100, now: () => now });
      await store.save(TOKEN_A, makeArtifact('a'), SESSION_GENERATION_ABSENT);
      now += 101; // TOKEN_A now past its window
      await store.save(TOKEN_B, makeArtifact('b'), SESSION_GENERATION_ABSENT);
      expect(store.size()).toBe(1);
      expect(await store.load(TOKEN_A)).toBeNull();
    });

    it('drops the Mcp-Session-Id pin when the session expires', async () => {
      let now = 1_000;
      const store = new InMemorySessionStore({ ttlMs: 100, now: () => now });
      await store.save(TOKEN_A, makeArtifact('a'), SESSION_GENERATION_ABSENT);
      await store.bindMcpSessionId(TOKEN_A, 'mcp-session-1');
      now += 101;
      await store.load(TOKEN_A); // eviction also clears the pin
      expect(await store.readMcpSessionPin(TOKEN_A)).toBeNull();
    });
  });
});
