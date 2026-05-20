/**
 * Process-level default `SessionStore` factory.
 *
 * `buildServer` and direct test callers acquire a store via
 * `getDefaultSessionStore()`. The factory reads two environment variables:
 *
 *   - `PATHFINDER_SESSION_STORE`   `memory` | `gcs`   (default: `memory`)
 *   - `PATHFINDER_SESSION_BUCKET`  GCS bucket name    (required when `=gcs`)
 *
 * The deployed Cloud Run service sets both via `scripts/deploy-mcp.sh`.
 * Local dev (CLI / stdio MCP / tests) gets the in-memory store by default.
 *
 * The factory is memoized: a second call returns the same store instance,
 * so the in-memory backend is shared across all tools registered against
 * one `McpServer`. Tests that need isolation can pass a fresh store
 * directly to `buildServer({ sessionStore })` and the factory is not
 * consulted.
 */

import { GcsSessionStore } from './session-store-gcs';
import { InMemorySessionStore, type SessionStore } from './session-store';

let cached: { store: SessionStore } | null = null;
let pending: Promise<SessionStore> | null = null;

export interface SessionStoreFactoryOverrides {
  /** Override the env var value (used in tests). */
  storeMode?: 'memory' | 'gcs';
  /** Override the env var value (used in tests). */
  bucket?: string;
}

function readMode(overrides?: SessionStoreFactoryOverrides): 'memory' | 'gcs' {
  const fromOverride = overrides?.storeMode;
  if (fromOverride) {
    return fromOverride;
  }
  const raw = (process.env.PATHFINDER_SESSION_STORE ?? '').trim().toLowerCase();
  if (raw === 'gcs') {
    return 'gcs';
  }
  return 'memory';
}

function readBucket(overrides?: SessionStoreFactoryOverrides): string | undefined {
  if (overrides?.bucket !== undefined) {
    return overrides.bucket;
  }
  const raw = (process.env.PATHFINDER_SESSION_BUCKET ?? '').trim();
  return raw.length > 0 ? raw : undefined;
}

/**
 * Resolve the default `SessionStore`. Memoized. Repeated calls return the
 * same instance regardless of subsequent env changes — env is captured on
 * first call by design so two callers in the same process can't accidentally
 * land in different backends mid-run.
 */
export async function getDefaultSessionStore(overrides?: SessionStoreFactoryOverrides): Promise<SessionStore> {
  if (cached) {
    return cached.store;
  }
  if (pending) {
    return pending;
  }
  pending = (async () => {
    const mode = readMode(overrides);
    if (mode === 'memory') {
      const store = new InMemorySessionStore();
      cached = { store };
      return store;
    }
    const bucket = readBucket(overrides);
    if (!bucket) {
      throw new Error('PATHFINDER_SESSION_STORE=gcs requires PATHFINDER_SESSION_BUCKET to be set to the bucket name');
    }
    const store = await GcsSessionStore.create({ bucket });
    cached = { store };
    return store;
  })();
  try {
    return await pending;
  } finally {
    pending = null;
  }
}

/**
 * Reset the memoized factory. Tests that exercise the env-driven branch
 * call this between cases so each scenario gets a fresh resolution.
 */
export function __resetSessionStoreFactoryForTests(): void {
  cached = null;
  pending = null;
}
