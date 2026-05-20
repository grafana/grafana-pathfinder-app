/**
 * @jest-environment node
 *
 * Tests for the env-driven `SessionStore` factory.
 */

import { __resetSessionStoreFactoryForTests, getDefaultSessionStore } from '../session-store-factory';
import { InMemorySessionStore } from '../session-store';
import { GcsSessionStore } from '../session-store-gcs';

const ENV_KEYS = ['PATHFINDER_SESSION_STORE', 'PATHFINDER_SESSION_BUCKET'] as const;
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
  it('returns an in-memory store by default', async () => {
    const store = await getDefaultSessionStore();
    expect(store).toBeInstanceOf(InMemorySessionStore);
  });

  it('returns an in-memory store when PATHFINDER_SESSION_STORE=memory', async () => {
    process.env.PATHFINDER_SESSION_STORE = 'memory';
    const store = await getDefaultSessionStore();
    expect(store).toBeInstanceOf(InMemorySessionStore);
  });

  it('returns the same instance on repeated calls (memoized)', async () => {
    const a = await getDefaultSessionStore();
    const b = await getDefaultSessionStore();
    expect(a).toBe(b);
  });

  it('throws when PATHFINDER_SESSION_STORE=gcs but PATHFINDER_SESSION_BUCKET is unset', async () => {
    process.env.PATHFINDER_SESSION_STORE = 'gcs';
    await expect(getDefaultSessionStore()).rejects.toThrow(/PATHFINDER_SESSION_BUCKET/);
  });

  it('builds a GcsSessionStore when both env vars are set (override path avoids real auth)', async () => {
    // We exercise the gcs branch through the overrides hook to avoid loading
    // application default credentials in a unit test.
    process.env.PATHFINDER_SESSION_STORE = 'gcs';
    process.env.PATHFINDER_SESSION_BUCKET = 'test-bucket';
    const store = await getDefaultSessionStore();
    expect(store).toBeInstanceOf(GcsSessionStore);
  });

  it('honors the overrides argument over env vars', async () => {
    process.env.PATHFINDER_SESSION_STORE = 'memory';
    const store = await getDefaultSessionStore({ storeMode: 'gcs', bucket: 'test-bucket' });
    expect(store).toBeInstanceOf(GcsSessionStore);
  });
});
