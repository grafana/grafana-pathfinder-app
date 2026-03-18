/**
 * Composite Package Resolver
 *
 * Tries a list of resolvers in order and returns the first successful result.
 * If all resolvers fail, returns the last failure.
 *
 * Usage pattern (bundled-first, recommender-fallback):
 *   new CompositePackageResolver([bundledResolver, recommenderResolver])
 *
 * @coupling Types: PackageResolver, PackageResolution in package.types.ts
 */

import { isRecommenderEnabled, getConfigWithDefaults, type DocsPluginConfig } from '../constants';
import type { PackageResolution, PackageResolver, ResolveOptions } from '../types/package.types';
import { BundledPackageResolver, createBundledResolver } from './resolver';
import { RecommenderPackageResolver } from './recommender-resolver';

/**
 * Tries each resolver in order; returns the first success.
 * If all resolvers fail, returns the last failure result.
 */
export class CompositePackageResolver implements PackageResolver {
  private readonly resolvers: PackageResolver[];

  constructor(resolvers: PackageResolver[]) {
    if (resolvers.length === 0) {
      throw new Error('CompositePackageResolver requires at least one resolver');
    }
    this.resolvers = resolvers;
  }

  async resolve(packageId: string, options?: ResolveOptions): Promise<PackageResolution> {
    let lastResult: PackageResolution | undefined;

    for (const resolver of this.resolvers) {
      const result = await resolver.resolve(packageId, options);
      if (result.ok) {
        return result;
      }
      lastResult = result;
    }

    // All resolvers failed — return the last failure (guaranteed to exist since resolvers.length > 0)
    return lastResult!;
  }
}

/**
 * Factory: create a composite resolver appropriate for the current plugin config.
 *
 * Resolution order:
 * 1. BundledPackageResolver — always included (offline/OSS baseline)
 * 2. RecommenderPackageResolver — only when recommender is enabled in plugin settings
 *
 * Bundled content wins for any package that exists locally, providing offline
 * and OSS support without a network call.
 */
export function createCompositeResolver(pluginConfig: DocsPluginConfig = {}): CompositePackageResolver {
  const bundledResolver: BundledPackageResolver = createBundledResolver();
  const resolvers: PackageResolver[] = [bundledResolver];

  if (isRecommenderEnabled(pluginConfig)) {
    const { recommenderServiceUrl } = getConfigWithDefaults(pluginConfig);
    resolvers.push(new RecommenderPackageResolver(recommenderServiceUrl));
  }

  return new CompositePackageResolver(resolvers);
}
