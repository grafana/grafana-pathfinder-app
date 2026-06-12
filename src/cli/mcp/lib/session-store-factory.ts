/**
 * Process-level session-store factory. Memoizes one `InMemorySessionStore`
 * so every tool registered against an `McpServer` shares it. Retention is
 * tunable via `PATHFINDER_SESSION_TTL_HOURS` (sliding window, default 24h).
 *
 * No construction options are exposed: the store is a process singleton, so a
 * per-call option (e.g. a clock) would silently apply only to the first
 * caller. Tests that need a controllable clock construct `InMemorySessionStore`
 * directly; the env→ms parsing is unit-tested via `readTtlMs`.
 */

import { InMemorySessionStore, MS_PER_HOUR, type AuthoringSessionStore } from './session-store';

let cached: AuthoringSessionStore | null = null;

/** Resolve the optional `PATHFINDER_SESSION_TTL_HOURS` override into ms, or `undefined` for the default. */
export function readTtlMs(): number | undefined {
  const raw = (process.env.PATHFINDER_SESSION_TTL_HOURS ?? '').trim();
  if (raw.length === 0) {
    return undefined;
  }
  const hours = Number(raw);
  return Number.isFinite(hours) && hours > 0 ? hours * MS_PER_HOUR : undefined;
}

/** Memoized process singleton. Async only to preserve the call sites that `await` it. */
export async function getDefaultSessionStore(): Promise<AuthoringSessionStore> {
  if (!cached) {
    cached = new InMemorySessionStore({ ttlMs: readTtlMs() });
  }
  return cached;
}

/** Reset the memoized store so each test gets a fresh resolution. */
export function __resetSessionStoreFactoryForTests(): void {
  cached = null;
}
