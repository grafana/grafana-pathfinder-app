// Holds the module-level PackageResolver singleton, split out from
// package-content.ts specifically so module.tsx can register a resolver
// without statically importing that file's heavy `content-fetcher` chain.
// Only import is lib/logging, already proven safe for the eager entry bundle.
import type { PackageResolver } from '../../types';
import { logger } from '../../lib/logging';

let _resolverPromise: Promise<PackageResolver | undefined> | undefined;

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
 *
 * The promise is memoized, so a rejection would otherwise be cached and
 * re-thrown by every later getPackageResolver() call for the rest of the
 * session — silently breaking every caller's "no resolver configured"
 * fallback. Caught here instead, mirroring the other fire-and-forget async
 * init calls in module.tsx (e.g. initFaro's .catch(logger.exception)).
 */
export function setPackageResolverFactory(factory: () => Promise<PackageResolver>): void {
  _resolverPromise = factory().catch((error) => {
    logger.exception(error, { source: 'setPackageResolverFactory' });
    return undefined;
  });
}

export function getPackageResolver(): Promise<PackageResolver | undefined> {
  return _resolverPromise ?? Promise.resolve(undefined);
}
