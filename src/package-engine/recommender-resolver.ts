/**
 * Recommender Package Resolver
 *
 * Implements PackageResolver for by-ID loading via the recommender's
 * GET /api/v1/packages/{id} endpoint. Used for deep links, milestone
 * navigation, or any case where the frontend needs a specific package
 * by bare ID outside the recommendation flow.
 *
 * @coupling Types: PackageResolver, PackageResolution in package.types.ts
 * @coupling API: GET /api/v1/packages/{id} in grafana-recommender openapi.yaml
 */

import { ContentJsonSchema, ManifestJsonObjectSchema } from '../types/package.schema';
import type {
  ContentJson,
  ManifestJson,
  PackageResolution,
  PackageResolutionFailure,
  PackageResolutionSuccess,
  PackageResolver,
  ResolveOptions,
} from '../types/package.types';
import type { V1PackageResolutionResponse } from '../types/v1-recommender.types';

function failure(
  id: string,
  code: PackageResolutionFailure['error']['code'],
  message: string
): PackageResolutionFailure {
  return { ok: false, id, error: { code, message } };
}

/**
 * PackageResolver backed by the recommender's resolution endpoint.
 * Pure lookup: bare ID in, CDN URLs out. Content is fetched directly from CDN.
 */
export class RecommenderPackageResolver implements PackageResolver {
  private readonly baseUrl: string;

  constructor(recommenderBaseUrl: string) {
    this.baseUrl = recommenderBaseUrl;
  }

  async resolve(packageId: string, options?: ResolveOptions): Promise<PackageResolution> {
    let resolutionData: V1PackageResolutionResponse;
    try {
      // SECURITY: Construct URL safely using URL API (F3)
      const endpoint = new URL(`/api/v1/packages/${encodeURIComponent(packageId)}`, this.baseUrl);

      const response = await fetch(endpoint.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (response.status === 404) {
        const body = await response.json().catch(() => ({}));
        return failure(packageId, 'not-found', body.error || 'package not found');
      }

      if (response.status === 400) {
        return failure(packageId, 'not-found', 'invalid package id');
      }

      if (!response.ok) {
        return failure(packageId, 'network-error', `HTTP ${response.status}`);
      }

      resolutionData = await response.json();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown network error';
      return failure(packageId, 'network-error', message);
    }

    const resolution: PackageResolutionSuccess = {
      ok: true,
      id: resolutionData.id,
      contentUrl: resolutionData.contentUrl,
      manifestUrl: resolutionData.manifestUrl,
      repository: resolutionData.repository,
    };

    if (options?.loadContent) {
      const loaded = await this.loadFromCdn(resolutionData, packageId);
      if (!loaded.ok) {
        return loaded;
      }
      resolution.content = loaded.content;
      resolution.manifest = loaded.manifest;
    }

    return resolution;
  }

  private async loadFromCdn(
    resolutionData: V1PackageResolutionResponse,
    packageId: string
  ): Promise<{ ok: true; content: ContentJson; manifest?: ManifestJson } | PackageResolutionFailure> {
    try {
      const contentResponse = await fetch(resolutionData.contentUrl);
      if (!contentResponse.ok) {
        return failure(packageId, 'network-error', `Failed to fetch content: HTTP ${contentResponse.status}`);
      }
      const rawContent = await contentResponse.json();
      const contentResult = ContentJsonSchema.safeParse(rawContent);
      if (!contentResult.success) {
        return failure(packageId, 'validation-error', `Invalid content.json: ${contentResult.error.message}`);
      }

      let manifest: ManifestJson | undefined;
      if (resolutionData.manifestUrl) {
        try {
          const manifestResponse = await fetch(resolutionData.manifestUrl);
          if (manifestResponse.ok) {
            const rawManifest = await manifestResponse.json();
            const manifestResult = ManifestJsonObjectSchema.loose().safeParse(rawManifest);
            if (manifestResult.success) {
              manifest = manifestResult.data as ManifestJson;
            }
          }
        } catch {
          // Manifest loading is optional — continue without it
        }
      }

      return { ok: true, content: contentResult.data as ContentJson, manifest };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'CDN fetch failed';
      return failure(packageId, 'network-error', message);
    }
  }
}
