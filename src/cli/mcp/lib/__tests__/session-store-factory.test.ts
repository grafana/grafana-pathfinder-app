/**
 * @jest-environment node
 *
 * Tests for the default `SessionStore` factory — including that
 * PATHFINDER_SESSION_TTL_HOURS is actually wired into the store's
 * eviction window, not just parsed.
 */

import { __resetSessionStoreFactoryForTests, getDefaultSessionStore } from '../session-store-factory';
import { InMemorySessionStore, SESSION_GENERATION_ABSENT, type SessionArtifact } from '../session-store';

const ENV_KEYS = ['PATHFINDER_SESSION_TTL_HOURS'] as const;
const SAVED: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

const TOKEN = 'aaaaaaaaaaaaaaaaaaaaaa';
const ARTIFACT: SessionArtifact = { content: { id: 'fixture', title: 'fixture', blocks: [] } };
const HOUR_MS = 60 * 60 * 1000;

beforeEach(() => {
  for (const k of ENV_KEYS) {
    SAVED[k] = process.env[k];
    delete process.env[k];
  }
  __resetSessionStoreFactoryForTests();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (SAVED[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = SAVED[k];
    }
  }
  __resetSessionStoreFactoryForTests();
  jest.restoreAllMocks();
});

describe('getDefaultSessionStore', () => {
  it('returns an in-memory store', async () => {
    const store = await getDefaultSessionStore();
    expect(store).toBeInstanceOf(InMemorySessionStore);
  });

  it('returns the same instance on repeated calls (memoized)', async () => {
    const a = await getDefaultSessionStore();
    const b = await getDefaultSessionStore();
    expect(a).toBe(b);
  });

  it('applies PATHFINDER_SESSION_TTL_HOURS to the eviction window', async () => {
    let nowMs = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
    process.env.PATHFINDER_SESSION_TTL_HOURS = '1';

    const store = await getDefaultSessionStore();
    await store.save(TOKEN, ARTIFACT, SESSION_GENERATION_ABSENT);

    nowMs += HOUR_MS + 60_000; // past the configured 1h window (and far short of the 24h default)
    expect(await store.load(TOKEN)).toBeNull();
  });

  it('falls back to the 24h default when the override is absent', async () => {
    let nowMs = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => nowMs);

    const store = await getDefaultSessionStore();
    await store.save(TOKEN, ARTIFACT, SESSION_GENERATION_ABSENT);

    nowMs += 2 * HOUR_MS; // past a 1h window but within the 24h default — still live
    expect(await store.load(TOKEN)).not.toBeNull();
  });

  it('ignores a non-numeric override and uses the default', async () => {
    let nowMs = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
    process.env.PATHFINDER_SESSION_TTL_HOURS = 'not-a-number';

    const store = await getDefaultSessionStore();
    await store.save(TOKEN, ARTIFACT, SESSION_GENERATION_ABSENT);

    nowMs += 2 * HOUR_MS; // a bogus override must not evict early — the 24h default applies
    expect(await store.load(TOKEN)).not.toBeNull();
  });
});
