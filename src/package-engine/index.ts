/**
 * Package Engine
 *
 * Tier 2 engine for package resolution, loading, and structural
 * dependency queries. Consumes the bundled repository.json at runtime.
 *
 * Public API:
 * - BundledPackageResolver / createBundledResolver — resolve package IDs
 * - Loader functions — load content.json and manifest.json from bundles
 * - Dependency query functions — structural dependency navigation
 *
 * Resolution types (PackageResolution, PackageResolver, etc.) are defined
 * in src/types/package.types.ts at Tier 0 for broad importability.
 */

// Resolver
export { BundledPackageResolver, createBundledResolver } from './resolver';

// Loader
export {
  loadBundledContent,
  loadBundledManifest,
  loadBundledLegacyGuide,
  type LoadSuccess,
  type LoadFailure,
  type LoadOutcome,
} from './loader';

// Structural dependency resolution
export {
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
  type PackageDependencies,
} from './dependency-resolver';
