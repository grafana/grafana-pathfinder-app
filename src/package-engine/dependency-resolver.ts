/**
 * Structural Dependency Resolver
 *
 * Provides structural queries over package dependency metadata from
 * repository.json. Answers "which packages provide X?" and "what does
 * package Y depend on?" without consulting completion state.
 *
 * Completion/satisfaction checking is a consumer concern — it requires
 * data from learning-paths (Tier 2) which this engine cannot import
 * (lateral isolation).
 *
 * @coupling Types: RepositoryJson, DependencyList in package.types.ts
 */

import type { DependencyClause, DependencyList, RepositoryEntry, RepositoryJson } from '../types/package.types';

/** Own-key lookup that ignores prototype-chain properties like toString/constructor. */
function ownEntry(repository: RepositoryJson, id: string): RepositoryEntry | undefined {
  return Object.hasOwn(repository, id) ? repository[id] : undefined;
}

// ============ DEPENDENCY FLATTENING ============

/**
 * Extract all bare package IDs mentioned in a dependency list,
 * regardless of AND/OR structure. Useful for graph traversal
 * and existence checks.
 */
export function flattenDependencyList(deps: DependencyList): string[] {
  const ids: string[] = [];
  for (const clause of deps) {
    if (typeof clause === 'string') {
      ids.push(clause);
    } else {
      ids.push(...clause);
    }
  }
  return ids;
}

/**
 * Extract all package IDs from a single dependency clause.
 */
export function flattenClause(clause: DependencyClause): string[] {
  return typeof clause === 'string' ? [clause] : [...clause];
}

// ============ PROVIDES RESOLUTION ============

/**
 * Build a reverse index from capability names to the package IDs
 * that provide them.
 */
export function buildProvidesIndex(repository: RepositoryJson): Map<string, string[]> {
  const index = new Map<string, string[]>();

  for (const [packageId, entry] of Object.entries(repository)) {
    if (!entry?.provides) {
      continue;
    }
    for (const capability of entry.provides) {
      const providers = index.get(capability);
      if (providers) {
        providers.push(packageId);
      } else {
        index.set(capability, [packageId]);
      }
    }
  }

  return index;
}

/**
 * Find all packages that provide a given capability.
 *
 * @example
 * ```ts
 * getProviders(repository, "datasource-configured")
 * // → ["configure-prometheus", "configure-loki"]
 * ```
 */
export function getProviders(repository: RepositoryJson, capability: string): string[] {
  const result: string[] = [];
  for (const [packageId, entry] of Object.entries(repository)) {
    if (entry?.provides?.includes(capability)) {
      result.push(packageId);
    }
  }
  return result;
}

// ============ DEPENDENCY QUERIES ============

export interface PackageDependencies {
  depends: string[];
  recommends: string[];
  suggests: string[];
  provides: string[];
}

/**
 * Get the structural dependencies for a package.
 * Returns all referenced package IDs flattened from the CNF dependency lists.
 */
export function getPackageDependencies(repository: RepositoryJson, packageId: string): PackageDependencies | undefined {
  const entry = ownEntry(repository, packageId);
  if (!entry) {
    return undefined;
  }
  return {
    depends: flattenDependencyList(entry.depends ?? []),
    recommends: flattenDependencyList(entry.recommends ?? []),
    suggests: flattenDependencyList(entry.suggests ?? []),
    provides: entry.provides ?? [],
  };
}

// ============ TRANSITIVE RESOLUTION ============

/**
 * Collect all transitive hard dependencies for a package using
 * depth-first traversal. Handles cycles by tracking visited nodes.
 *
 * Returns package IDs in topological order (dependencies before dependents).
 *
 * Dangling IDs (declared in `depends` but absent from the repository) are
 * intentionally preserved in the result. This function reports the structural
 * dependency tree as declared, not as resolved. Consumers at Tier 3+ combine
 * this output with resolver existence checks and learning-paths completion
 * data to determine actual satisfaction — filtering here would hide missing
 * dependencies from that logic and break cross-repository resolution when
 * additional tiers are added (Phase 4+).
 */
export function getTransitiveDependencies(repository: RepositoryJson, packageId: string): string[] {
  const visited = new Set<string>();
  const result: string[] = [];

  function dfs(id: string): void {
    if (visited.has(id)) {
      return;
    }
    visited.add(id);

    const entry = ownEntry(repository, id);
    if (entry?.depends) {
      const depIds = flattenDependencyList(entry.depends);
      for (const depId of depIds) {
        dfs(depId);
      }
    }

    result.push(id);
  }

  dfs(packageId);

  result.pop();

  return result;
}

// ============ NAVIGATION HELPERS ============

/**
 * Get packages that recommend a given package.
 * Useful for "what should I learn next?" suggestions.
 */
export function getRecommendedBy(repository: RepositoryJson, packageId: string): string[] {
  const result: string[] = [];
  for (const [otherId, entry] of Object.entries(repository)) {
    if (!entry?.recommends) {
      continue;
    }
    if (flattenDependencyList(entry.recommends).includes(packageId)) {
      result.push(otherId);
    }
  }
  return result;
}

/**
 * Get packages that depend on a given package.
 * Useful for understanding reverse dependency chains.
 */
export function getDependedOnBy(repository: RepositoryJson, packageId: string): string[] {
  const result: string[] = [];
  for (const [otherId, entry] of Object.entries(repository)) {
    if (!entry?.depends) {
      continue;
    }
    if (flattenDependencyList(entry.depends).includes(packageId)) {
      result.push(otherId);
    }
  }
  return result;
}

// ============ REPOSITORY QUERIES ============

/**
 * List all package IDs in the repository.
 */
export function listPackageIds(repository: RepositoryJson): string[] {
  return Object.keys(repository);
}

/**
 * Get a repository entry by package ID.
 * Returns undefined if not found (noUncheckedIndexedAccess compatible).
 */
export function getRepositoryEntry(repository: RepositoryJson, packageId: string): RepositoryEntry | undefined {
  return ownEntry(repository, packageId);
}
