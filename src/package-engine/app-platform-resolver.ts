/**
 * App Platform Package Resolver
 *
 * Resolves bare package IDs against private, namespace-scoped InteractiveGuide
 * CRDs served by the Pathfinder backend's App Platform aggregator. Reads the
 * resource directly via getBackendSrv() — session-authenticated, so a
 * resolution can only ever return resources the caller's session is already
 * authorized to read (no new credential store, no cross-tenant surface).
 *
 * Unlike the bundled/CDN resolvers, this repository is mutable — guides are
 * edited in place — so the composite resolver must not memoize successful
 * resolutions from here (see CompositePackageResolver's repository check).
 *
 * @coupling Types: PackageResolver, PackageResolution in package.types.ts
 * @coupling API: GET /apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/{ns}/interactiveguides/{name}
 * @coupling Catalogue/listing needs (Custom Guides, My Learning) go through the
 *   separate /custom-guide-repository backend proxy instead of this resolver —
 *   a raw per-ID resolve() here doesn't give a cheap way to enumerate packages.
 */

import { config, getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

import { ManifestJsonObjectSchema } from '../types/package.schema';
import type {
  ContentJson,
  ManifestJson,
  PackageResolution,
  PackageResolutionFailure,
  PackageResolutionSuccess,
  PackageResolver,
  ResolveOptions,
} from '../types/package.types';
import type { JsonBlock } from '../types/json-guide.types';

const APP_PLATFORM_REPOSITORY = 'app-platform';

interface InteractiveGuideResource {
  metadata?: {
    name?: string;
  };
  spec?: {
    id?: string;
    title?: string;
    schemaVersion?: string;
    status?: string;
    blocks?: unknown[];
    manifest?: Record<string, unknown>;
  };
}

function failure(
  id: string,
  code: PackageResolutionFailure['error']['code'],
  message: string
): PackageResolutionFailure {
  return { ok: false, id, error: { code, message } };
}

/**
 * Builds the manifest for a resolution: the persisted spec.manifest when
 * present, otherwise an inferred `{ id, type: 'guide', repository: 'app-platform' }`
 * so legacy content-only guides stay loadable with no migration event (RFC §6.5).
 *
 * spec.title is mapped into the inferred manifest's `description` — milestone
 * resolution runs metadata-only (no `content`), so the label chain
 * (`content?.title ?? manifest?.description ?? id`) would otherwise fall back
 * to the bare package ID instead of a human-readable title (RFC Appendix A3).
 */
function buildManifest(packageId: string, spec: InteractiveGuideResource['spec']): ManifestJson {
  if (spec?.manifest) {
    const parsed = ManifestJsonObjectSchema.loose().safeParse({ id: packageId, ...spec.manifest });
    if (parsed.success) {
      return parsed.data as ManifestJson;
    }
  }

  return {
    id: packageId,
    type: 'guide',
    repository: APP_PLATFORM_REPOSITORY,
    description: spec?.title,
  };
}

export class AppPlatformPackageResolver implements PackageResolver {
  async resolve(packageId: string, options?: ResolveOptions): Promise<PackageResolution> {
    const namespace = config.namespace;
    if (!namespace) {
      return failure(packageId, 'not-found', 'No namespace available to resolve app-platform package');
    }

    // Scheme is internal to the package-engine/docs-retrieval loader pipeline,
    // not a leaked App Platform detail. manifestUrl is deliberately opaque —
    // the manifest itself is already inlined on the resolution, so nothing
    // dereferences this URL; it exists only to satisfy the resolution contract.
    const contentUrl = `backend-guide:${packageId}`;
    const manifestUrl = `app-platform:${namespace}/${packageId}`;

    const resolution: PackageResolutionSuccess = {
      ok: true,
      id: packageId,
      contentUrl,
      manifestUrl,
      repository: APP_PLATFORM_REPOSITORY,
    };

    if (!options?.loadContent) {
      return resolution;
    }

    const metadataOnly = options.loadContent === 'metadata-only';

    try {
      // SECURITY: encode packageId to prevent path traversal (F3) — mirrors
      // fetchBackendInteractive in docs-retrieval/content-fetcher/backend-guide.ts.
      const url = `/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/${namespace}/interactiveguides/${encodeURIComponent(packageId)}`;
      const response = await lastValueFrom(
        getBackendSrv().fetch<InteractiveGuideResource>({ url, method: 'GET', showErrorAlert: false })
      );
      const resource = response.data;

      if (!resource?.spec) {
        return failure(packageId, 'not-found', `App platform guide "${packageId}" has no spec`);
      }

      resolution.manifest = buildManifest(packageId, resource.spec);

      if (!metadataOnly) {
        if (!resource.spec.blocks || !resource.spec.title) {
          return failure(packageId, 'validation-error', `App platform guide "${packageId}" is missing required fields`);
        }
        const content: ContentJson = {
          id: resource.spec.id || resource.metadata?.name || packageId,
          title: resource.spec.title,
          schemaVersion: resource.spec.schemaVersion || '1.0',
          blocks: resource.spec.blocks as JsonBlock[],
        };
        resolution.content = content;
      }

      return resolution;
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 404) {
        return failure(packageId, 'not-found', `App platform guide "${packageId}" not found`);
      }
      const message = err instanceof Error ? err.message : 'app platform fetch failed';
      return failure(packageId, 'network-error', message);
    }
  }
}
