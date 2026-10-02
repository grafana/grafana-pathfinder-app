/**
 * @jest-environment node
 */

import { compileBoundedRegex, MAX_URL_REGEX_LENGTH, MAX_URL_REGEX_TIMEOUTS, testBoundedRegex } from '../bounded-regex';
import { compileTargeting, isAvailableOnPlatform, normalizePageUrl, pageMatchLength } from '../targeting';

function compile(match: unknown) {
  const node = compileTargeting(match);
  if (!node) {
    throw new Error('expected a targeting tree');
  }
  return node;
}

describe('pageMatchLength', () => {
  const adaptiveLogs = compile({
    or: [
      { and: [{ urlPrefix: '/a/grafana-adaptivelogs-app' }, { targetPlatform: 'cloud' }] },
      {
        and: [
          { targetPlatform: 'cloud' },
          { urlPrefixIn: ['/adaptive-telemetry', '/a/grafana-costmanagementui-app/logs'] },
        ],
      },
    ],
  });

  it('matches urlPrefix and urlPrefixIn, reporting the most specific prefix', () => {
    expect(pageMatchLength(adaptiveLogs, '/a/grafana-adaptivelogs-app/overview')).toBe(
      '/a/grafana-adaptivelogs-app'.length
    );
    expect(pageMatchLength(adaptiveLogs, '/adaptive-telemetry')).toBe('/adaptive-telemetry'.length);
    expect(pageMatchLength(adaptiveLogs, '/explore')).toBe(-1);
  });

  it('honours targetPlatform only when a platform is given', () => {
    expect(pageMatchLength(adaptiveLogs, '/adaptive-telemetry', 'oss')).toBe(-1);
    expect(pageMatchLength(adaptiveLogs, '/adaptive-telemetry', 'cloud')).toBeGreaterThan(0);
  });

  it('treats tag, source, and userRole leaves as satisfied', () => {
    const node = compile({ and: [{ urlPrefix: '/connections/datasources' }, { tag: 'selected-datasource:mysql' }] });
    expect(pageMatchLength(node, '/connections/datasources/edit/abc')).toBe('/connections/datasources'.length);
  });

  it('does not count a branch with no URL leaf as a page match', () => {
    expect(pageMatchLength(compile({ or: [{ targetPlatform: 'cloud' }, { userRole: 'Admin' }] }), '/anything')).toBe(
      -1
    );
  });

  it('matches urlRegex and skips patterns that fail to compile', () => {
    const node = compile({ or: [{ urlRegex: '(' }, { urlRegex: '^/connections/?$' }] });
    expect(pageMatchLength(node, '/connections/')).toBe('/connections/'.length);
    expect(pageMatchLength(node, '/connections/new')).toBe(-1);
  });

  it('skips a urlRegex longer than the cap', () => {
    const long = `^/${'a'.repeat(MAX_URL_REGEX_LENGTH)}$`;
    expect(pageMatchLength(compile({ urlRegex: long }), `/${'a'.repeat(MAX_URL_REGEX_LENGTH)}`)).toBe(-1);
  });
});

describe('isAvailableOnPlatform', () => {
  it('hides an oss-only entry on cloud and a cloud-only entry on oss', () => {
    const ossOnly = compile({ or: [{ and: [{ urlRegex: '^/?$' }, { targetPlatform: 'oss' }] }] });
    const cloudOnly = compile({ and: [{ urlPrefix: '/a/k6-app' }, { targetPlatform: 'cloud' }] });
    expect(isAvailableOnPlatform(ossOnly, 'cloud')).toBe(false);
    expect(isAvailableOnPlatform(ossOnly, 'oss')).toBe(true);
    expect(isAvailableOnPlatform(cloudOnly, 'oss')).toBe(false);
    expect(isAvailableOnPlatform(cloudOnly, 'cloud')).toBe(true);
  });

  it('keeps an entry with no platform leaf on both platforms', () => {
    const node = compile({ urlPrefix: '/alerting' });
    expect(isAvailableOnPlatform(node, 'cloud')).toBe(true);
    expect(isAvailableOnPlatform(node, 'oss')).toBe(true);
  });
});

describe('normalizePageUrl', () => {
  it.each([
    ['/a/grafana-k8s-app/home?var=1#top', '/a/grafana-k8s-app/home'],
    ['https://stack.grafana.net/alerting/list?search=x', '/alerting/list'],
    ['alerting', '/alerting'],
    ['?only=query', undefined],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizePageUrl(raw)).toBe(expected);
  });
});

describe('bounded urlRegex evaluation', () => {
  it('returns promptly from a catastrophic-backtracking pattern', () => {
    const pattern = compileBoundedRegex('^(a+)+$')!;
    const started = Date.now();
    expect(testBoundedRegex(pattern, `${'a'.repeat(40)}!`)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('keeps a pattern after one timeout and disables it after repeated timeouts', () => {
    const pattern = compileBoundedRegex('^(a+)+$')!;
    const hostileInput = `${'a'.repeat(40)}!`;
    expect(testBoundedRegex(pattern, hostileInput)).toBe(false);
    expect(pattern.disabled).toBe(false);
    expect(testBoundedRegex(pattern, 'aaa')).toBe(true);
    for (let i = 1; i < MAX_URL_REGEX_TIMEOUTS; i++) {
      testBoundedRegex(pattern, hostileInput);
    }
    expect(pattern.disabled).toBe(true);
    expect(testBoundedRegex(pattern, 'aaa')).toBe(false);
  });

  it('bounds a hostile catalog pattern inside a targeting tree', () => {
    const node = compile({ or: [{ urlRegex: '^/(a+)+$' }, { urlPrefix: '/b' }] });
    const started = Date.now();
    expect(pageMatchLength(node, `/${'a'.repeat(40)}!`)).toBe(-1);
    expect(pageMatchLength(node, '/b/c')).toBe(2);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('rejects non-string and empty patterns', () => {
    expect(compileBoundedRegex(42)).toBeNull();
    expect(compileBoundedRegex('')).toBeNull();
  });
});
