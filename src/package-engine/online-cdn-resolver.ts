/**
 * Online CDN Package Resolver
 *
 * Resolves bare package IDs against the CDN package index served by the
 * Pathfinder backend (`GET /package-recommendations`). Used as a third tier
 * in the composite resolver when the online recommender is disabled but the
 * browser is online — without it, milestone IDs and recommends/suggests
 * package IDs from CDN guides cannot be resolved (the bundled resolver only
 * knows about the 7 guides shipped with the plugin).
 *
 * @coupling Types: PackageResolver, PackageResolution in package.types.ts
 * @coupling API: GET /package-recommendations served by pkg/plugin/package_recommendations.go
 */

import {
  buildPackageFileUrl,
  fetchOnlinePackageRecommendations,
  type OnlinePackageEntry,
} from '../lib/package-recommendations-client';
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

function failure(
  id: string,
  code: PackageResolutionFailure['error']['code'],
  message: string
): PackageResolutionFailure {
  return { ok: false, id, error: { code, message } };
}

export class OnlineCdnPackageResolver implements PackageResolver {
  async resolve(packageId: string, options?: ResolveOptions): Promise<PackageResolution> {
    let entry: OnlinePackageEntry | undefined;
    let baseUrl = '';

    try {
      const response = await fetchOnlinePackageRecommendations();
      baseUrl = response.baseUrl;
      entry = response.packages.find((p) => p.id === packageId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'index fetch failed';
      return failure(packageId, 'network-error', message);
    }

    if (!entry) {
      return failure(packageId, 'not-found', 'package not in online CDN index');
    }

    const contentUrl = buildPackageFileUrl(baseUrl, entry.path, 'content.json');
    const manifestUrl = buildPackageFileUrl(baseUrl, entry.path, 'manifest.json');

    if (!contentUrl) {
      return failure(packageId, 'not-found', 'invalid base URL or path for online package');
    }

    const resolution: PackageResolutionSuccess = {
      ok: true,
      id: entry.id,
      contentUrl,
      manifestUrl,
      repository: 'online-cdn',
    };

    if (options?.loadContent) {
      const metadataOnly = options.loadContent === 'metadata-only';
      const loaded = await this.loadFromCdn(contentUrl, manifestUrl, packageId, entry.manifest, metadataOnly);
      if (!loaded.ok) {
        return loaded;
      }
      resolution.content = loaded.content;
      resolution.manifest = loaded.manifest;
    } else if (entry.manifest) {
      // Even without explicit loadContent, surface the inlined manifest —
      // resolveDeferredData / processLearningJourneys only need manifest fields.
      const parsed = ManifestJsonObjectSchema.loose().safeParse(entry.manifest);
      if (parsed.success) {
        resolution.manifest = parsed.data as ManifestJson;
      }
    }

    return resolution;
  }

  private async loadFromCdn(
    contentUrl: string,
    manifestUrl: string,
    packageId: string,
    inlinedManifest: Record<string, unknown> | undefined,
    metadataOnly: boolean
  ): Promise<{ ok: true; content?: ContentJson; manifest?: ManifestJson } | PackageResolutionFailure> {
    try {
      let content: ContentJson | undefined;
      if (!metadataOnly) {
        const contentResponse = await fetch(contentUrl);
        if (!contentResponse.ok) {
          return failure(packageId, 'network-error', `Failed to fetch content: HTTP ${contentResponse.status}`);
        }
        const rawContent = await contentResponse.json();
        const contentResult = ContentJsonSchema.safeParse(rawContent);
        if (!contentResult.success) {
          return failure(packageId, 'validation-error', `Invalid content.json: ${contentResult.error.message}`);
        }
        content = contentResult.data as ContentJson;
      }

      // Prefer the inlined manifest from the index — already validated server-side
      // and saves a round-trip. Fall back to fetching manifestUrl if needed.
      let manifest: ManifestJson | undefined;
      if (inlinedManifest) {
        const parsed = ManifestJsonObjectSchema.loose().safeParse(inlinedManifest);
        if (parsed.success) {
          manifest = parsed.data as ManifestJson;
        }
      }
      if (!manifest && manifestUrl) {
        try {
          const manifestResponse = await fetch(manifestUrl);
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

      return { ok: true, content, manifest };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'CDN fetch failed';
      return failure(packageId, 'network-error', message);
    }
  }
}
