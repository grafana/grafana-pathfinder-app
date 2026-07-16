// Package content integration (Phase 4g).
//
// Holds the module-level PackageResolver singleton injected by Tier 3/4 wiring
// and the package-backed fetch paths that compose `fetchContent` with manifest
// milestone resolution. Lives in its own module so the resolver singleton has a
// single home; `fetchContent` itself stays in the orchestrator and is imported
// here (one-directional — the orchestrator never imports back).
import { ContentFetchResult, LearningJourneyMetadata, Milestone } from '../../types/content.types';
import type { PackageResolver } from '../../types';
import type { ResolvedNavLink } from '../../types/context.types';
import { getPackageRenderType } from '../../types/package.types';
import { fetchContent } from '../content-fetcher';
import { injectJourneyExtrasIntoJsonGuide } from './cover-page';
import { isEndJourneyUrl } from './url-utils';
import { logger } from '../../lib/logging';

/**
 * Module-level PackageResolver injected at Tier 3+ (docs-panel wires the
 * concrete CompositePackageResolver here so docs-retrieval stays decoupled
 * from the package-engine Tier 2 implementation).
 */
let _packageResolver: PackageResolver | undefined;

/**
 * Inject the PackageResolver implementation into docs-retrieval.
 * Called once at app startup by Tier 3/4 wiring code.
 */
export function setPackageResolver(resolver: PackageResolver): void {
  _packageResolver = resolver;
}

/**
 * Derive the grafana.com/docs/learning-paths/ website URL for a milestone.
 * Convention: the milestone package ID shares a prefix with the path slug,
 * and the remainder becomes the URL leaf segment.
 *
 * Example:
 *   pathSlug = "grafana-cloud-tour"
 *   milestoneId = "grafana-cloud-tour-business-value"
 *   → "https://grafana.com/docs/learning-paths/grafana-cloud-tour/business-value/"
 */
function buildMilestoneWebsiteUrl(pathSlug: string, milestoneId: string): string | undefined {
  const prefix = `${pathSlug}-`;
  if (!milestoneId.startsWith(prefix)) {
    return undefined;
  }
  const slug = milestoneId.slice(prefix.length);
  return `https://grafana.com/docs/learning-paths/${pathSlug}/${slug}/`;
}

/**
 * Derive the path slug from a path-type manifest ID.
 * Strips the conventional `-lj` suffix if present.
 */
export function derivePathSlug(manifestId: string): string {
  return manifestId.endsWith('-lj') ? manifestId.slice(0, -3) : manifestId;
}

/**
 * Resolve manifest milestone IDs into rich Milestone objects via the injected
 * PackageResolver. Each milestone ID is resolved to obtain its contentUrl (used
 * as the navigation URL) and its manifest title. Unresolvable milestones are
 * silently skipped so partial data still renders.
 *
 * @param milestoneIds - Bare package IDs from a path manifest's `milestones` array
 * @param pathSlug - Optional path slug for building website URLs
 * @returns Milestone[] suitable for LearningJourneyMetadata and Recommendation.milestones
 */
export async function resolvePackageMilestones(milestoneIds: string[], pathSlug?: string): Promise<Milestone[]> {
  if (!_packageResolver || milestoneIds.length === 0) {
    return [];
  }

  const settled = await Promise.allSettled(
    milestoneIds.map((id) => _packageResolver!.resolve(id, { loadContent: 'metadata-only' }))
  );

  const milestones: Milestone[] = [];
  let sequenceNumber = 1;

  for (let i = 0; i < milestoneIds.length; i++) {
    const result = settled[i]!;
    const id = milestoneIds[i]!;

    if (result.status === 'rejected') {
      logger.warn(`[resolvePackageMilestones] Error resolving milestone ${id}`, { reason: result.reason });
      continue;
    }

    const resolution = result.value;
    if (!resolution.ok) {
      logger.warn(`[resolvePackageMilestones] Skipping unresolvable milestone: ${id}`);
      continue;
    }

    const title = resolution.content?.title ?? resolution.manifest?.description ?? id;

    milestones.push({
      number: sequenceNumber++,
      title,
      duration: '5-10 min',
      url: resolution.contentUrl,
      isActive: false,
      ...(pathSlug != null && { websiteUrl: buildMilestoneWebsiteUrl(pathSlug, id) }),
    });
  }

  return milestones;
}

/**
 * Resolve bare package IDs (from manifest `recommends`/`suggests`) into
 * {@link ResolvedNavLink} objects so the context panel can display
 * human-readable titles and open packages with the correct type.
 *
 * Unresolvable IDs are silently skipped.
 */
export async function resolvePackageNavLinks(packageIds: string[]): Promise<ResolvedNavLink[]> {
  if (!_packageResolver || packageIds.length === 0) {
    return [];
  }

  const settled = await Promise.allSettled(
    packageIds.map((id) => _packageResolver!.resolve(id, { loadContent: 'metadata-only' }))
  );

  const links: ResolvedNavLink[] = [];

  for (let i = 0; i < packageIds.length; i++) {
    const result = settled[i]!;
    const id = packageIds[i]!;

    if (result.status === 'rejected') {
      logger.warn(`[resolvePackageNavLinks] Error resolving package ${id}`, { reason: result.reason });
      continue;
    }

    const resolution = result.value;
    if (!resolution.ok) {
      logger.warn(`[resolvePackageNavLinks] Skipping unresolvable package: ${id}`);
      continue;
    }

    const title = resolution.content?.title ?? resolution.manifest?.description ?? id;
    const manifest: Record<string, unknown> | undefined = resolution.manifest
      ? (resolution.manifest as unknown as Record<string, unknown>)
      : undefined;

    links.push({
      packageId: id,
      title,
      contentUrl: resolution.contentUrl,
      manifest,
    });
  }

  return links;
}

function isPathManifest(manifest?: Record<string, unknown>): boolean {
  if (!manifest || typeof manifest.type !== 'string') {
    return false;
  }
  return manifest.type === 'path' || manifest.type === 'journey';
}

function getManifestMilestoneIds(manifest?: Record<string, unknown>): string[] {
  if (!manifest || !Array.isArray(manifest.milestones)) {
    return [];
  }
  return manifest.milestones.filter((s): s is string => typeof s === 'string');
}

/**
 * Fetch package content from a pre-resolved contentUrl (CDN or bundled).
 *
 * This is the primary fetch path for package-backed recommendations.
 * The v1 recommender response already carries a resolved contentUrl, so no
 * resolver call is needed — we fetch directly and enrich with manifest metadata.
 *
 * For path/journey packages, also resolves manifest milestones into
 * LearningJourneyMetadata so the docs panel renders the milestone progress
 * bar and arrow navigation.
 *
 * @param contentUrl - Pre-resolved CDN URL or bundled: URL for the content.json
 * @param packageManifest - Optional manifest metadata to attach to the result
 * @param preResolvedMilestones - Optional milestones already resolved by the caller (avoids redundant resolution)
 */
export async function fetchPackageContent(
  contentUrl: string,
  packageManifest?: Record<string, unknown>,
  preResolvedMilestones?: Milestone[]
): Promise<ContentFetchResult> {
  const renderType = getPackageRenderType(packageManifest);
  const needsMilestones = renderType === 'learning-journey' && isPathManifest(packageManifest);

  const manifestId = needsMilestones && typeof packageManifest?.id === 'string' ? packageManifest.id : '';
  const pathSlug = manifestId ? derivePathSlug(manifestId) : undefined;
  const milestoneIds = needsMilestones ? getManifestMilestoneIds(packageManifest) : [];
  const shouldResolveMilestones =
    needsMilestones && (!preResolvedMilestones || preResolvedMilestones.length === 0) && milestoneIds.length > 0;

  // Run content fetch, milestone resolution, and baseUrl resolution in
  // parallel. These are independent: the page body doesn't need milestones
  // and milestones don't need the page body.
  const [result, resolvedMilestones, baseUrlResolution] = await Promise.all([
    fetchContent(contentUrl),
    shouldResolveMilestones ? resolvePackageMilestones(milestoneIds, pathSlug) : Promise.resolve(undefined),
    manifestId && _packageResolver
      ? _packageResolver.resolve(manifestId, { loadContent: false }).catch(() => undefined)
      : Promise.resolve(undefined),
  ]);

  if (!result.content) {
    return result;
  }

  let learningJourney: LearningJourneyMetadata | undefined;
  let contentString = result.content.content;

  if (needsMilestones) {
    const milestones = preResolvedMilestones?.length ? preResolvedMilestones : resolvedMilestones;

    if (milestones && milestones.length > 0) {
      const milestoneIndex = milestones.findIndex((m) => m.url === contentUrl);
      // end-journey pages are not in the manifest list but mean the journey
      // finished — resolve to the last milestone so completion reads 100%.
      const currentMilestone =
        milestoneIndex >= 0 ? milestoneIndex + 1 : isEndJourneyUrl(contentUrl) ? milestones.length : 0;

      let baseUrl = contentUrl;
      if (milestoneIndex >= 0 && baseUrlResolution && baseUrlResolution.ok) {
        baseUrl = baseUrlResolution.contentUrl;
      }

      learningJourney = {
        currentMilestone,
        totalMilestones: milestones.length,
        milestones,
        baseUrl,
        summary: result.content.metadata.singleDoc?.summary,
        ...(pathSlug != null && {
          websiteUrl: `https://grafana.com/docs/learning-paths/${pathSlug}/`,
        }),
      };

      if (currentMilestone === 0) {
        contentString = injectJourneyExtrasIntoJsonGuide(contentString, learningJourney);
      }
    }
  }

  return {
    ...result,
    content: {
      ...result.content,
      content: contentString,
      type: renderType,
      metadata: {
        ...result.content.metadata,
        ...(packageManifest !== undefined && { packageManifest }),
        ...(learningJourney !== undefined && { learningJourney }),
      },
    },
  };
}

/**
 * Fetch package content by bare package ID using the injected PackageResolver.
 * Used for deep links and milestone navigation where only an ID is available.
 *
 * Requires setPackageResolver() to have been called first.
 *
 * @param packageId - Bare package ID (e.g., "alerting-101")
 * @param packageManifest - Optional manifest metadata to attach to the result
 */
export async function fetchPackageById(
  packageId: string,
  packageManifest?: Record<string, unknown>
): Promise<ContentFetchResult> {
  if (!_packageResolver) {
    return {
      content: null,
      error: 'No package resolver configured — call setPackageResolver() first',
      errorType: 'other',
    };
  }

  const resolution = await _packageResolver.resolve(packageId, { loadContent: false });

  if (!resolution.ok) {
    return {
      content: null,
      error: `Failed to resolve package: ${packageId}`,
      errorType: resolution.error.code === 'not-found' ? 'not-found' : 'other',
    };
  }

  return fetchPackageContent(resolution.contentUrl, packageManifest);
}
