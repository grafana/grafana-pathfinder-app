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
 * @coupling API: GET /apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/{ns}/interactiveguides/{name}
 *   — group/version/availability come from utils/interactive-guides-api.ts (GAP).
 * @coupling Catalogue/listing needs (Custom Guides, My Learning) go through the
 *   separate /custom-guide-repository backend proxy instead of this resolver —
 *   a raw per-ID resolve() here doesn't give a cheap way to enumerate packages.
 */

import { config, getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

import { isBackendApiAvailable, itemUrl } from '../utils/interactive-guides-api';
import { logger } from '../lib/logging';

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

// A cheap decline that never issued an upstream request (no namespace, GAP
// toggle off). Untagged, so the composite resolver may negative-cache it —
// re-evaluating a structural decline gains nothing.
function decline(
  id: string,
  code: PackageResolutionFailure['error']['code'],
  message: string
): PackageResolutionFailure {
  return { ok: false, id, error: { code, message } };
}

// A failure from an ACTUAL upstream attempt (not-found, not-published,
// validation, network). Tagged with the repository so the composite resolver
// evicts it — app-platform is mutable, so a member published after a not-found
// must re-resolve rather than stay cached-missing. (Tagging the cheap declines
// above would repeal negative caching for every tier, since app-platform is the
// composite's last resolver and thus its `lastFailure` on any all-miss.)
function attemptedFailure(
  id: string,
  code: PackageResolutionFailure['error']['code'],
  message: string
): PackageResolutionFailure {
  return { ok: false, id, error: { code, message }, repository: APP_PLATFORM_REPOSITORY };
}

type ProbeResult = { ok: true; resource: InteractiveGuideResource } | { ok: false; failure: PackageResolutionFailure };

/**
 * Fetches the guide and applies the same not-found/not-published gate used by
 * the content-loading paths below. Shared so the URL-only path (when asked to
 * verify) and the metadata/content paths enforce identical rules.
 */
async function probePublishedGuide(namespace: string, packageId: string): Promise<ProbeResult> {
  try {
    // SECURITY: itemUrl encodes both namespace and packageId to prevent path
    // traversal (F3) — mirrors fetchBackendInteractive in
    // docs-retrieval/content-fetcher/backend-guide.ts.
    const url = itemUrl(namespace, packageId);
    const response = await lastValueFrom(
      getBackendSrv().fetch<InteractiveGuideResource>({ url, method: 'GET', showErrorAlert: false })
    );
    const resource = response.data;

    if (!resource?.spec) {
      return {
        ok: false,
        failure: attemptedFailure(packageId, 'not-found', `App platform guide "${packageId}" has no spec`),
      };
    }

    // Published-only, matching every other catalogue surface (usePublishedGuides,
    // fetchAppPlatformLearningPaths). Without this a draft member of a published
    // path renders unlocked and opens for every namespace viewer. A draft
    // therefore resolves not-found → renders locked, like an unpublished member.
    if (resource.spec.status !== 'published') {
      return {
        ok: false,
        failure: attemptedFailure(packageId, 'not-found', `App platform guide "${packageId}" is not published`),
      };
    }

    return { ok: true, resource };
  } catch (err) {
    const status = (err as { status?: number })?.status;
    // A 403 (no read permission) is folded into the same not-found result as a
    // missing guide: telling an unauthorized caller "it exists but you can't
    // read it" would leak existence information they aren't entitled to.
    if (status === 404 || status === 403) {
      return {
        ok: false,
        failure: attemptedFailure(packageId, 'not-found', `App platform guide "${packageId}" not found`),
      };
    }
    const message = err instanceof Error ? err.message : 'app platform fetch failed';
    return { ok: false, failure: attemptedFailure(packageId, 'network-error', message) };
  }
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
    // Spread the persisted manifest first, then force BOTH id and repository
    // last. id: a stray spec.manifest.id must not override the package being
    // resolved. repository: the CR shape leaves it optional and the schema
    // defaults it to the public CDN ('interactive-tutorials'); an App Platform
    // guide is always app-platform-sourced, and `repository` is the sole input
    // to the durable completion key (guideSource, completion-identity.ts), so a
    // missing value would mislabel a private guide's provenance.
    const parsed = ManifestJsonObjectSchema.loose().safeParse({
      ...spec.manifest,
      id: packageId,
      repository: APP_PLATFORM_REPOSITORY,
    });
    if (parsed.success) {
      return parsed.data as ManifestJson;
    }
    // A malformed persisted manifest silently falls through to the inferred guide
    // shape below — so a path would render as a plain guide with no milestone
    // chrome and no trace. Log it.
    logger.warn('[app-platform-resolver] spec.manifest failed schema validation; inferring a guide manifest', {
      packageId,
      issues: parsed.error.issues.map((i) => i.message).join('; '),
    });
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
      return decline(packageId, 'not-found', 'No namespace available to resolve app-platform package');
    }

    // GAP gate: when the aggregation toggle is off the interactiveguides API
    // isn't served here, so decline (composite resolver falls through) rather
    // than issue a doomed request.
    if (!isBackendApiAvailable()) {
      return decline(packageId, 'not-found', 'App Platform backend is not available on this instance');
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
      // URL-only mode is a pure string build with no upstream request — fine
      // for callers about to fetch content anyway (they'll hit the same gate
      // there), but not for a caller treating a successful resolve() as the
      // whole answer. verifyPublished opts into the same probe below.
      if (!options?.verifyPublished) {
        return resolution;
      }
      const probe = await probePublishedGuide(namespace, packageId);
      return probe.ok ? resolution : probe.failure;
    }

    const metadataOnly = options.loadContent === 'metadata-only';

    const probe = await probePublishedGuide(namespace, packageId);
    if (!probe.ok) {
      return probe.failure;
    }
    const resource = probe.resource;

    resolution.manifest = buildManifest(packageId, resource.spec);

    if (!metadataOnly) {
      if (!resource.spec?.blocks || !resource.spec.title) {
        return attemptedFailure(
          packageId,
          'validation-error',
          `App platform guide "${packageId}" is missing required fields`
        );
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
  }
}
