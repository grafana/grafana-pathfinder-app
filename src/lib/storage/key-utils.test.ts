import { clearKeysByPrefix, collectKeysByPrefix, matchesPrefixOrChild } from './key-utils';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('collectKeysByPrefix', () => {
  it('returns every key with the given prefix', () => {
    localStorage.setItem('foo-1', '1');
    localStorage.setItem('foo-2', '2');
    localStorage.setItem('bar-3', '3');

    const collected = collectKeysByPrefix(localStorage, 'foo-');
    expect(collected.sort()).toEqual(['foo-1', 'foo-2']);
  });

  it('returns [] when no key matches', () => {
    localStorage.setItem('bar', '1');
    expect(collectKeysByPrefix(localStorage, 'foo-')).toEqual([]);
  });

  it('returns [] when storage.key throws', () => {
    const original = Storage.prototype.key;
    Storage.prototype.key = jest.fn(() => {
      throw new Error('storage unavailable');
    });
    try {
      expect(collectKeysByPrefix(localStorage, 'foo-')).toEqual([]);
    } finally {
      Storage.prototype.key = original;
    }
  });

  it('works against sessionStorage', () => {
    sessionStorage.setItem('s-a', 'a');
    sessionStorage.setItem('s-b', 'b');
    sessionStorage.setItem('other', 'c');

    expect(collectKeysByPrefix(sessionStorage, 's-').sort()).toEqual(['s-a', 's-b']);
  });

  it('iterates from the top index down so concurrent removes are safe', () => {
    localStorage.setItem('p-1', '1');
    localStorage.setItem('p-2', '2');
    localStorage.setItem('p-3', '3');

    // Simulate a caller that removes each key as it iterates. With a
    // descending sweep, every match is still seen.
    const collected = collectKeysByPrefix(localStorage, 'p-');
    expect(collected).toHaveLength(3);
  });
});

describe('clearKeysByPrefix', () => {
  it('removes only matching keys and leaves siblings alone', () => {
    localStorage.setItem('p-1', '1');
    localStorage.setItem('p-2', '2');
    localStorage.setItem('keep-me', 'k');

    const removed = clearKeysByPrefix(localStorage, 'p-');

    expect(removed.sort()).toEqual(['p-1', 'p-2']);
    expect(localStorage.getItem('p-1')).toBeNull();
    expect(localStorage.getItem('p-2')).toBeNull();
    expect(localStorage.getItem('keep-me')).toBe('k');
  });

  it('returns [] when no key matches', () => {
    localStorage.setItem('bar', '1');
    expect(clearKeysByPrefix(localStorage, 'foo-')).toEqual([]);
    expect(localStorage.getItem('bar')).toBe('1');
  });

  it('does not throw when storage.removeItem throws on some entries', () => {
    localStorage.setItem('p-1', '1');
    localStorage.setItem('p-2', '2');

    const original = Storage.prototype.removeItem;
    Storage.prototype.removeItem = jest.fn(() => {
      throw new Error('quota / locked');
    });
    try {
      expect(() => clearKeysByPrefix(localStorage, 'p-')).not.toThrow();
    } finally {
      Storage.prototype.removeItem = original;
    }
  });

  it('works against sessionStorage', () => {
    sessionStorage.setItem('s-a', 'a');
    sessionStorage.setItem('s-b', 'b');
    sessionStorage.setItem('other', 'c');

    clearKeysByPrefix(sessionStorage, 's-');

    expect(sessionStorage.getItem('s-a')).toBeNull();
    expect(sessionStorage.getItem('s-b')).toBeNull();
    expect(sessionStorage.getItem('other')).toBe('c');
  });
});

describe('matchesPrefixOrChild', () => {
  it('returns true for exact match', () => {
    expect(matchesPrefixOrChild('/alerting', '/alerting')).toBe(true);
  });

  it('returns true for exact match with trailing slash on key', () => {
    expect(matchesPrefixOrChild('/alerting/', '/alerting')).toBe(true);
  });

  it('returns true for exact match with trailing slash on prefix', () => {
    expect(matchesPrefixOrChild('/alerting', '/alerting/')).toBe(true);
  });

  it('returns true for direct child path', () => {
    expect(matchesPrefixOrChild('/alerting/rules', '/alerting')).toBe(true);
  });

  it('returns true for deeply nested child path', () => {
    expect(matchesPrefixOrChild('/alerting/rules/edit', '/alerting')).toBe(true);
  });

  it('returns true for child with trailing slash', () => {
    expect(matchesPrefixOrChild('/alerting/rules/', '/alerting')).toBe(true);
  });

  it('returns false for sibling with shared prefix substring', () => {
    expect(matchesPrefixOrChild('/alerting-advanced', '/alerting')).toBe(false);
  });

  it('returns false for sibling with hyphenated suffix', () => {
    expect(matchesPrefixOrChild('/drilldown-logs', '/drilldown')).toBe(false);
  });

  it('returns false for path that starts with prefix but has no separator', () => {
    expect(matchesPrefixOrChild('/foobar', '/foo')).toBe(false);
  });

  it('returns false for unrelated path', () => {
    expect(matchesPrefixOrChild('/dashboards', '/alerting')).toBe(false);
  });

  it('returns true for any key when prefix is empty', () => {
    expect(matchesPrefixOrChild('/anything', '')).toBe(true);
    expect(matchesPrefixOrChild('', '')).toBe(true);
  });

  it('handles full URL keys with domain', () => {
    const prefix = 'https://grafana.com/docs/alerting';
    expect(matchesPrefixOrChild('https://grafana.com/docs/alerting', prefix)).toBe(true);
    expect(matchesPrefixOrChild('https://grafana.com/docs/alerting/', prefix)).toBe(true);
    expect(matchesPrefixOrChild('https://grafana.com/docs/alerting/rules', prefix)).toBe(true);
    expect(matchesPrefixOrChild('https://grafana.com/docs/alerting-advanced', prefix)).toBe(false);
  });

  it('handles bundled content keys', () => {
    const prefix = 'bundled:welcome-to-grafana';
    expect(matchesPrefixOrChild('bundled:welcome-to-grafana', prefix)).toBe(true);
    expect(matchesPrefixOrChild('bundled:welcome-to-grafana/', prefix)).toBe(true);
    expect(matchesPrefixOrChild('bundled:welcome-to-grafana/section', prefix)).toBe(true);
    expect(matchesPrefixOrChild('bundled:welcome-to-grafana-cloud', prefix)).toBe(false);
  });
});
