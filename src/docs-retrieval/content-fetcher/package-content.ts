import { bundledTutorialContentKey, isBundledTutorial } from '../../lib/bundled-tutorial-identity';
import { identifyGuideLoad } from '../../lib/telemetry/guide-load';
import type { GuideLoadContext } from '../../types/guide-diagnostics.types';
// Package content integration (Phase 4g).
//
// Holds the module-level PackageResolver singleton injected by Tier 3/4 wiring
// and the package-backed fetch paths that compose `fetchContent` with manifest
// milestone resolution. Lives in its own module so the resolver singleton has a
// single home; `fetchContent` itself stays in the orchestrator and is imported
// here (one-directional — the orchestrator never imports back).
import { ContentFetchResult, CoverPageTrack, LearningJourneyMetadata, Milestone } from '../../types/content.types';
import type { ResolvedNavLink } from '../../types/context.types';
import {
  getAllTrackGuideIds,
  getManifestMilestoneIds,
  getManifestTracks,
  getPackageRenderType,
  type ManifestTrack,
} from '../../types/package.types';
import { fetchContent } from '../content-fetcher';
import { resolveOfflinePathContext } from './package-fallback-context';
import { buildBackendGuideContent, type BackendGuideResource } from './backend-guide';
import { injectJourneyExtrasIntoJsonGuide } from './cover-page';
import { logger } from '../../lib/logging';
import { getMilestoneSlug } from '../../lib/learning-journey-url';
import { getPrTestFetchId, withPrTestMarker } from '../../lib/pr-test-marker';
import { readDeclaredStartingLocation } from '../../recovery/starting-location';
import { getPackageResolver, setPackageResolver, setPackageResolverFactory } from './package-resolver-registry';

export { setPackageResolver, setPackageResolverFactory };

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
 * Resolve a bare package ID list into rich Milestone objects via the injected
 * PackageResolver. Each ID is resolved to obtain its contentUrl (used as the
 * navigation URL) and its manifest title. Shared by {@link resolvePackageMilestones}
 * (the always-present Foundations sequence) and {@link resolvePackageTracks}
 * (Path Tracks RFC) so the two never diverge on how a guide ID becomes a
 * cover-page row.
 *
 * Unresolvable IDs (not yet published, or a transient resolver failure) are
 * kept in the list as locked placeholders rather than dropped — a path's
 * members can land at different times (RFC CUSTOM-GUIDE-PACKAGES.md §6.5), so
 * silently vanishing entries would misrepresent the path's real size and
 * break "N of total" counters. Traversal (getNextMilestoneUrl /
 * getPreviousMilestoneUrl) skips locked entries.
 */
async function resolveGuideIdsToMilestones(guideIds: string[], pathSlug?: string): Promise<Milestone[]> {
  const resolver = await getPackageResolver();
  if (!resolver || guideIds.length === 0) {
    return [];
  }

  const settled = await Promise.allSettled(
    guideIds.map((id) => resolver.resolve(id, { loadContent: 'metadata-only' }))
  );

  const milestones: Milestone[] = [];

  for (let i = 0; i < guideIds.length; i++) {
    const result = settled[i]!;
    const id = guideIds[i]!;
    const number = i + 1;

    if (result.status === 'rejected') {
      logger.warn(`[resolveGuideIdsToMilestones] Locking unresolvable guide ${id}`, { reason: result.reason });
      milestones.push({ id, number, title: id, url: '', isActive: false, isLocked: true });
      continue;
    }

    const resolution = result.value;
    if (!resolution.ok) {
      logger.warn(`[resolveGuideIdsToMilestones] Locking unresolvable guide: ${id}`);
      milestones.push({ id, number, title: id, url: '', isActive: false, isLocked: true });
      continue;
    }

    const title = resolution.content?.title ?? resolution.entryTitle ?? resolution.manifest?.description ?? id;
    // Only surface the manifest description as a subtitle when it isn't
    // already doing double duty as the title fallback above.
    const description = resolution.manifest?.description !== title ? resolution.manifest?.description : undefined;
    const estimatedMinutes = resolution.manifest?.estimatedMinutes;
    const startingLocation = readDeclaredStartingLocation(resolution.manifest);

    milestones.push({
      id,
      number,
      title,
      url: resolution.contentUrl,
      isActive: false,
      ...(resolution.manifest != null && { packageManifest: resolution.manifest }),
      ...(resolution.repository != null && { repository: resolution.repository }),
      ...(description != null && { description }),
      ...(typeof estimatedMinutes === 'number' && { estimatedMinutes }),
      ...(startingLocation != null && { startingLocation }),
      ...(pathSlug != null && { websiteUrl: buildMilestoneWebsiteUrl(pathSlug, id) }),
    });
  }

  return milestones;
}

/**
 * Resolve manifest milestone IDs into rich Milestone objects.
 *
 * @param milestoneIds - Bare package IDs from a path manifest's `milestones` array
 * @param pathSlug - Optional path slug for building website URLs
 * @returns Milestone[] suitable for LearningJourneyMetadata and Recommendation.milestones
 */
export async function resolvePackageMilestones(milestoneIds: string[], pathSlug?: string): Promise<Milestone[]> {
  return resolveGuideIdsToMilestones(milestoneIds, pathSlug);
}

/**
 * Resolve a manifest's `tracks` (Path Tracks RFC) into cover-page-ready
 * tracks, each with its own guides resolved through the same per-ID logic
 * `resolvePackageMilestones` uses for the Foundations sequence.
 *
 * @param tracks - A manifest's raw `tracks` entries
 * @param pathSlug - Optional path slug for building each guide's website URL
 */
export async function resolvePackageTracks(tracks: ManifestTrack[], pathSlug?: string): Promise<CoverPageTrack[]> {
  return Promise.all(
    tracks.map(async (track) => ({
      trackId: track.trackId,
      label: track.label,
      milestones: await resolveGuideIdsToMilestones(track.guides, pathSlug),
    }))
  );
}

/**
 * A path's declared tracks, read from the package's own manifest: a caller's
 * manifest may be a slim recommender projection that carries none. Falls
 * back to the caller's manifest only when the package manifest is unavailable.
 * An App Platform caller manifest already is the package's own, and App
 * Platform resolutions are never cached, so it is used as-is.
 */
async function resolvePathTracks(
  manifestId: string,
  callerManifest: Record<string, unknown> | undefined,
  pathSlug?: string
): Promise<{ declared: ManifestTrack[]; resolved: CoverPageTrack[]; authoritative: boolean }> {
  const needsPackageManifest = manifestId !== '' && callerManifest?.repository !== 'app-platform';
  const resolver = needsPackageManifest ? await getPackageResolver() : undefined;
  const resolution = resolver
    ? await resolver.resolve(manifestId, { loadContent: 'metadata-only' }).catch(() => undefined)
    : undefined;
  const declared = getManifestTracks(resolution?.ok && resolution.manifest ? resolution.manifest : callerManifest);
  return {
    declared,
    resolved: declared.length > 0 ? await resolvePackageTracks(declared, pathSlug) : [],
    authoritative: (resolution?.ok && isPathManifest(resolution.manifest)) || Array.isArray(callerManifest?.tracks),
  };
}

/**
 * Resolve bare package IDs (from manifest `recommends`/`suggests`) into
 * {@link ResolvedNavLink} objects so the context panel can display
 * human-readable titles and open packages with the correct type.
 *
 * Unresolvable IDs are silently skipped.
 */
export async function resolvePackageNavLinks(packageIds: string[]): Promise<ResolvedNavLink[]> {
  const resolver = await getPackageResolver();
  if (!resolver || packageIds.length === 0) {
    return [];
  }

  const settled = await Promise.allSettled(
    packageIds.map((id) => resolver.resolve(id, { loadContent: 'metadata-only' }))
  );

  const links: ResolvedNavLink[] = [];

  for (let i = 0; i < packageIds.length; i++) {
    const result = settled[i]!;
    const id = packageIds[i]!;

    if (result.status === 'rejected') {
      logger.warn('[resolvePackageNavLinks] Error resolving package');
      continue;
    }

    const resolution = result.value;
    if (!resolution.ok) {
      logger.warn('[resolvePackageNavLinks] Skipping unresolvable package');
      continue;
    }

    const title = resolution.content?.title ?? resolution.entryTitle ?? resolution.manifest?.description ?? id;
    const manifest: Record<string, unknown> | undefined = resolution.manifest
      ? (resolution.manifest as unknown as Record<string, unknown>)
      : undefined;

    links.push({
      packageId: id,
      title,
      contentUrl: resolution.contentUrl,
      manifest,
      repository: resolution.repository,
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

/**
 * Substitutes a friendly placeholder when a path/journey's own cover content
 * has empty blocks. Without this, the journey chrome gets injected onto
 * nothing and the guide parses to zero elements — a broken cover instead of
 * a milestone list (RFC CUSTOM-GUIDE-PACKAGES.md Appendix A F15).
 *
 * This runtime repair is the only empty-cover protection that actually runs:
 * it applies to every repository (bundled, CDN, App Platform), repairing the
 * cover rather than rejecting the package.
 */
export function ensureNonEmptyCoverContent(jsonContent: string): string {
  try {
    const parsed = JSON.parse(jsonContent) as { blocks?: unknown[]; [key: string]: unknown };
    if (Array.isArray(parsed.blocks) && parsed.blocks.length === 0) {
      return JSON.stringify({
        ...parsed,
        blocks: [
          {
            type: 'markdown',
            // Deliberately untranslated: only reachable on an empty-cover path (a
            // publishing error), and docs-retrieval is a content-transform tier
            // with no i18n wiring. If this stops being an edge case, thread a
            // localized string down from the component layer instead.
            content: 'Cover content is missing for this path. Check back soon, or contact whoever published it.',
          },
        ],
      });
    }
  } catch {
    // Malformed JSON — leave it to the existing downstream error handling.
  }
  return jsonContent;
}

/**
 * An extra independent resolve of a package id, bypassing whatever this
 * SAME request's own earlier resolve of that id already cached. Two call
 * sites need this:
 *  - the path's own id, after both `baseUrlResolution` and the caller's
 *    `knownBaseUrl` come up empty (a direct/deep-link load of a track-only
 *    guide never has a `knownBaseUrl`, since it never goes through a
 *    cover-page click).
 *  - a track guide id left as a locked placeholder by `resolvePackageTracks`,
 *    given one more chance before a load with no `explicitGuideId` falls
 *    back to being classified as the cover page.
 *
 * `bypassCache: true` is required: this call reuses the exact cache key an
 * earlier resolve of the same id already used through the same singleton
 * `CompositePackageResolver`, which preserves a static-tier (bundled/CDN)
 * negative result rather than evicting it on failure. Without this flag,
 * "retry" would silently return the identical already-failed promise.
 *
 * Returns the resolved contentUrl, or `undefined` if this attempt also fails.
 */
async function resolvePackageUrlBypassCache(packageId: string): Promise<string | undefined> {
  const resolver = await getPackageResolver();
  if (!resolver) {
    return undefined;
  }
  try {
    const resolution = await resolver.resolve(packageId, { loadContent: false, bypassCache: true });
    return resolution.ok ? resolution.contentUrl : undefined;
  } catch {
    return undefined;
  }
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
 * @param repository - Resolved source repository, stamped onto `metadata.repository` so completion keys on the true source rather than the manifest default; falls back to the baseUrl resolution's own repository when omitted
 * @param preFetchedContent - Optional content the caller already fetched (avoids re-issuing an identical request)
 * @param explicitGuideId - The manifest guide id this load's click target already carried (a GuideList row, the cover page's CTA — threaded through link-handler.hook.ts / docs-panel.tsx). When present, classification is a direct id lookup against `milestones`/`tracks` instead of comparing resolved URLs — see the comment on `milestoneIndex` below. Absent for loads with no click behind them (the initial cover-page open, a deep link, a bookmark), which fall back to a direct match against each track's own resolved guide URL (with one bypass-cache retry for a track guide whose own resolve failed) rather than any URL comparison against the path's own resolved base.
 * @param knownBaseUrl - The owning path's own base URL, when the caller already has it (docs-panel.tsx carries forward the cover page's own `learningJourney.baseUrl`/`trackMemberBaseUrl` from the tab's outgoing content when a track member is clicked FROM that same cover — the only way a track-exclusive guide is reached WITH a prior cover-page click behind it). Used as a fallback for `trackMemberBaseUrl` when this SAME request's own `baseUrlResolution` fails. A direct or deep-link load has no `knownBaseUrl` either — that case falls through one more time to {@link resolvePackageUrlBypassCache} before falling back to this guide's own `contentUrl`.
 * @param loadContext - Diagnostic context for the guide-load telemetry pipeline. Identified here directly (not only inside `fetchContent`) so a `preFetchedContent` caller — which never calls `fetchContent` at all — still gets its load identified; `identifyGuideLoad` is idempotent (a no-op once `context.source` is no longer `'other'`), so the second identification inside `fetchContent` below is safe.
 */
export async function fetchPackageContent(
  contentUrl: string,
  packageManifest?: Record<string, unknown>,
  preResolvedMilestones?: Milestone[],
  repository?: string,
  preFetchedContent?: ContentFetchResult,
  explicitGuideId?: string,
  knownBaseUrl?: string,
  loadContext?: GuideLoadContext
): Promise<ContentFetchResult> {
  let offlinePath: ReturnType<typeof resolveOfflinePathContext> | undefined;
  const fallbackKey = bundledTutorialContentKey(contentUrl);
  if (!preFetchedContent && !contentUrl.startsWith('bundled:') && fallbackKey.startsWith('bundled:')) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      preFetchedContent = await Promise.race([
        fetchContent(contentUrl, { loadContext }).catch(() => ({ content: null })),
        new Promise<ContentFetchResult>((resolve) => {
          timer = setTimeout(() => resolve({ content: null }), 1_500);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (!preFetchedContent.content) {
      preFetchedContent = await fetchContent(fallbackKey, { loadContext });
      if (isPathManifest(packageManifest)) {
        offlinePath = resolveOfflinePathContext(
          contentUrl,
          packageManifest!,
          preResolvedMilestones,
          repository,
          explicitGuideId,
          knownBaseUrl
        );
        packageManifest = offlinePath.manifest;
        preResolvedMilestones = offlinePath.milestones;
        knownBaseUrl = offlinePath.baseUrl;
        explicitGuideId = offlinePath.loadedGuideId;
        if (preFetchedContent.content) {
          // Member navigation matches the requested URL, regardless of where its content came from.
          preFetchedContent = {
            ...preFetchedContent,
            content: { ...preFetchedContent.content, url: contentUrl },
          };
        }
      } else {
        contentUrl = fallbackKey;
        packageManifest = undefined;
        repository = 'bundled';
      }
    }
  }
  identifyGuideLoad(loadContext, contentUrl);
  const renderType = getPackageRenderType(packageManifest);
  const needsMilestones = renderType === 'learning-journey' && isPathManifest(packageManifest);

  const manifestId = needsMilestones && typeof packageManifest?.id === 'string' ? packageManifest.id : '';
  // Private packages have no public documentation URL.
  const pathSlug =
    manifestId && packageManifest?.repository !== 'app-platform' ? derivePathSlug(manifestId) : undefined;
  const milestoneIds = needsMilestones ? getManifestMilestoneIds(packageManifest) : [];
  const shouldResolveMilestones =
    needsMilestones && (!preResolvedMilestones || preResolvedMilestones.length === 0) && milestoneIds.length > 0;
  // Track-only direct opens need classification even without a cover-page click.
  const tracksEligible = needsMilestones && packageManifest?.type === 'path';

  const [result, unmarkedMilestones, baseUrlResolution, unmarkedPathTracks] = await Promise.all([
    preFetchedContent ?? fetchContent(contentUrl, { loadContext }),
    shouldResolveMilestones && !offlinePath
      ? resolvePackageMilestones(milestoneIds, pathSlug)
      : Promise.resolve(undefined),
    manifestId && !offlinePath
      ? getPackageResolver().then((resolver) =>
          resolver ? resolver.resolve(manifestId, { loadContent: false }).catch(() => undefined) : undefined
        )
      : Promise.resolve(undefined),
    offlinePath
      ? Promise.resolve(offlinePath.pathTracks)
      : tracksEligible
        ? resolvePathTracks(manifestId, packageManifest, pathSlug)
        : Promise.resolve(undefined),
  ]);
  // Derived URLs must retain PR-test isolation from production progress.
  const prTestFetchId = getPrTestFetchId(contentUrl);
  const markForPrTest = (url: string) => (prTestFetchId && url ? withPrTestMarker(url, prTestFetchId) : url);
  const markMilestonesForPrTest = (list: Milestone[]) => list.map((m) => ({ ...m, url: markForPrTest(m.url) }));
  const resolvedMilestones =
    unmarkedMilestones && prTestFetchId ? markMilestonesForPrTest(unmarkedMilestones) : unmarkedMilestones;
  const pathTracks =
    unmarkedPathTracks && prTestFetchId
      ? {
          ...unmarkedPathTracks,
          resolved: unmarkedPathTracks.resolved.map((track) => ({
            ...track,
            milestones: markMilestonesForPrTest(track.milestones),
          })),
        }
      : unmarkedPathTracks;
  const manifestTracks = pathTracks?.declared ?? [];

  if (!result.content) {
    return result;
  }

  const milestones = preResolvedMilestones?.length ? preResolvedMilestones : resolvedMilestones;
  const matchesLoadedMember = (milestone: Milestone) => {
    if (!explicitGuideId) {
      return milestone.url === contentUrl;
    }
    if (milestone.id !== undefined) {
      return milestone.id === explicitGuideId;
    }
    return milestone.url !== undefined && getMilestoneSlug(milestone.url) === explicitGuideId;
  };
  const memberIndex = needsMilestones ? (milestones?.findIndex(matchesLoadedMember) ?? -1) : -1;
  const memberMilestone = memberIndex >= 0 ? milestones?.[memberIndex] : undefined;
  const trackMember = pathTracks?.resolved.flatMap((track) => track.milestones).find(matchesLoadedMember);
  const resolvedMember = memberMilestone ?? trackMember;
  let isMemberLoad =
    resolvedMember !== undefined ||
    Boolean(
      explicitGuideId &&
      (milestoneIds.includes(explicitGuideId) || getAllTrackGuideIds(manifestTracks).includes(explicitGuideId))
    );
  const resolvedRepository =
    repository ??
    (baseUrlResolution?.ok ? baseUrlResolution.repository : undefined) ??
    (offlinePath ? undefined : resolvedMember?.repository);

  let learningJourney: LearningJourneyMetadata | undefined;
  let trackMemberBaseUrl: string | undefined;
  let contentString = result.content.content;

  if (needsMilestones) {
    const tracks = pathTracks?.resolved ?? [];

    if (milestones && milestones.length > 0) {
      // The clicked member ID is authoritative; resolved URLs can differ across delivery sources.
      const milestoneIndex = explicitGuideId
        ? milestoneIds.indexOf(explicitGuideId)
        : milestones.findIndex((m) => m.url === contentUrl);

      let isConfirmedTrackMember =
        milestoneIndex < 0 &&
        (explicitGuideId
          ? getAllTrackGuideIds(manifestTracks).includes(explicitGuideId)
          : tracks.some((track) => track.milestones.some((m) => !m.isLocked && m.url === contentUrl)));

      if (!offlinePath && !explicitGuideId && !isConfirmedTrackMember && milestoneIndex < 0) {
        const lockedTrackGuideIds = tracks
          .flatMap((track) => track.milestones.filter((m) => m.isLocked))
          .map((m) => m.id)
          .filter((id): id is string => id != null);
        if (lockedTrackGuideIds.length > 0) {
          const retriedUrls = await Promise.all(lockedTrackGuideIds.map((id) => resolvePackageUrlBypassCache(id)));
          isConfirmedTrackMember = retriedUrls.some((url) => url !== undefined && markForPrTest(url) === contentUrl);
        }
      }

      isMemberLoad = isMemberLoad || milestoneIndex >= 0 || isConfirmedTrackMember;
      const isCoverPageLoad = milestoneIndex < 0 && !isConfirmedTrackMember;

      if (milestoneIndex >= 0 || isCoverPageLoad) {
        const currentMilestone = milestoneIndex >= 0 ? milestoneIndex + 1 : 0;

        let baseUrl = contentUrl;
        if (milestoneIndex >= 0) {
          baseUrl = baseUrlResolution?.ok
            ? markForPrTest(baseUrlResolution.contentUrl)
            : (knownBaseUrl ?? (offlinePath ? '' : contentUrl));
        }

        learningJourney = {
          currentMilestone,
          totalMilestones: milestones.length,
          milestones,
          ...(offlinePath?.hasUnavailableMilestones && { hasUnavailableMilestones: true }),
          baseUrl,
          summary: result.content.metadata.singleDoc?.summary,
          ...(pathSlug != null && {
            websiteUrl: `https://grafana.com/docs/learning-paths/${pathSlug}/`,
          }),
        };

        if (currentMilestone === 0) {
          if (tracks.length > 0 || pathTracks?.authoritative) {
            learningJourney.tracks = tracks;
          }

          contentString = injectJourneyExtrasIntoJsonGuide(
            ensureNonEmptyCoverContent(contentString),
            learningJourney,
            true
          );
        }
      } else if (baseUrlResolution && baseUrlResolution.ok) {
        trackMemberBaseUrl = markForPrTest(baseUrlResolution.contentUrl);
      } else if (knownBaseUrl) {
        trackMemberBaseUrl = knownBaseUrl;
      } else if (manifestId && !offlinePath) {
        const retriedBaseUrl = await resolvePackageUrlBypassCache(manifestId);
        if (retriedBaseUrl) {
          trackMemberBaseUrl = markForPrTest(retriedBaseUrl);
        } else {
          trackMemberBaseUrl = contentUrl;
          logger.warn(
            `[fetchPackageContent] Could not resolve path base URL for track-only guide; using its own contentUrl as a fallback completion identity: ${contentUrl}`,
            { manifestId }
          );
        }
      }
    }
  }

  let packageManifestMetadata: Record<string, unknown> | undefined;
  const ownStartingLocation =
    readDeclaredStartingLocation(result.content.metadata.packageManifest) ?? (resolvedMember?.startingLocation || null);
  if (isMemberLoad) {
    if (result.content.metadata.packageManifest || resolvedMember?.packageManifest) {
      packageManifestMetadata = {
        ...result.content.metadata.packageManifest,
        ...resolvedMember?.packageManifest,
      };
    }
  } else if (packageManifest !== undefined) {
    packageManifestMetadata = { ...result.content.metadata.packageManifest, ...packageManifest };
  }
  if (ownStartingLocation) {
    packageManifestMetadata = {
      ...(packageManifestMetadata ?? result.content.metadata.packageManifest),
      startingLocation: ownStartingLocation,
    };
  }

  return {
    ...result,
    content: {
      ...result.content,
      ...(loadContext && { loadContext }),
      content: contentString,
      type: renderType,
      metadata: {
        ...result.content.metadata,
        ...(packageManifestMetadata !== undefined && { packageManifest: packageManifestMetadata }),
        ...(isMemberLoad && packageManifest !== undefined && { journeyManifest: packageManifest }),
        ...(resolvedRepository !== undefined && { repository: resolvedRepository }),
        ...(offlinePath && { offlinePathTracks: pathTracks?.resolved }),
        ...(learningJourney !== undefined && { learningJourney }),
        ...(trackMemberBaseUrl !== undefined && { trackMemberBaseUrl }),
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
 * @param repository - Optional explicit source repository; falls back to the resolver's own when omitted
 */
export async function fetchPackageById(
  packageId: string,
  packageManifest?: Record<string, unknown>,
  repository?: string,
  loadContext?: GuideLoadContext
): Promise<ContentFetchResult> {
  const resolver = await getPackageResolver();
  if (!resolver) {
    return {
      content: null,
      error: 'No package resolver configured — call setPackageResolver() first',
      errorType: 'other',
    };
  }

  // Private bare-ID opens must verify publish status; share links intentionally permit drafts.
  const bundledTutorial = isBundledTutorial(packageId);
  const resolution = await resolver.resolve(packageId, {
    loadContent: bundledTutorial,
    verifyPublished: true,
    loadContext,
  });

  if (!resolution.ok) {
    return {
      content: null,
      error: 'Failed to resolve package',
      diagnostic: resolution.error.diagnostic,
      errorType: resolution.error.code === 'not-found' ? 'not-found' : 'other',
    };
  }

  // The probe already GET the resource to read its status; build content from
  // it rather than re-issuing the identical request.
  const preFetched: ContentFetchResult | undefined =
    bundledTutorial && resolution.content
      ? {
          content: {
            content: JSON.stringify(resolution.content),
            metadata: { title: resolution.content.title },
            type: 'interactive',
            url: resolution.contentUrl,
            lastFetched: new Date().toISOString(),
            isNativeJson: true,
          },
        }
      : resolution.probedResource
        ? buildBackendGuideContent(resolution.probedResource as BackendGuideResource, resolution.contentUrl, packageId)
        : undefined;

  return fetchPackageContent(
    resolution.contentUrl,
    bundledTutorial
      ? ((resolution.manifest as Record<string, unknown> | undefined) ?? packageManifest)
      : packageManifest,
    undefined,
    bundledTutorial ? resolution.repository : (repository ?? resolution.repository),
    preFetched,
    undefined,
    undefined,
    loadContext
  );
}
