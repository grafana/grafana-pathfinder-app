import { resolveStartingLocation } from './starting-location';

// Mock the bundled index so the test does not depend on real content drift.
jest.mock(
  '../bundled-interactives/index.json',
  () => ({
    interactives: [
      { id: 'array-shape', url: ['/explore', '/explore-secondary'] },
      { id: 'string-shape', url: '/dashboards' },
      { id: 'empty-array-shape', url: [] },
      { id: 'no-url' },
      { id: 'non-string-url', url: [42] },
      { id: 'hostile-shape', url: ['//evil.com'] },
    ],
  }),
  { virtual: true }
);

describe('resolveStartingLocation', () => {
  it('returns startingLocation from the manifest when present', () => {
    const result = resolveStartingLocation('bundled:array-shape', { startingLocation: '/connections' });
    expect(result).toBe('/connections');
  });

  it('falls through to the bundled index when manifest has no startingLocation', () => {
    const result = resolveStartingLocation('bundled:array-shape', {});
    expect(result).toBe('/explore');
  });

  it('returns the first URL from a bundled entry that has an array', () => {
    expect(resolveStartingLocation('bundled:array-shape')).toBe('/explore');
  });

  it('returns the URL string from a bundled entry that uses a string shape', () => {
    expect(resolveStartingLocation('bundled:string-shape')).toBe('/dashboards');
  });

  it('returns null for a bundled entry with an empty url array', () => {
    expect(resolveStartingLocation('bundled:empty-array-shape')).toBeNull();
  });

  it('returns null for a bundled entry with no url field', () => {
    expect(resolveStartingLocation('bundled:no-url')).toBeNull();
  });

  it('returns null for a bundled entry with non-string url contents', () => {
    expect(resolveStartingLocation('bundled:non-string-url')).toBeNull();
  });

  it('returns null when the bundled id is not in the index', () => {
    expect(resolveStartingLocation('bundled:does-not-exist')).toBeNull();
  });

  it('returns null for a non-bundled URL when manifest has no startingLocation', () => {
    expect(resolveStartingLocation('https://interactive-learning.grafana.net/foo')).toBeNull();
  });

  // Regression: the system accepts both `bundled:<id>` (legacy) and
  // `bundled:<id>/content.json` (package format). Earlier versions of the
  // resolver passed the full slice to the index lookup, which meant the
  // package-format URL silently missed its index entry.
  it('strips a /content.json suffix before consulting the bundled index', () => {
    expect(resolveStartingLocation('bundled:array-shape/content.json')).toBe('/explore');
  });

  it('strips any trailing path segment before consulting the bundled index', () => {
    expect(resolveStartingLocation('bundled:string-shape/manifest.json')).toBe('/dashboards');
  });

  // The InteractiveGuide CRD's #Manifest does not declare startingLocation, so a value written at the
  // top level is pruned on write. The block editor and upsert-learning-path.sh both put it under
  // additionalFields instead, which means a reader has two locations to handle.
  describe('additionalFields fallback (App Platform)', () => {
    it('reads startingLocation from additionalFields when the top level has none', () => {
      const result = resolveStartingLocation('backend-guide:private', {
        additionalFields: { startingLocation: '/alerting/list' },
      });
      expect(result).toBe('/alerting/list');
    });

    it('prefers the typed top-level field over additionalFields when both are present', () => {
      const result = resolveStartingLocation('backend-guide:private', {
        startingLocation: '/promoted',
        additionalFields: { startingLocation: '/legacy' },
      });
      expect(result).toBe('/promoted');
    });

    it('falls back to additionalFields when the top-level value is an empty string', () => {
      const result = resolveStartingLocation('backend-guide:private', {
        startingLocation: '',
        additionalFields: { startingLocation: '/alerting/list' },
      });
      expect(result).toBe('/alerting/list');
    });

    it('returns null when additionalFields carries a non-string startingLocation', () => {
      const result = resolveStartingLocation('backend-guide:private', {
        additionalFields: { startingLocation: 42 },
      });
      expect(result).toBeNull();
    });

    it('returns null when additionalFields carries an empty startingLocation', () => {
      const result = resolveStartingLocation('backend-guide:private', {
        additionalFields: { startingLocation: '' },
      });
      expect(result).toBeNull();
    });

    it('returns null when additionalFields is not an object', () => {
      expect(resolveStartingLocation('backend-guide:private', { additionalFields: 'nope' })).toBeNull();
      expect(resolveStartingLocation('backend-guide:private', { additionalFields: ['nope'] })).toBeNull();
    });

    it('still consults the bundled index when neither location has a value', () => {
      const result = resolveStartingLocation('bundled:array-shape', { additionalFields: { other: 1 } });
      expect(result).toBe('/explore');
    });
  });

  it('returns null when manifest has a non-string startingLocation', () => {
    const result = resolveStartingLocation('https://example/foo', { startingLocation: 42 });
    expect(result).toBeNull();
  });

  it('returns null when manifest has an empty-string startingLocation', () => {
    const result = resolveStartingLocation('https://example/foo', { startingLocation: '' });
    expect(result).toBeNull();
  });

  it('falls through to the bundled index when manifest startingLocation is empty', () => {
    const result = resolveStartingLocation('bundled:array-shape', { startingLocation: '' });
    expect(result).toBe('/explore');
  });
});

// The manifest is authored data that ends up at `locationService.push` via
// `confirmAlignment`, so it clears the same bar as an authored navigate action.
// A rejected value resolves to null — no prompt — rather than to the redirect
// validator's `/` fallback, which would steer the reader to the home page.
describe('resolveStartingLocation — navigation safety', () => {
  const fromManifest = (startingLocation: unknown, isAdmin?: boolean) =>
    resolveStartingLocation('backend-guide:my-guide', { startingLocation } as Record<string, unknown>, { isAdmin });

  const fromAdditionalFields = (startingLocation: unknown, isAdmin?: boolean) =>
    resolveStartingLocation(
      'backend-guide:my-guide',
      { additionalFields: { startingLocation } } as Record<string, unknown>,
      { isAdmin }
    );

  it.each([
    ['a protocol-relative value', '//evil.com'],
    ['a protocol-relative value carrying a path', '//evil.com/grafana/explore'],
    ['a backslash-smuggled authority', '/\\evil.com'],
    ['an absolute external URL', 'https://evil.com/explore'],
    ['a javascript: scheme', 'javascript:alert(1)'],
    ['a relative path with no leading slash', 'explore'],
    ['an encoded traversal that survives normalization', '/foo/..%2Fbar'],
    ['an always-denied route', '/logout'],
  ])('refuses to prompt for %s', (_label, value) => {
    expect(fromManifest(value)).toBeNull();
  });

  it('applies the same rules to the additionalFields location', () => {
    expect(fromAdditionalFields('//evil.com')).toBeNull();
    expect(fromAdditionalFields('https://evil.com/explore')).toBeNull();
    expect(fromAdditionalFields('/\\evil.com')).toBeNull();
    expect(fromAdditionalFields('/foo/..%2Fbar')).toBeNull();
  });

  it('normalizes a plain traversal to its same-origin resolution', () => {
    expect(fromManifest('/../../../etc/passwd')).toBe('/etc/passwd');
  });

  it('passes a legitimate internal path through untouched', () => {
    expect(fromManifest('/connections/datasources')).toBe('/connections/datasources');
    expect(fromAdditionalFields('/explore')).toBe('/explore');
  });

  it('keeps a query string and fragment on an accepted path', () => {
    expect(fromManifest('/explore?left=metrics#panel')).toBe('/explore?left=metrics#panel');
  });

  it('withholds an admin-only starting location from a non-admin reader', () => {
    expect(fromManifest('/admin/users')).toBeNull();
    expect(fromManifest('/admin/users', false)).toBeNull();
  });

  it('allows an admin-only starting location for an admin reader', () => {
    expect(fromManifest('/admin/users', true)).toBe('/admin/users');
  });

  it('defaults to the stricter answer when the caller supplies no role', () => {
    expect(resolveStartingLocation('backend-guide:my-guide', { startingLocation: '/admin/users' })).toBeNull();
  });

  // The bundled index is build-time content, but it exits through the same gate
  // so there is one answer to "what may become a prompt", not two.
  it('validates the bundled-index fallback on the same terms', () => {
    expect(resolveStartingLocation('bundled:array-shape')).toBe('/explore');
    expect(resolveStartingLocation('bundled:hostile-shape')).toBeNull();
  });
});
