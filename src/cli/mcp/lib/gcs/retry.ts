/**
 * Retry-on-429 policy for GCS operations.
 *
 * Exponential backoff with full jitter. Cap chosen so the worst case stays
 * well under the 30s per-call wallclock budget in `transports/http.ts`.
 * Non-429 errors propagate immediately so precondition-failed, not-found,
 * and auth errors still surface fast.
 *
 * Exhausted retries surface as `SessionStoreUnavailableError(reason: 'rate_limited')`
 * so the dispatch layer can map to a structured CommandOutcome — the raw GCS
 * error string never reaches the wire.
 */

import { SessionStoreUnavailableError } from '../session-store';
import { isRateLimitedError } from './errors';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export async function withRetryOn429<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const baseDelayMs = opts.baseDelayMs ?? 1100;
  const maxDelayMs = opts.maxDelayMs ?? 8000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimitedError(err)) {
        throw err;
      }
      lastErr = err;
      if (attempt === maxAttempts - 1) {
        break;
      }
      // Exponential backoff with full jitter: random in [baseDelay, min(max, base * 2^attempt)].
      const exp = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
      const wait = baseDelayMs + Math.random() * (exp - baseDelayMs);
      await sleep(wait);
    }
  }
  throw new SessionStoreUnavailableError(
    'rate_limited',
    'session storage temporarily rate-limited; retry the request',
    { cause: lastErr }
  );
}
