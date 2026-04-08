/**
 * Package Engine
 *
 * Tier 2 engine for package resolution and loading.
 * Consumes the bundled repository.json at runtime.
 *
 * Public API:
 * - BundledPackageResolver / createBundledResolver — resolve package IDs
 * - RecommenderPackageResolver — resolve via recommender HTTP API
 * - CompositePackageResolver / createCompositeResolver — bundled-first fallback chain
 * - Loader functions — load content.json and manifest.json from bundles
 *
 * Resolution types (PackageResolution, PackageResolver, etc.) are defined
 * in src/types/package.types.ts at Tier 0 for broad importability.
 */

// Resolvers
export { BundledPackageResolver, createBundledResolver } from './resolver';
export { RecommenderPackageResolver } from './recommender-resolver';
export { CompositePackageResolver, createCompositeResolver } from './composite-resolver';

// Loader
export {
  loadBundledContent,
  loadBundledManifest,
  type LoadSuccess,
  type LoadFailure,
  type LoadOutcome,
} from './loader';
