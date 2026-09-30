import { readProxyDiagnostics } from './proxy-diagnostics';

it('accepts bounded proxy diagnostics and drops response bodies and arbitrary reason keys', () => {
  const result = readProxyDiagnostics({
    outcome: 'degraded',
    reason: 'private error text',
    upstreamStatus: 503,
    cache: 'hit',
    cacheAgeMs: 250,
    manifestFailures: { 'http-error': 2, 'secret guide': 3, timeout: -1 },
    budgetExhausted: true,
    body: 'credentials',
  });
  expect(result).toEqual({
    outcome: 'degraded',
    reason: undefined,
    upstreamStatus: 503,
    cache: 'hit',
    cacheAgeMs: 250,
    manifestFailures: { 'http-error': 2 },
    budgetExhausted: true,
  });
});

it.each([null, {}, { outcome: 'private' }])('ignores absent or malformed diagnostic envelopes', (value) => {
  expect(readProxyDiagnostics(value)).toBeUndefined();
});

it('bounds incident diagnostic fields and retains the failure stage', () => {
  expect(
    readProxyDiagnostics({
      outcome: 'error',
      stage: 'token-exchange',
      reason: 'token-exchange-failed',
      resource: 'pathfindersettings',
      operation: 'get',
      cache: 'stale',
    })
  ).toMatchObject({
    stage: 'token-exchange',
    reason: 'token-exchange-failed',
    resource: 'pathfindersettings',
    operation: 'get',
    cache: 'stale',
  });
  expect(
    readProxyDiagnostics({
      outcome: 'error',
      stage: 'secret',
      reason: 'secret',
      resource: 'private-guide-name',
      operation: 'secret',
    })
  ).toMatchObject({ stage: undefined, reason: undefined, resource: undefined, operation: undefined });
});
