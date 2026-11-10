import { isBundledTutorial } from '../lib/bundled-tutorial-identity';
import type { GuideDiagnostic } from '../types/guide-diagnostics.types';
/**
 * Composite Package Resolver
 *
 * Combines multiple PackageResolver implementations into a single resolver.
 * Only migrated tutorials prefer the enabled recommender; other IDs stay bundled-first.
 *
 * The composite preserves the PackageResolver interface — callers don't
 * know which tier resolved.
 *
 * @coupling Types: PackageResolver, PackageResolution in package.types.ts
 * @coupling Config: isRecommenderEnabled in constants.ts
 */

import { type PathfinderPluginConfig, isRecommenderEnabled, getConfigWithDefaults } from '../constants';
import type { PackageResolution, PackageResolver, ResolveOptions } from '../types/package.types';

import { createBundledResolver } from './resolver';
import { OnlineCdnPackageResolver } from './online-cdn-resolver';
import { RecommenderPackageResolver } from './recommender-resolver';
import { AppPlatformPackageResolver } from './app-platform-resolver';

// Repositories whose resolutions must never be memoized: App Platform is a
// mutable, read-write repository (guides are edited in place), unlike the
// static/read-mostly bundled and CDN repositories. Caching a successful
// resolution here would serve stale content after an author edits a guide.
const UNCACHEABLE_REPOSITORIES = new Set(['app-platform']);

function isResolutionMiss(diagnostic: GuideDiagnostic): boolean {
  return (
    diagnostic.reason === 'not-found' ||
    (diagnostic.stage === 'resolve' &&
      diagnostic.reason === 'http-error' &&
      (diagnostic.statusCode === 400 || diagnostic.statusCode === 404))
  );
}

export class CompositePackageResolver implements PackageResolver {
  private readonly resolvers: PackageResolver[];
  private readonly cache = new Map<string, Promise<PackageResolution>>();

  constructor(
    resolvers: PackageResolver[],
    private readonly preferOnlineFor?: (packageId: string) => boolean
  ) {
    this.resolvers = resolvers;
  }

  async resolve(packageId: string, options?: ResolveOptions): Promise<PackageResolution> {
    // verifyPublished must be part of the key: two same-tick calls for the same
    // id and loadContent but different verifyPublished would otherwise collide,
    // and whichever resolve() lands in the cache first would satisfy both —
    // silently skipping the publish-status probe for the caller that asked for
    // it (#1561). Only when loadContent is falsy, though: the content paths
    // probe unconditionally, so splitting there would double a full content
    // load for two semantically identical calls.
    const loadContent = options?.loadContent ?? false;
    const verifyPublished = loadContent ? false : (options?.verifyPublished ?? false);
    const cacheKey = `${packageId}:${loadContent}:${verifyPublished}`;
    const cached = options?.bypassCache ? undefined : this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const promise = this.resolveUncached(packageId, options);
    this.cache.set(cacheKey, promise);

    // Mutable private packages and online failures must be retried after this in-flight request.
    promise.then(
      (result) => {
        if (
          (this.preferOnlineFor?.(packageId) && (!result.ok || result.repository === 'bundled')) ||
          (result.repository && UNCACHEABLE_REPOSITORIES.has(result.repository))
        ) {
          if (this.cache.get(cacheKey) === promise) {
            this.cache.delete(cacheKey);
          }
        }
      },
      () => this.cache.delete(cacheKey)
    );

    return promise;
  }

  private async resolveUncached(packageId: string, options?: ResolveOptions): Promise<PackageResolution> {
    let lastFailure: PackageResolution | undefined;
    let attemptedDiagnostic: GuideDiagnostic | undefined;

    const [bundled, online, ...remaining] = this.resolvers;
    const resolvers =
      this.preferOnlineFor?.(packageId) && bundled && online ? [online, bundled, ...remaining] : this.resolvers;
    for (const resolver of resolvers) {
      const result = await resolver.resolve(packageId, options);
      if (result.ok) {
        return result;
      }
      lastFailure = result;
      const diagnostic = result.error.diagnostic;
      if (
        diagnostic &&
        diagnostic.reason !== 'namespace-unavailable' &&
        diagnostic.reason !== 'backend-unavailable' &&
        (!attemptedDiagnostic || (isResolutionMiss(attemptedDiagnostic) && !isResolutionMiss(diagnostic)))
      ) {
        attemptedDiagnostic = diagnostic;
      }
    }

    if (lastFailure && !lastFailure.ok && attemptedDiagnostic) {
      return { ...lastFailure, error: { ...lastFailure.error, diagnostic: attemptedDiagnostic } };
    }
    return (
      lastFailure ?? {
        ok: false,
        id: packageId,
        error: { code: 'not-found', message: 'No resolvers configured' },
      }
    );
  }
}

export function createCompositeResolver(pluginConfig: PathfinderPluginConfig): CompositePackageResolver {
  const enabled = isRecommenderEnabled(pluginConfig);
  const resolvers: PackageResolver[] = [
    createBundledResolver(),
    enabled
      ? new RecommenderPackageResolver(getConfigWithDefaults(pluginConfig).recommenderServiceUrl)
      : new OnlineCdnPackageResolver(),
    new AppPlatformPackageResolver(),
  ];
  return new CompositePackageResolver(resolvers, enabled ? isBundledTutorial : undefined);
}
