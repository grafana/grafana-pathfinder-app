// Holds the module-level PackageResolver singleton, split out from
// package-content.ts specifically so module.tsx can register a resolver
// without statically importing that file's heavy `content-fetcher` chain.
// Zero runtime imports — safe for the eager entry bundle.
import type { PackageResolver } from '../../types';

let _resolverPromise: Promise<PackageResolver> | undefined;

/**
 * Register an already-constructed resolver. Used by callers outside the
 * eager entry chunk (e.g. CombinedLearningJourneyPanel's constructor), which
 * have no reason to defer construction.
 */
export function setPackageResolver(resolver: PackageResolver): void {
  _resolverPromise = Promise.resolve(resolver);
}

/**
 * Register a factory that lazily constructs the resolver on first read.
 * Used by plugin.init so constructing the composite resolver (and its
 * zod/CDN/etc. dependencies) doesn't happen on the eager module.js chunk.
 */
export function setPackageResolverFactory(factory: () => Promise<PackageResolver>): void {
  _resolverPromise = factory();
}

export function getPackageResolver(): Promise<PackageResolver | undefined> {
  return _resolverPromise ?? Promise.resolve(undefined);
}
