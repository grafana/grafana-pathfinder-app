import type { GuideDiagnostic, GuideLoadContext } from '../types/guide-diagnostics.types';
import { diagnoseGuideError } from '../lib/guide-diagnostics';
import { fetchGuideResource, finishGuideLoad } from '../lib/telemetry/guide-load';
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

import { fetchOnlinePackageRecommendations } from '../lib/package-recommendations-client';
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
  message: string,
  diagnostic?: GuideDiagnostic
): PackageResolutionFailure {
  return { ok: false, id, error: { code, message, diagnostic } };
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
      const endpoint = new URL(`/api/v1/packages/${encodeURIComponent(packageId)}`, this.baseUrl);

      const response = await fetchGuideResource(
        endpoint.toString(),
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
        },
        options?.loadContext,
        'index'
      );

      if (response.status === 404) {
        const body = await response.json().catch(() => ({}));
        return failure(packageId, 'not-found', body.error || 'package not found', {
          source: 'cdn',
          stage: 'resolve',
          reason: 'not-found',
          statusCode: response.status,
        });
      }

      if (response.status === 400) {
        return failure(packageId, 'not-found', 'invalid package id', {
          source: 'cdn',
          stage: 'resolve',
          reason: 'not-found',
          statusCode: response.status,
        });
      }

      if (!response.ok) {
        return failure(packageId, 'network-error', `HTTP ${response.status}`, {
          source: 'cdn',
          stage: 'resolve',
          reason: 'http-error',
          statusCode: response.status,
        });
      }

      resolutionData = await response.json();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown network error';
      return failure(
        packageId,
        'network-error',
        message,
        diagnoseGuideError(err, 'cdn', err instanceof SyntaxError ? 'decode' : 'fetch')
      );
    }

    const resolution: PackageResolutionSuccess = {
      ok: true,
      id: resolutionData.id,
      contentUrl: resolutionData.contentUrl,
      manifestUrl: resolutionData.manifestUrl,
      repository: resolutionData.repository,
    };

    if (options?.loadContent) {
      const index = await fetchOnlinePackageRecommendations();
      const entry = index.packages.find((p) => p.id === packageId);
      if (entry?.title != null) {
        resolution.entryTitle = entry.title;
      }

      const metadataOnly = options.loadContent === 'metadata-only';
      const loaded = await this.loadFromCdn(resolutionData, packageId, metadataOnly, options.loadContext);
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
    packageId: string,
    metadataOnly = false,
    context?: GuideLoadContext
  ): Promise<{ ok: true; content?: ContentJson; manifest?: ManifestJson } | PackageResolutionFailure> {
    try {
      let content: ContentJson | undefined;
      if (!metadataOnly) {
        const contentResponse = await fetchGuideResource(resolutionData.contentUrl, undefined, context, 'content');
        if (!contentResponse.ok) {
          return failure(packageId, 'network-error', `Failed to fetch content: HTTP ${contentResponse.status}`, {
            source: 'cdn',
            stage: 'fetch',
            reason: 'http-error',
            statusCode: contentResponse.status,
          });
        }
        const rawContent = await contentResponse.json();
        const contentResult = ContentJsonSchema.safeParse(rawContent);
        if (!contentResult.success) {
          return failure(packageId, 'validation-error', 'Invalid content.json', {
            source: 'cdn',
            stage: 'validate',
            reason: 'schema-invalid',
            validationCount: contentResult.error.issues.length,
          });
        }
        content = contentResult.data as ContentJson;
      }

      let manifest: ManifestJson | undefined;
      if (resolutionData.manifestUrl) {
        let diagnostic: GuideDiagnostic | undefined;
        try {
          const manifestResponse = await fetchGuideResource(resolutionData.manifestUrl, undefined, context, 'manifest');
          if (manifestResponse.ok) {
            const rawManifest = await manifestResponse.json();
            const manifestResult = ManifestJsonObjectSchema.loose().safeParse(rawManifest);
            if (manifestResult.success) {
              manifest = manifestResult.data as ManifestJson;
            } else {
              diagnostic = {
                source: 'cdn',
                stage: 'validate',
                reason: 'schema-invalid',
                validationCount: manifestResult.error.issues.length,
              };
            }
          } else {
            diagnostic = { source: 'cdn', stage: 'fetch', reason: 'http-error', statusCode: manifestResponse.status };
          }
        } catch (error) {
          diagnostic = diagnoseGuideError(error, 'cdn');
        }
        if (diagnostic) {
          finishGuideLoad(context, 'degraded', diagnostic);
        }
      }

      return { ok: true, content, manifest };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'CDN fetch failed';
      return failure(
        packageId,
        'network-error',
        message,
        diagnoseGuideError(err, 'cdn', err instanceof SyntaxError ? 'decode' : 'fetch')
      );
    }
  }
}
