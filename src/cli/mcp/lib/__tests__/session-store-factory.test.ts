/**
 * @jest-environment node
 *
 * Tests for the default session-store factory. Clock-driven eviction is
 * covered at the store level (session-store.test.ts); here we cover the
 * factory's memoization and the env→ms parsing (`readTtlMs`) in isolation —
 * no factory clock seam, no global `Date` mock.
 */

import { __resetSessionStoreFactoryForTests, getDefaultSessionStore, readTtlMs } from '../session-store-factory';
import { InMemorySessionStore, MS_PER_HOUR } from '../session-store';

const ENV_KEY = 'PATHFINDER_SESSION_TTL_HOURS';
let saved: string | undefined;

beforeEach(() => {
  saved = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
  __resetSessionStoreFactoryForTests();
});

afterEach(() => {
  if (saved === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = saved;
  }
  __resetSessionStoreFactoryForTests();
});

describe('getDefaultSessionStore', () => {
  it('returns an in-memory store', async () => {
    expect(await getDefaultSessionStore()).toBeInstanceOf(InMemorySessionStore);
  });

  it('returns the same instance on repeated calls (memoized)', async () => {
    const a = await getDefaultSessionStore();
    const b = await getDefaultSessionStore();
    expect(a).toBe(b);
  });
});

describe('readTtlMs', () => {
  it('returns undefined when the env var is unset (store uses its default)', () => {
    expect(readTtlMs()).toBeUndefined();
  });

  it('parses a positive hour count into milliseconds', () => {
    process.env[ENV_KEY] = '1';
    expect(readTtlMs()).toBe(MS_PER_HOUR);
    process.env[ENV_KEY] = '48';
    expect(readTtlMs()).toBe(48 * MS_PER_HOUR);
  });

  it('returns undefined for non-numeric, zero, or negative values (falls back to default)', () => {
    for (const bad of ['not-a-number', '0', '-3', '   ']) {
      process.env[ENV_KEY] = bad;
      expect(readTtlMs()).toBeUndefined();
    }
  });
});
