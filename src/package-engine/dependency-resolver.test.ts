/**
 * Structural Dependency Resolver Tests (Layer 2)
 *
 * Pure unit tests — no mocking needed since all functions
 * accept repository data as parameters.
 */

import type { RepositoryJson } from '../types/package.types';

import {
  flattenDependencyList,
  flattenClause,
  buildProvidesIndex,
  getProviders,
  getPackageDependencies,
  getTransitiveDependencies,
  getRecommendedBy,
  getDependedOnBy,
  listPackageIds,
  getRepositoryEntry,
} from './dependency-resolver';

const FIXTURE_REPO: RepositoryJson = {
  'welcome-tour': {
    path: 'welcome-tour/',
    type: 'guide',
    provides: ['grafana-tour'],
  },
  'configure-prometheus': {
    path: 'configure-prometheus/',
    type: 'guide',
    depends: ['welcome-tour'],
    provides: ['datasource-configured', 'prometheus-configured'],
    recommends: ['welcome-tour'],
  },
  'configure-loki': {
    path: 'configure-loki/',
    type: 'guide',
    depends: ['welcome-tour'],
    provides: ['datasource-configured', 'loki-configured'],
  },
  'first-dashboard': {
    path: 'first-dashboard/',
    type: 'guide',
    depends: [['configure-prometheus', 'configure-loki']],
    recommends: ['welcome-tour'],
    suggests: ['advanced-queries'],
    provides: ['dashboard-created'],
  },
  'advanced-queries': {
    path: 'advanced-queries/',
    type: 'guide',
    depends: ['configure-prometheus'],
    recommends: ['configure-loki'],
  },
  orphan: {
    path: 'orphan/',
    type: 'guide',
  },
};

// ============ flattenDependencyList ============

describe('flattenDependencyList', () => {
  it('should flatten a list of bare string clauses', () => {
    expect(flattenDependencyList(['A', 'B', 'C'])).toEqual(['A', 'B', 'C']);
  });

  it('should flatten OR-groups into individual IDs', () => {
    expect(flattenDependencyList([['A', 'B']])).toEqual(['A', 'B']);
  });

  it('should flatten mixed AND and OR clauses', () => {
    expect(flattenDependencyList([['A', 'B'], 'C'])).toEqual(['A', 'B', 'C']);
  });

  it('should return empty array for empty list', () => {
    expect(flattenDependencyList([])).toEqual([]);
  });
});

// ============ flattenClause ============

describe('flattenClause', () => {
  it('should wrap a string in an array', () => {
    expect(flattenClause('A')).toEqual(['A']);
  });

  it('should return a copy of an array clause', () => {
    const clause = ['A', 'B'];
    const result = flattenClause(clause);
    expect(result).toEqual(['A', 'B']);
    expect(result).not.toBe(clause);
  });
});

// ============ buildProvidesIndex ============

describe('buildProvidesIndex', () => {
  it('should build a reverse index from capabilities to providers', () => {
    const index = buildProvidesIndex(FIXTURE_REPO);

    expect(index.get('grafana-tour')).toEqual(['welcome-tour']);
    expect(index.get('datasource-configured')).toEqual(['configure-prometheus', 'configure-loki']);
    expect(index.get('prometheus-configured')).toEqual(['configure-prometheus']);
    expect(index.get('loki-configured')).toEqual(['configure-loki']);
    expect(index.get('dashboard-created')).toEqual(['first-dashboard']);
  });

  it('should return empty map for empty repository', () => {
    const index = buildProvidesIndex({});
    expect(index.size).toBe(0);
  });

  it('should handle entries without provides', () => {
    const index = buildProvidesIndex({ orphan: { path: 'orphan/', type: 'guide' } });
    expect(index.size).toBe(0);
  });
});

// ============ getProviders ============

describe('getProviders', () => {
  it('should find all providers of a capability', () => {
    expect(getProviders(FIXTURE_REPO, 'datasource-configured')).toEqual(['configure-prometheus', 'configure-loki']);
  });

  it('should find a single provider', () => {
    expect(getProviders(FIXTURE_REPO, 'grafana-tour')).toEqual(['welcome-tour']);
  });

  it('should return empty array for unknown capability', () => {
    expect(getProviders(FIXTURE_REPO, 'nonexistent')).toEqual([]);
  });

  it('should return empty array for empty repository', () => {
    expect(getProviders({}, 'anything')).toEqual([]);
  });
});

// ============ getPackageDependencies ============

describe('getPackageDependencies', () => {
  it('should return all dependency types for a package', () => {
    const deps = getPackageDependencies(FIXTURE_REPO, 'first-dashboard');
    expect(deps).toEqual({
      depends: ['configure-prometheus', 'configure-loki'],
      recommends: ['welcome-tour'],
      suggests: ['advanced-queries'],
      provides: ['dashboard-created'],
    });
  });

  it('should return empty arrays when package has no dependencies', () => {
    const deps = getPackageDependencies(FIXTURE_REPO, 'orphan');
    expect(deps).toEqual({
      depends: [],
      recommends: [],
      suggests: [],
      provides: [],
    });
  });

  it('should return undefined for nonexistent package', () => {
    expect(getPackageDependencies(FIXTURE_REPO, 'nonexistent')).toBeUndefined();
  });
});

// ============ getTransitiveDependencies ============

describe('getTransitiveDependencies', () => {
  it('should return direct dependencies', () => {
    const deps = getTransitiveDependencies(FIXTURE_REPO, 'configure-prometheus');
    expect(deps).toEqual(['welcome-tour']);
  });

  it('should return transitive dependencies', () => {
    const deps = getTransitiveDependencies(FIXTURE_REPO, 'advanced-queries');
    expect(deps).toContain('configure-prometheus');
    expect(deps).toContain('welcome-tour');
    expect(deps).toHaveLength(2);
  });

  it('should not include the package itself', () => {
    const deps = getTransitiveDependencies(FIXTURE_REPO, 'first-dashboard');
    expect(deps).not.toContain('first-dashboard');
  });

  it('should return empty array for a package with no depends', () => {
    expect(getTransitiveDependencies(FIXTURE_REPO, 'welcome-tour')).toEqual([]);
  });

  it('should return empty array for nonexistent package', () => {
    expect(getTransitiveDependencies(FIXTURE_REPO, 'nonexistent')).toEqual([]);
  });

  it('should handle circular dependencies gracefully', () => {
    const circular: RepositoryJson = {
      A: { path: 'A/', type: 'guide', depends: ['B'] },
      B: { path: 'B/', type: 'guide', depends: ['C'] },
      C: { path: 'C/', type: 'guide', depends: ['A'] },
    };

    const deps = getTransitiveDependencies(circular, 'A');
    expect(deps).toContain('B');
    expect(deps).toContain('C');
    expect(deps).not.toContain('A');
  });

  it('should handle self-referential dependencies', () => {
    const selfRef: RepositoryJson = {
      A: { path: 'A/', type: 'guide', depends: ['A'] },
    };

    const deps = getTransitiveDependencies(selfRef, 'A');
    expect(deps).toEqual([]);
  });

  it('should handle dangling references without error', () => {
    const dangling: RepositoryJson = {
      A: { path: 'A/', type: 'guide', depends: ['B'] },
    };

    const deps = getTransitiveDependencies(dangling, 'A');
    expect(deps).toContain('B');
  });
});

// ============ getRecommendedBy ============

describe('getRecommendedBy', () => {
  it('should find packages that recommend a given package', () => {
    const result = getRecommendedBy(FIXTURE_REPO, 'welcome-tour');
    expect(result).toContain('configure-prometheus');
    expect(result).toContain('first-dashboard');
  });

  it('should return empty array when nothing recommends the package', () => {
    expect(getRecommendedBy(FIXTURE_REPO, 'orphan')).toEqual([]);
  });

  it('should return empty array for nonexistent package', () => {
    expect(getRecommendedBy(FIXTURE_REPO, 'nonexistent')).toEqual([]);
  });
});

// ============ getDependedOnBy ============

describe('getDependedOnBy', () => {
  it('should find packages that depend on a given package', () => {
    const result = getDependedOnBy(FIXTURE_REPO, 'welcome-tour');
    expect(result).toContain('configure-prometheus');
    expect(result).toContain('configure-loki');
  });

  it('should find OR-group dependents', () => {
    const result = getDependedOnBy(FIXTURE_REPO, 'configure-prometheus');
    expect(result).toContain('first-dashboard');
    expect(result).toContain('advanced-queries');
  });

  it('should return empty array for leaf packages', () => {
    expect(getDependedOnBy(FIXTURE_REPO, 'first-dashboard')).toEqual([]);
  });

  it('should return empty array for nonexistent package', () => {
    expect(getDependedOnBy(FIXTURE_REPO, 'nonexistent')).toEqual([]);
  });
});

// ============ listPackageIds ============

describe('listPackageIds', () => {
  it('should return all package IDs', () => {
    const ids = listPackageIds(FIXTURE_REPO);
    expect(ids).toHaveLength(6);
    expect(ids).toContain('welcome-tour');
    expect(ids).toContain('first-dashboard');
    expect(ids).toContain('orphan');
  });

  it('should return empty array for empty repository', () => {
    expect(listPackageIds({})).toEqual([]);
  });
});

// ============ getRepositoryEntry ============

describe('getRepositoryEntry', () => {
  it('should return the entry for a known package', () => {
    const entry = getRepositoryEntry(FIXTURE_REPO, 'welcome-tour');
    expect(entry).toBeDefined();
    expect(entry?.path).toBe('welcome-tour/');
    expect(entry?.type).toBe('guide');
  });

  it('should return undefined for an unknown package', () => {
    expect(getRepositoryEntry(FIXTURE_REPO, 'nonexistent')).toBeUndefined();
  });
});
