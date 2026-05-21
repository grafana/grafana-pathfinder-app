/**
 * @jest-environment node
 *
 * Tests for `dispatchSessionMutation` — the P7 concurrency-control
 * dispatcher used by session-mode mutation tools.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ContentJson } from '../../../types/package.types';
import {
  InMemorySessionStore,
  SESSION_GENERATION_ABSENT,
  SessionStoreUnavailableError,
  type LoadedSession,
  type SessionStore,
} from '../lib/session-store';
import {
  dispatchSessionMutation,
  isConcurrentModification,
  isSessionHopLimit,
  isSessionNotFound,
  isSessionTooLarge,
  isStoreUnavailable,
  __resetSessionSaveCounts,
  type DispatchSessionResult,
  type SessionOutcome,
} from '../tools/state-bridge';
import type { CommandOutcome } from '../../utils/output';

const TOKEN = 'aaaaaaaaaaaaaaaaaaaaaa';

function seed(title: string): { content: ContentJson } {
  return { content: { id: 'session-fixture', title, blocks: [] } };
}

function setTitleRunner(newTitle: string): (dir: string) => CommandOutcome {
  return (dir: string) => {
    const contentPath = path.join(dir, 'content.json');
    const existing = JSON.parse(fs.readFileSync(contentPath, 'utf8')) as ContentJson;
    existing.title = newTitle;
    fs.writeFileSync(contentPath, JSON.stringify(existing));
    return { status: 'ok', summary: `set title to ${newTitle}` };
  };
}

function failingRunner(): (dir: string) => CommandOutcome {
  return () => ({ status: 'error', code: 'FAKE_ERROR', message: 'simulated failure' });
}

/**
 * Wraps a store and bumps its generation OUT OF BAND once, right before
 * the next save call. Simulates a concurrent writer landing between the
 * dispatcher's load and save.
 */
function makeRacingStore(real: SessionStore): SessionStore {
  let armed = true;
  return {
    load: (token) => real.load(token),
    save: async (token, artifact, ifGen) => {
      if (armed) {
        armed = false;
        const current = await real.load(token);
        if (current) {
          // Mutate via a different artifact so we can tell which write won.
          await real.save(
            token,
            { ...current.artifact, content: { ...current.artifact.content, title: 'RACED' } },
            current.generation
          );
        }
      }
      return real.save(token, artifact, ifGen);
    },
    delete: (token) => real.delete(token),
    bindMcpSessionId: (t, id) => real.bindMcpSessionId(t, id),
    readMcpSessionPin: (t) => real.readMcpSessionPin(t),
  };
}

/**
 * Narrow a dispatcher result to the success branch (SessionOutcome).
 * The dispatcher's return union widened with the H-1 quota guards, so
 * tests assert the no-quota-tripped happy path through this helper
 * rather than open-coding the narrowing in every case.
 */
function expectOutcome(r: DispatchSessionResult): SessionOutcome {
  if (
    isSessionNotFound(r) ||
    isConcurrentModification(r) ||
    isSessionTooLarge(r) ||
    isSessionHopLimit(r) ||
    isStoreUnavailable(r)
  ) {
    throw new Error(`expected SessionOutcome, got ${r.code}`);
  }
  return r;
}

beforeEach(() => {
  __resetSessionSaveCounts();
});

describe('dispatchSessionMutation', () => {
  describe('without expectedGeneration (default retry-once)', () => {
    it('returns SESSION_NOT_FOUND when the token is unknown', async () => {
      const store = new InMemorySessionStore();
      const r = await dispatchSessionMutation(TOKEN, store, setTitleRunner('x'));
      expect(isSessionNotFound(r)).toBe(true);
    });

    it('runs the mutation and saves on success', async () => {
      const store = new InMemorySessionStore();
      await store.save(TOKEN, seed('v1'), SESSION_GENERATION_ABSENT);
      const r = await dispatchSessionMutation(TOKEN, store, setTitleRunner('v2'));
      const success = expectOutcome(r);
      expect(success.outcome.status).toBe('ok');
      expect(success.generation).toBe(2);
      expect((await store.load(TOKEN))?.artifact.content.title).toBe('v2');
    });

    it('does NOT write on runner failure', async () => {
      const store = new InMemorySessionStore();
      await store.save(TOKEN, seed('v1'), SESSION_GENERATION_ABSENT);
      const r = await dispatchSessionMutation(TOKEN, store, failingRunner());
      const success = expectOutcome(r);
      expect(success.outcome.status).toBe('error');
      expect(success.generation).toBeUndefined();
      expect((await store.load(TOKEN))?.generation).toBe(1);
    });

    it('retries once on 412 and succeeds against the refetched state', async () => {
      const inner = new InMemorySessionStore();
      await inner.save(TOKEN, seed('v1'), SESSION_GENERATION_ABSENT);
      const racing = makeRacingStore(inner);
      const r = await dispatchSessionMutation(TOKEN, racing, setTitleRunner('after-retry'));
      const success = expectOutcome(r);
      expect(success.outcome.status).toBe('ok');
      // Generation should be 3: original (1) -> racing writer (2) -> our retry (3).
      expect(success.generation).toBe(3);
      expect((await inner.load(TOKEN))?.artifact.content.title).toBe('after-retry');
    });

    it('surfaces CONCURRENT_MODIFICATION when the retry also 412s', async () => {
      const inner = new InMemorySessionStore();
      await inner.save(TOKEN, seed('v1'), SESSION_GENERATION_ABSENT);

      // Build a store that bumps the generation on EVERY save attempt
      // before the real write — so both the first try and the retry fail.
      const persistentlyRacing: SessionStore = {
        load: (t) => inner.load(t),
        save: async (t, art, ifGen) => {
          const current = await inner.load(t);
          if (current) {
            await inner.save(
              t,
              { ...current.artifact, content: { ...current.artifact.content, title: 'RACED' } },
              current.generation
            );
          }
          return inner.save(t, art, ifGen);
        },
        delete: (t) => inner.delete(t),
        bindMcpSessionId: (t, id) => inner.bindMcpSessionId(t, id),
        readMcpSessionPin: (t) => inner.readMcpSessionPin(t),
      };

      const r = await dispatchSessionMutation(TOKEN, persistentlyRacing, setTitleRunner('never-lands'));
      expect(isConcurrentModification(r)).toBe(true);
    });

    it('returns SESSION_NOT_FOUND when the session is deleted between save attempts', async () => {
      const inner = new InMemorySessionStore();
      await inner.save(TOKEN, seed('v1'), SESSION_GENERATION_ABSENT);

      const racingThenDeleting: SessionStore = {
        load: (t) => inner.load(t),
        save: async (t, art, ifGen) => {
          // First save: bump generation under us, then delete after the
          // 412 propagates so the retry's load returns null.
          const current = await inner.load(t);
          if (current) {
            await inner.save(t, current.artifact, current.generation);
            queueMicrotask(() => {
              void inner.delete(t);
            });
          }
          return inner.save(t, art, ifGen);
        },
        delete: (t) => inner.delete(t),
        bindMcpSessionId: (t, id) => inner.bindMcpSessionId(t, id),
        readMcpSessionPin: (t) => inner.readMcpSessionPin(t),
      };

      const r = await dispatchSessionMutation(TOKEN, racingThenDeleting, setTitleRunner('x'));
      // Either NOT_FOUND (deletion landed before retry-load) or
      // CONCURRENT_MODIFICATION (retry's load won the race) is acceptable.
      // We assert one of the two terminal outcomes — never a success.
      expect(isSessionNotFound(r) || isConcurrentModification(r)).toBe(true);
    });
  });

  describe('with explicit expectedGeneration', () => {
    it('surfaces CONCURRENT_MODIFICATION when the loaded generation already differs', async () => {
      const store = new InMemorySessionStore();
      await store.save(TOKEN, seed('v1'), SESSION_GENERATION_ABSENT); // gen=1
      await store.save(TOKEN, seed('v2'), 1); // gen=2

      const r = await dispatchSessionMutation(TOKEN, store, setTitleRunner('shouldnt-land'), { expectedGeneration: 1 });
      if (!isConcurrentModification(r)) {
        throw new Error('expected CONCURRENT_MODIFICATION');
      }
      expect(r.expected).toBe(1);
      expect(r.actual).toBe(2);
      // Store untouched.
      expect((await store.load(TOKEN))?.artifact.content.title).toBe('v2');
      expect((await store.load(TOKEN))?.generation).toBe(2);
    });

    it('proceeds when expectedGeneration matches', async () => {
      const store = new InMemorySessionStore();
      await store.save(TOKEN, seed('v1'), SESSION_GENERATION_ABSENT);
      const r = await dispatchSessionMutation(TOKEN, store, setTitleRunner('v2'), {
        expectedGeneration: 1,
      });
      const success = expectOutcome(r);
      expect(success.outcome.status).toBe('ok');
      expect(success.generation).toBe(2);
    });

    it('does NOT retry when a save-time 412 surfaces — surfaces immediately', async () => {
      // With an explicit expectedGeneration the dispatcher should treat
      // a save-time 412 as a real concurrent-mod, not an opportunity to
      // retry. We simulate this by racing the save once.
      const inner = new InMemorySessionStore();
      await inner.save(TOKEN, seed('v1'), SESSION_GENERATION_ABSENT);
      const racing = makeRacingStore(inner);

      const r = await dispatchSessionMutation(TOKEN, racing, setTitleRunner('shouldnt-land'), {
        expectedGeneration: 1,
      });
      expect(isConcurrentModification(r)).toBe(true);
      // The racing writer landed; our mutation did not. Title remains
      // whatever the racing writer set.
      expect((await inner.load(TOKEN))?.artifact.content.title).toBe('RACED');
    });
  });

  describe('store-unavailable mapping', () => {
    // The storage layer normalizes raw GCS errors into
    // `SessionStoreUnavailableError`. The dispatcher must map that into a
    // structured `SESSION_STORE_UNAVAILABLE` result so the tool layer can
    // emit a well-formed CommandOutcome instead of letting the throw
    // crash through to the HTTP transport as a non-JSON 500.

    function unavailableOnSave(real: SessionStore, reason: 'rate_limited' | 'transient'): SessionStore {
      return {
        load: (t) => real.load(t),
        save: async () => {
          throw new SessionStoreUnavailableError(reason, `simulated ${reason}`);
        },
        delete: (t) => real.delete(t),
        bindMcpSessionId: (t, id) => real.bindMcpSessionId(t, id),
        readMcpSessionPin: (t) => real.readMcpSessionPin(t),
      };
    }

    function unavailableOnLoad(reason: 'rate_limited' | 'transient'): SessionStore {
      return {
        load: async (): Promise<LoadedSession | null> => {
          throw new SessionStoreUnavailableError(reason, `simulated ${reason}`);
        },
        save: async () => {
          throw new Error('save should not be reached');
        },
        delete: async () => undefined,
        bindMcpSessionId: async () => undefined,
        readMcpSessionPin: async () => null,
      };
    }

    it('maps a save-time SessionStoreUnavailableError to SESSION_STORE_UNAVAILABLE', async () => {
      const inner = new InMemorySessionStore();
      await inner.save(TOKEN, seed('v1'), SESSION_GENERATION_ABSENT);
      const store = unavailableOnSave(inner, 'rate_limited');

      const r = await dispatchSessionMutation(TOKEN, store, setTitleRunner('v2'));
      if (!isStoreUnavailable(r)) {
        throw new Error(`expected SESSION_STORE_UNAVAILABLE, got ${(r as { code?: string }).code}`);
      }
      expect(r.reason).toBe('rate_limited');
      expect(r.message).toContain('rate_limited');
    });

    it('maps a load-time SessionStoreUnavailableError to SESSION_STORE_UNAVAILABLE', async () => {
      const store = unavailableOnLoad('transient');
      const r = await dispatchSessionMutation(TOKEN, store, setTitleRunner('v2'));
      if (!isStoreUnavailable(r)) {
        throw new Error(`expected SESSION_STORE_UNAVAILABLE, got ${(r as { code?: string }).code}`);
      }
      expect(r.reason).toBe('transient');
    });
  });
});
