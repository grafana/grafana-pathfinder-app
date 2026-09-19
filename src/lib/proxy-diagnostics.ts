import { httpStatus } from './guide-diagnostics';

const REASONS = new Set([
  'http-error',
  'timeout',
  'cancelled',
  'token-exchange-failed',
  'invalid-json',
  'network-error',
  'unexpected-error',
  'response-too-large',
  'invalid-url',
  'blocked-url',
  'offline',
  'malformed-response',
]);

export interface ProxyDiagnostics {
  outcome: 'ok' | 'error' | 'degraded';
  reason?: string;
  upstreamStatus?: number;
  cache?: 'hit' | 'shared' | 'refresh';
  cacheAgeMs?: number;
  manifestFailures?: Record<string, number>;
  budgetExhausted?: boolean;
}

export function readProxyDiagnostics(value: unknown): ProxyDiagnostics | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const outcome = raw.outcome;
  if (outcome !== 'ok' && outcome !== 'error' && outcome !== 'degraded') {
    return undefined;
  }
  const cache = raw.cache === 'hit' || raw.cache === 'shared' || raw.cache === 'refresh' ? raw.cache : undefined;
  const manifestFailures: Record<string, number> = {};
  if (raw.manifestFailures && typeof raw.manifestFailures === 'object') {
    for (const [reason, count] of Object.entries(raw.manifestFailures)) {
      if (REASONS.has(reason) && typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) {
        manifestFailures[reason] = count;
      }
    }
  }
  return {
    outcome,
    cache,
    reason: typeof raw.reason === 'string' && REASONS.has(raw.reason) ? raw.reason : undefined,
    upstreamStatus: httpStatus({ status: raw.upstreamStatus }),
    cacheAgeMs:
      typeof raw.cacheAgeMs === 'number' && Number.isSafeInteger(raw.cacheAgeMs) && raw.cacheAgeMs >= 0
        ? raw.cacheAgeMs
        : undefined,
    manifestFailures,
    budgetExhausted: raw.budgetExhausted === true,
  };
}
