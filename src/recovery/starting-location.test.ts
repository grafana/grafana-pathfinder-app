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
