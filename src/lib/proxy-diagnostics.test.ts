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
