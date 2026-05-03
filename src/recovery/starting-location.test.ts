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
