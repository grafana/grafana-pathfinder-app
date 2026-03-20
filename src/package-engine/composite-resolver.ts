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
import { RecommenderPackageResolver } from './recommender-resolver';

export class CompositePackageResolver implements PackageResolver {
  private readonly resolvers: PackageResolver[];

  constructor(resolvers: PackageResolver[]) {
    this.resolvers = resolvers;
  }

  async resolve(packageId: string, options?: ResolveOptions): Promise<PackageResolution> {
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
 * 2. Recommender (only when enabled via plugin config)
 */
export function createCompositeResolver(pluginConfig: DocsPluginConfig): CompositePackageResolver {
  const resolvers: PackageResolver[] = [createBundledResolver()];

  if (isRecommenderEnabled(pluginConfig)) {
    const configWithDefaults = getConfigWithDefaults(pluginConfig);
    resolvers.push(new RecommenderPackageResolver(configWithDefaults.recommenderServiceUrl));
  }

  return new CompositePackageResolver(resolvers);
}
