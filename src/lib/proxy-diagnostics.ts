import type { ProxyDiagnostics } from '../types/guide-diagnostics.types';
export type { ProxyDiagnostics } from '../types/guide-diagnostics.types';
import { httpStatus } from './guide-diagnostics';

const REASONS = new Set([
  'http-error',
  'authorization-denied',
  'identity-unavailable',
  'proxy-unavailable',
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

export function readProxyDiagnostics(value: unknown): ProxyDiagnostics | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const outcome = raw.outcome;
  if (outcome !== 'ok' && outcome !== 'error' && outcome !== 'degraded') {
    return undefined;
  }
  const cache =
    raw.cache === 'hit' || raw.cache === 'shared' || raw.cache === 'refresh' || raw.cache === 'stale'
      ? raw.cache
      : undefined;
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
    stage:
      raw.stage === 'identity' ||
      raw.stage === 'configuration' ||
      raw.stage === 'token-exchange' ||
      raw.stage === 'app-platform'
        ? raw.stage
        : undefined,
    resource:
      raw.resource === 'pathfindersettings' ||
      raw.resource === 'interactiveguides' ||
      raw.resource === 'completionrecords'
        ? raw.resource
        : undefined,
    operation:
      raw.operation === 'get' || raw.operation === 'list' || raw.operation === 'create' ? raw.operation : undefined,
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

export function reportProxyResponse(value: unknown): void {
  if (!value || typeof value !== 'object') {
    return;
  }
  const body = value as { diagnostics?: unknown; capability?: { diagnostics?: unknown } };
  const diagnostic = readProxyDiagnostics(body.diagnostics ?? body.capability?.diagnostics);
  if (!diagnostic || diagnostic.outcome === 'ok' || diagnostic.reason === 'cancelled') {
    return;
  }
  void import('./telemetry/facade')
    .then((telemetry) => telemetry.recordProxyFailure(diagnostic))
    .catch(() => undefined);
}

export function reportProxyFailure(error: unknown): void {
  if (error && typeof error === 'object') {
    reportProxyResponse((error as { data?: unknown }).data);
  }
}
