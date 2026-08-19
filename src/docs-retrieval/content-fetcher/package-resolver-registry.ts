// Holds the module-level PackageResolver singleton, split out from
// package-content.ts specifically so module.tsx can register a resolver
// without statically importing that file's heavy `content-fetcher` chain.
// Only import is lib/logging, already proven safe for the eager entry bundle.
import type { PackageResolver } from '../../types';
import { logger } from '../../lib/logging';

let _resolverFactory: (() => Promise<PackageResolver>) | undefined;
let _resolverPromise: Promise<PackageResolver | undefined> | undefined;

/**
 * Register an already-constructed resolver. Used by callers outside the
 * eager entry chunk (e.g. CombinedLearningJourneyPanel's constructor), which
 * have no reason to defer construction.
 */
export function setPackageResolver(resolver: PackageResolver): void {
  _resolverFactory = undefined;
  _resolverPromise = Promise.resolve(resolver);
}

/**
 * Register a factory that lazily constructs the resolver on first read. Used
 * by plugin.init so constructing the composite resolver (and its zod/CDN/etc.
 * dependencies, split into their own chunk) doesn't happen until something
 * actually calls getPackageResolver() — not at registration. Calling the
 * factory here instead would fetch that chunk on every page load where
 * module.js loads, including for users who never open Pathfinder.
 *
 * Only stores the thunk; clears any previously memoized promise so a second
 * registration (e.g. module.tsx's post-refresh re-wire) actually takes effect
 * on the next read instead of returning a stale result.
 */
export function setPackageResolverFactory(factory: () => Promise<PackageResolver>): void {
  _resolverFactory = factory;
  _resolverPromise = undefined;
}

/**
 * The promise is memoized once invoked, so a rejection would otherwise be
 * cached and re-thrown by every later call for the rest of the session —
 * silently breaking every caller's "no resolver configured" fallback. Caught
 * here, mirroring the other fire-and-forget async init calls in module.tsx
 * (e.g. initFaro's .catch(logger.exception)).
 */
export function getPackageResolver(): Promise<PackageResolver | undefined> {
  if (!_resolverPromise) {
    if (!_resolverFactory) {
      return Promise.resolve(undefined);
    }
    _resolverPromise = _resolverFactory().catch((error) => {
      logger.exception(error, { source: 'getPackageResolver' });
      return undefined;
    });
  }
  return _resolverPromise;
}
