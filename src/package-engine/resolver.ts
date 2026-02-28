/**
 * Bundled Package Resolver
 *
 * Implements PackageResolver for bundled content shipped with the plugin.
 * Reads the bundled repository.json to build an in-memory lookup and
 * resolves bare package IDs to content/manifest URLs.
 *
 * Repositories are internal — the resolver manages them, callers only
 * see resolved PackageResolution results.
 *
 * @coupling Types: PackageResolver, PackageResolution in package.types.ts
 * @coupling Loader: loader.ts for content fetching
 */

import type {
  ContentJson,
  ManifestJson,
  PackageResolution,
  PackageResolutionFailure,
  PackageResolutionSuccess,
  PackageResolver,
  RepositoryJson,
  ResolveOptions,
} from '../types/package.types';

import { loadBundledContent, loadBundledManifest } from './loader';

const BUNDLED_REPOSITORY = 'bundled';

function notFound(id: string, message: string): PackageResolutionFailure {
  return { ok: false, id, error: { code: 'not-found', message } };
}

/**
 * PackageResolver backed by the bundled repository.json shipped with the plugin.
 * Single resolution tier — future phases add static catalog and registry tiers.
 */
export class BundledPackageResolver implements PackageResolver {
  private readonly repository: RepositoryJson;

  constructor(repository: RepositoryJson) {
    this.repository = repository;
  }

  async resolve(packageId: string, options?: ResolveOptions): Promise<PackageResolution> {
    if (!Object.hasOwn(this.repository, packageId)) {
      return notFound(packageId, `Package "${packageId}" not found in bundled repository`);
    }

    const entry = this.repository[packageId]!;

    const basePath = entry.path;
    // Scheme is internal to the package-engine loader; not a docs-retrieval URL.
    const contentUrl = `bundled:${basePath}content.json`;
    const manifestUrl = `bundled:${basePath}manifest.json`;

    const resolution: PackageResolutionSuccess = {
      ok: true,
      id: packageId,
      contentUrl,
      manifestUrl,
      repository: BUNDLED_REPOSITORY,
    };

    if (options?.loadContent) {
      const loadResult = await this.loadPackageContent(basePath, packageId);
      if (!loadResult.ok) {
        return loadResult;
      }
      resolution.content = loadResult.content;
      resolution.manifest = loadResult.manifest;
    }

    return resolution;
  }

  private async loadPackageContent(
    basePath: string,
    packageId: string
  ): Promise<{ ok: true; content: ContentJson; manifest?: ManifestJson } | PackageResolutionFailure> {
    const contentResult = loadBundledContent(basePath);
    if (!contentResult.ok) {
      return {
        ok: false,
        id: packageId,
        error: contentResult.error,
      };
    }

    const manifestResult = loadBundledManifest(basePath);

    if (!manifestResult.ok && manifestResult.error.code !== 'not-found') {
      return { ok: false, id: packageId, error: manifestResult.error };
    }

    return {
      ok: true,
      content: contentResult.data,
      manifest: manifestResult.ok ? manifestResult.data : undefined,
    };
  }

  /** All package IDs available in this resolver's repository. */
  listPackageIds(): string[] {
    return Object.keys(this.repository);
  }

  /** Check whether a package ID exists in the bundled repository. */
  has(packageId: string): boolean {
    return Object.hasOwn(this.repository, packageId);
  }

  /** Direct access to the underlying repository data. */
  getRepository(): Readonly<RepositoryJson> {
    return this.repository;
  }
}

/**
 * Create a resolver backed by the bundled repository.json.
 * This is the primary entry point for consumers during Phase 3.
 */
export function createBundledResolver(): BundledPackageResolver {
  const repositoryData: unknown = require('../bundled-interactives/repository.json');
  return new BundledPackageResolver(repositoryData as RepositoryJson);
}
