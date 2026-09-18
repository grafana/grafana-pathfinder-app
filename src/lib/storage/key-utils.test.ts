import { clearKeysByPrefix, collectKeysByPrefix, isKeyUnderPrefix } from './key-utils';

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

describe('isKeyUnderPrefix', () => {
  it('returns true when prefix is empty (clear-all semantics)', () => {
    expect(isKeyUnderPrefix('/alerting', '')).toBe(true);
    expect(isKeyUnderPrefix('/any/nested/path', '')).toBe(true);
    expect(isKeyUnderPrefix('bundled:guide', '')).toBe(true);
  });

  it('returns true for exact match', () => {
    expect(isKeyUnderPrefix('/alerting', '/alerting')).toBe(true);
    expect(isKeyUnderPrefix('/docs/path', '/docs/path')).toBe(true);
  });

  it('returns true for child paths (slash-delimited hierarchy)', () => {
    expect(isKeyUnderPrefix('/alerting/intro', '/alerting')).toBe(true);
    expect(isKeyUnderPrefix('/alerting/advanced/step1', '/alerting')).toBe(true);
    expect(isKeyUnderPrefix('/docs/path/milestone-1', '/docs/path')).toBe(true);
  });

  it('returns false for sibling paths that share a string prefix (the bug case)', () => {
    expect(isKeyUnderPrefix('/alerting-advanced', '/alerting')).toBe(false);
    expect(isKeyUnderPrefix('/alerting-advanced/intro', '/alerting')).toBe(false);
    expect(isKeyUnderPrefix('/docs/path-2', '/docs/path')).toBe(false);
    expect(isKeyUnderPrefix('/docs/pathology', '/docs/path')).toBe(false);
  });

  it('handles prefix already ending with slash', () => {
    expect(isKeyUnderPrefix('/alerting/intro', '/alerting/')).toBe(true);
    expect(isKeyUnderPrefix('/alerting-advanced', '/alerting/')).toBe(false);
    // Key exactly matching prefix-with-slash is not exact (prefix is /alerting/, key is /alerting)
    expect(isKeyUnderPrefix('/alerting', '/alerting/')).toBe(false);
  });

  it('returns false when key is shorter than prefix', () => {
    expect(isKeyUnderPrefix('/alert', '/alerting')).toBe(false);
    expect(isKeyUnderPrefix('/doc', '/docs/path')).toBe(false);
  });

  it('returns true when key has trailing slash and prefix does not', () => {
    expect(isKeyUnderPrefix('/alerting/', '/alerting')).toBe(true);
  });

  it('handles bundled scheme keys (uses / as hierarchy delimiter)', () => {
    expect(isKeyUnderPrefix('bundled:welcome', 'bundled:welcome')).toBe(true);
    expect(isKeyUnderPrefix('bundled:welcome/content.json', 'bundled:welcome')).toBe(true);
    expect(isKeyUnderPrefix('bundled:welcome-cloud', 'bundled:welcome')).toBe(false);
  });

  it('handles full URL keys', () => {
    const base = 'https://grafana.com/docs/learning-journeys/alerting';
    expect(isKeyUnderPrefix(base, base)).toBe(true);
    expect(isKeyUnderPrefix(base + '/milestone-1', base)).toBe(true);
    expect(isKeyUnderPrefix(base + '-advanced', base)).toBe(false);
    expect(isKeyUnderPrefix(base + '-advanced/milestone-1', base)).toBe(false);
  });

  it('treats a query string or fragment on the path itself as under the prefix', () => {
    const base = 'https://grafana.com/docs/learning-journeys/alerting';
    // No trailing slash before the ? or # — still the same path (#1950 follow-up).
    expect(isKeyUnderPrefix(base + '?utm=x', base)).toBe(true);
    expect(isKeyUnderPrefix(base + '#top', base)).toBe(true);
    // The trailing-slash forms are under the prefix too.
    expect(isKeyUnderPrefix(base + '/?utm=x', base)).toBe(true);
    expect(isKeyUnderPrefix(base + '/#top', base)).toBe(true);
  });

  it('does not let a query/fragment boundary rescue a sibling path', () => {
    // The char after the prefix is '-', not a boundary, so the query/fragment
    // that follows must not pull the sibling back in.
    expect(isKeyUnderPrefix('/alerting-advanced?utm=x', '/alerting')).toBe(false);
    expect(isKeyUnderPrefix('/alerting-advanced#top', '/alerting')).toBe(false);
  });
});
