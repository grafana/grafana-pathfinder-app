import { evaluateAlignment, pathMatchesStartingLocation } from './alignment-evaluator';

describe('pathMatchesStartingLocation', () => {
  it('returns true for an exact match', () => {
    expect(pathMatchesStartingLocation('/connections', '/connections')).toBe(true);
  });

  it('returns true when currentPath is deeper than startingLocation', () => {
    expect(pathMatchesStartingLocation('/connections/datasources', '/connections')).toBe(true);
  });

  it('returns false for a non-matching path', () => {
    expect(pathMatchesStartingLocation('/explore', '/connections')).toBe(false);
  });

  it('returns true for the root starting location when current is also root', () => {
    expect(pathMatchesStartingLocation('/', '/')).toBe(true);
  });

  // Regression: `currentPath.includes(startingLocation)` falsely matched
  // unrelated paths that happened to contain the target as a substring.
  it('returns false when currentPath shares a prefix string but not a path segment', () => {
    expect(pathMatchesStartingLocation('/connections-new', '/connections')).toBe(false);
  });

  it('returns false when startingLocation appears mid-path rather than at the start', () => {
    expect(pathMatchesStartingLocation('/explore/metrics', '/metrics')).toBe(false);
  });

  it('returns false when paths are unrelated despite overlapping characters', () => {
    expect(pathMatchesStartingLocation('/dashboards', '/dash')).toBe(false);
  });

  it('treats a trailing slash on either side as equivalent', () => {
    expect(pathMatchesStartingLocation('/connections/', '/connections')).toBe(true);
    expect(pathMatchesStartingLocation('/connections', '/connections/')).toBe(true);
  });

  it('does not treat root as an ancestor of every path', () => {
    // Root only matches root; a guide that declares `/` as its starting
    // location should not be considered aligned for arbitrary deeper pages.
    expect(pathMatchesStartingLocation('/explore', '/')).toBe(false);
  });
});

describe('evaluateAlignment', () => {
  it('does not prompt when startingLocation is null', () => {
    const result = evaluateAlignment({
      currentPath: '/explore',
      startingLocation: null,
      launchSource: 'home_page',
    });
    expect(result).toEqual({ shouldPrompt: false, reason: 'no-starting-location' });
  });

  it('does not prompt when path matches exactly', () => {
    const result = evaluateAlignment({
      currentPath: '/connections',
      startingLocation: '/connections',
      launchSource: 'home_page',
    });
    expect(result).toEqual({ shouldPrompt: false, reason: 'aligned' });
  });

  it('does not prompt when path matches by prefix', () => {
    const result = evaluateAlignment({
      currentPath: '/connections/datasources',
      startingLocation: '/connections',
      launchSource: 'home_page',
    });
    expect(result).toEqual({ shouldPrompt: false, reason: 'aligned' });
  });

  it('does not prompt when launch source is aligned-by-construction', () => {
    const result = evaluateAlignment({
      currentPath: '/explore',
      startingLocation: '/connections',
      launchSource: 'recommender',
    });
    expect(result).toEqual({ shouldPrompt: false, reason: 'source-skipped' });
  });

  it('does not prompt for mcp_launch even when paths differ', () => {
    const result = evaluateAlignment({
      currentPath: '/dashboards',
      startingLocation: '/connections',
      launchSource: 'mcp_launch',
    });
    expect(result.shouldPrompt).toBe(false);
    expect(result.reason).toBe('source-skipped');
  });

  it('prompts when path differs and source needs check', () => {
    const result = evaluateAlignment({
      currentPath: '/explore',
      startingLocation: '/connections',
      launchSource: 'home_page',
    });
    expect(result).toEqual({ shouldPrompt: true, reason: 'mismatch' });
  });

  it('prompts when path differs and source is unknown (default to check)', () => {
    const result = evaluateAlignment({
      currentPath: '/explore',
      startingLocation: '/connections',
      launchSource: 'some_new_surface',
    });
    expect(result).toEqual({ shouldPrompt: true, reason: 'mismatch' });
  });

  it('prompts when path differs and launchSource is undefined', () => {
    const result = evaluateAlignment({
      currentPath: '/explore',
      startingLocation: '/connections',
      launchSource: undefined,
    });
    expect(result).toEqual({ shouldPrompt: true, reason: 'mismatch' });
  });

  it('does not prompt for url_param when paths match', () => {
    // url_param is in NEEDS_ALIGNMENT_CHECK_SOURCES but the path already matches
    const result = evaluateAlignment({
      currentPath: '/connections/add-new-connection',
      startingLocation: '/connections',
      launchSource: 'url_param',
    });
    expect(result).toEqual({ shouldPrompt: false, reason: 'aligned' });
  });
});
