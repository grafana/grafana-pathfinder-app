/**
 * Process-level `SessionStore` factory. Memoizes one `InMemorySessionStore`
 * so every tool registered against an `McpServer` shares it. Retention is
 * tunable via `PATHFINDER_SESSION_TTL_HOURS` (sliding window, default 24h).
 */

import { InMemorySessionStore, MS_PER_HOUR, type SessionStore } from './session-store';

let cached: SessionStore | null = null;

/** Resolve the optional TTL override (hours) into milliseconds, or undefined for the default. */
function readTtlMs(): number | undefined {
  const raw = (process.env.PATHFINDER_SESSION_TTL_HOURS ?? '').trim();
  if (raw.length === 0) {
    return undefined;
  }
  const hours = Number(raw);
  return Number.isFinite(hours) && hours > 0 ? hours * MS_PER_HOUR : undefined;
}

/**
 * Memoized. Async only to preserve the call sites that `await` it.
 * `options.now` is honored only on the first (cache-miss) construction; tests
 * reset the cache via `__resetSessionStoreFactoryForTests` so each gets a
 * fresh store that respects the injected clock.
 */
export async function getDefaultSessionStore(options: { now?: () => number } = {}): Promise<SessionStore> {
  if (!cached) {
    cached = new InMemorySessionStore({ ttlMs: readTtlMs(), now: options.now });
  }
  return cached;
}

/** Reset the memoized store so each test gets a fresh resolution. */
export function __resetSessionStoreFactoryForTests(): void {
  cached = null;
}
