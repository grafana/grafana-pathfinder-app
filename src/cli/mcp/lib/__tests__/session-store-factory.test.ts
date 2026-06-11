/**
 * @jest-environment node
 *
 * Tests for the default `SessionStore` factory.
 */

import { __resetSessionStoreFactoryForTests, getDefaultSessionStore } from '../session-store-factory';
import { InMemorySessionStore } from '../session-store';

const ENV_KEYS = ['PATHFINDER_SESSION_TTL_HOURS'] as const;
const SAVED: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

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

  it('honours a positive PATHFINDER_SESSION_TTL_HOURS override', async () => {
    process.env.PATHFINDER_SESSION_TTL_HOURS = '1';
    const store = await getDefaultSessionStore();
    expect(store).toBeInstanceOf(InMemorySessionStore);
  });

  it('ignores a non-numeric TTL override (falls back to default)', async () => {
    process.env.PATHFINDER_SESSION_TTL_HOURS = 'not-a-number';
    const store = await getDefaultSessionStore();
    expect(store).toBeInstanceOf(InMemorySessionStore);
  });
});
