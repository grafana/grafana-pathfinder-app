/**
 * Composite Package Resolver
 *
 * Combines multiple PackageResolver implementations into a single resolver.
 * Resolution order: bundled first, recommender second. Bundled content
 * always wins for packages that exist locally, providing offline/OSS support.
 *
 * The composite preserves the PackageResolver interface — callers don't
 * know which tier resolved.
 *
 * @coupling Types: PackageResolver, PackageResolution in package.types.ts
 * @coupling Config: isRecommenderEnabled in constants.ts
 */

import { type DocsPluginConfig, isRecommenderEnabled, getConfigWithDefaults } from '../constants';
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

export class CompositePackageResolver implements PackageResolver {
  private readonly resolvers: PackageResolver[];
  private readonly cache = new Map<string, Promise<PackageResolution>>();

  constructor(resolvers: PackageResolver[]) {
    this.resolvers = resolvers;
  }

  async resolve(packageId: string, options?: ResolveOptions): Promise<PackageResolution> {
    const cacheKey = `${packageId}:${options?.loadContent ?? false}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const promise = this.resolveUncached(packageId, options);
    this.cache.set(cacheKey, promise);

    // App Platform is a mutable repository (§6.8) — a successful resolution
    // must never be served stale on a later call. Evict right after it
    // settles: truly concurrent callers still share this in-flight promise
    // (dedup preserved), but the next call re-fetches fresh. The `.catch()`
    // only silences this derived promise — a thrown/rejected `promise` still
    // propagates normally to whoever awaits the `resolve()` call itself.
    promise
      .then((result) => {
        if (result.ok && UNCACHEABLE_REPOSITORIES.has(result.repository)) {
          this.cache.delete(cacheKey);
        }
      })
      .catch(() => {});

    return promise;
  }

  private async resolveUncached(packageId: string, options?: ResolveOptions): Promise<PackageResolution> {
    let lastFailure: PackageResolution | undefined;

    for (const resolver of this.resolvers) {
      const result = await resolver.resolve(packageId, options);
      if (result.ok) {
        return result;
      }
      lastFailure = result;
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

/**
 * Create the standard composite resolver for the plugin:
 * 1. Bundled content (always present, works offline/OSS)
 * 2. Online recommender (when enabled) — preferred for stack-aware resolution
 * 3. Online CDN index (when recommender disabled) — lets bare IDs from CDN
 *    learning journeys (milestones, recommends, suggests) resolve so the
 *    rich rendering matches the recommender-on experience.
 * 4. App Platform (always last) — private, namespace-scoped custom guides.
 *    Bundled/CDN win any ID collision so today's fallback behavior is
 *    preserved; private guide IDs are expected to carry an `fe-`-style
 *    prefix by convention to make collisions vanishingly unlikely.
 */
export function createCompositeResolver(pluginConfig: DocsPluginConfig): CompositePackageResolver {
  const resolvers: PackageResolver[] = [createBundledResolver()];

  if (isRecommenderEnabled(pluginConfig)) {
    const configWithDefaults = getConfigWithDefaults(pluginConfig);
    resolvers.push(new RecommenderPackageResolver(configWithDefaults.recommenderServiceUrl));
  } else {
    resolvers.push(new OnlineCdnPackageResolver());
  }

  resolvers.push(new AppPlatformPackageResolver());

  return new CompositePackageResolver(resolvers);
}
