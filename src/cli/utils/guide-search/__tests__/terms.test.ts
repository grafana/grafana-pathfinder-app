import { normalizeTerms, stem } from '../terms';

describe('normalizeTerms', () => {
  it('lowercases, splits on non-alphanumerics, and drops stopwords and duplicates', () => {
    expect(normalizeTerms('How do I set up Alerts for my alerts?')).toEqual(['alert']);
  });

  it('splits hyphenated ids into terms', () => {
    expect(normalizeTerms('postgresql-integration-lj')).toEqual(['postgresql', 'integration', 'lj']);
  });

  it('returns nothing for stopword-only text', () => {
    expect(normalizeTerms('how do I get help with grafana')).toEqual([]);
  });
});

describe('stem', () => {
  it.each([
    ['alerts', 'alert'],
    ['alerting', 'alert'],
    ['alerted', 'alert'],
    ['queries', 'query'],
    ['logging', 'log'],
    ['installing', 'install'],
    ['configure', 'configur'],
    ['configured', 'configur'],
    ['configuring', 'configur'],
    ['dashboards', 'dashboard'],
    ['status', 'status'],
    ['access', 'access'],
    ['k8s', 'k8s'],
    ['slo', 'slo'],
  ])('%s -> %s', (token, expected) => {
    expect(stem(token)).toBe(expected);
  });
});
