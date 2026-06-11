/**
 * Process-level `SessionStore` factory. Memoizes one `InMemorySessionStore`
 * so every tool registered against an `McpServer` shares it. Retention is
 * tunable via `PATHFINDER_SESSION_TTL_HOURS` (sliding window, default 24h).
 */

import { InMemorySessionStore, type SessionStore } from './session-store';

let cached: SessionStore | null = null;

/** Resolve the optional TTL override (hours) into milliseconds, or undefined for the default. */
function readTtlMs(): number | undefined {
  const raw = (process.env.PATHFINDER_SESSION_TTL_HOURS ?? '').trim();
  if (raw.length === 0) {
    return undefined;
  }
  const hours = Number(raw);
  return Number.isFinite(hours) && hours > 0 ? hours * 60 * 60 * 1000 : undefined;
}

/** Memoized. Async only to preserve the call sites that `await` it. */
export async function getDefaultSessionStore(): Promise<SessionStore> {
  if (!cached) {
    cached = new InMemorySessionStore({ ttlMs: readTtlMs() });
  }
  return cached;
}

/** Reset the memoized store so each test gets a fresh resolution. */
export function __resetSessionStoreFactoryForTests(): void {
  cached = null;
}
