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
  getManifestTracks,
  getPackageRenderType,
  type ManifestTrack,
} from '../../types/package.types';
import { fetchContent } from '../content-fetcher';
import { buildBackendGuideContent, type BackendGuideResource } from './backend-guide';
import { injectJourneyExtrasIntoJsonGuide } from './cover-page';
import { logger } from '../../lib/logging';
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
    const startingLocation = resolution.manifest?.startingLocation;

    milestones.push({
      id,
      number,
      title,
      url: resolution.contentUrl,
      isActive: false,
      ...(description != null && { description }),
      ...(typeof estimatedMinutes === 'number' && { estimatedMinutes }),
      ...(typeof startingLocation === 'string' && { startingLocation }),
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
      logger.warn(`[resolvePackageNavLinks] Error resolving package ${id}`, { reason: result.reason });
      continue;
    }

    const resolution = result.value;
    if (!resolution.ok) {
      logger.warn(`[resolvePackageNavLinks] Skipping unresolvable package: ${id}`);
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

function getManifestMilestoneIds(manifest?: Record<string, unknown>): string[] {
  if (!manifest || !Array.isArray(manifest.milestones)) {
    return [];
  }
  return manifest.milestones.filter((s): s is string => typeof s === 'string');
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
 * One extra independent resolve of a path's own id, tried only after both
 * this request's own `baseUrlResolution` and the caller's `knownBaseUrl` have
 * come up empty (moxious review, "track-only-parent-resolution-loses-
 * completion"): a direct or deep-link load of a track-only guide never goes
 * through a cover-page click, so it never gets a `knownBaseUrl` either — the
 * two-attempt budget this function otherwise has is entirely spent by then.
 * Returns the resolved contentUrl, or `undefined` if this attempt also fails.
 */
async function retryTrackMemberBaseUrlResolution(manifestId: string): Promise<string | undefined> {
  const resolver = await getPackageResolver();
  if (!resolver) {
    return undefined;
  }
  try {
    const resolution = await resolver.resolve(manifestId, { loadContent: false });
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
 * @param explicitGuideId - The manifest guide id this load's click target already carried (GuideList's current row, the cover page's CTA — threaded through link-handler.hook.ts / docs-panel.tsx). When present, classification is a direct id lookup against `milestones`/`tracks` instead of comparing resolved URLs — see the comment on `milestoneIndex` below. Absent for loads with no click behind them (the initial cover-page open, a deep link, a bookmark), which fall back to the same URL-comparison heuristic this replaced for the common case.
 * @param knownBaseUrl - The owning path's own base URL, when the caller already has it (docs-panel.tsx carries forward the cover page's own `learningJourney.baseUrl`/`trackMemberBaseUrl` from the tab's outgoing content when a track member is clicked FROM that same cover — the only way a track-exclusive guide is reached WITH a prior cover-page click behind it). Used as a fallback for `trackMemberBaseUrl` when this SAME request's own `baseUrlResolution` fails. A direct or deep-link load has no `knownBaseUrl` either — that case falls through one more time to {@link retryTrackMemberBaseUrlResolution} before this guide's completion is dropped for real.
 */
export async function fetchPackageContent(
  contentUrl: string,
  packageManifest?: Record<string, unknown>,
  preResolvedMilestones?: Milestone[],
  repository?: string,
  preFetchedContent?: ContentFetchResult,
  explicitGuideId?: string,
  knownBaseUrl?: string
): Promise<ContentFetchResult> {
  const renderType = getPackageRenderType(packageManifest);
  const needsMilestones = renderType === 'learning-journey' && isPathManifest(packageManifest);

  const manifestId = needsMilestones && typeof packageManifest?.id === 'string' ? packageManifest.id : '';
  // Only public packages have a grafana.com docs page. Suppressing the slug for
  // private App Platform paths here keeps every downstream websiteUrl synthesis
  // (path cover + per-milestone) from fabricating a public URL the toolbar would
  // `window.open` to a 404 and report to analytics (unretractable).
  const pathSlug =
    manifestId && packageManifest?.repository !== 'app-platform' ? derivePathSlug(manifestId) : undefined;
  const milestoneIds = needsMilestones ? getManifestMilestoneIds(packageManifest) : [];
  const shouldResolveMilestones =
    needsMilestones && (!preResolvedMilestones || preResolvedMilestones.length === 0) && milestoneIds.length > 0;
  // Resolved unconditionally, not only for the cover page: currentMilestone
  // below must know whether the loaded URL belongs to a track before it can
  // safely conclude "not in milestones" means "this is the cover page" — a
  // guide referenced only by a track (never by milestones, which the RFC
  // explicitly allows) would otherwise be misclassified as index 0 and
  // render as the path's cover instead of as itself.
  const manifestTracks = needsMilestones ? getManifestTracks(packageManifest) : [];
  const shouldResolveTracks = needsMilestones && manifestTracks.length > 0;

  // Run content fetch, milestone resolution, track resolution, and baseUrl
  // resolution in parallel. These are independent: the page body doesn't
  // need milestones/tracks and milestones/tracks don't need the page body.
  // The baseUrl branch awaits getPackageResolver() itself (rather than a
  // resolver fetched ahead of this array) so a cold resolver's chunk fetch
  // overlaps fetchContent(contentUrl) instead of serializing in front of it.
  const [result, resolvedMilestones, baseUrlResolution, resolvedTracks] = await Promise.all([
    preFetchedContent ?? fetchContent(contentUrl),
    shouldResolveMilestones ? resolvePackageMilestones(milestoneIds, pathSlug) : Promise.resolve(undefined),
    manifestId
      ? getPackageResolver().then((resolver) =>
          resolver ? resolver.resolve(manifestId, { loadContent: false }).catch(() => undefined) : undefined
        )
      : Promise.resolve(undefined),
    shouldResolveTracks ? resolvePackageTracks(manifestTracks, pathSlug) : Promise.resolve(undefined),
  ]);

  if (!result.content) {
    return result;
  }

  const resolvedRepository = repository ?? (baseUrlResolution?.ok ? baseUrlResolution.repository : undefined);

  let learningJourney: LearningJourneyMetadata | undefined;
  // Set only for a track-only member (see the isTrackOnlyMember branch
  // below) — carries just enough for recordGuideCompletionForSurface to
  // route its completion write through milestoneCompletionStorage under
  // this guide's own identity, without resurrecting a fake milestone index.
  let trackMemberBaseUrl: string | undefined;
  let contentString = result.content.content;

  if (needsMilestones) {
    const milestones = preResolvedMilestones?.length ? preResolvedMilestones : resolvedMilestones;
    const tracks = resolvedTracks ?? [];

    if (milestones && milestones.length > 0) {
      // Structural classification: a direct id lookup against the manifest's
      // own `milestones`/`tracks` arrays, not a comparison of resolved URLs.
      // Four review rounds broke a different case each time under the old
      // URL-comparison approach (guide-loads-as-cover-page, a -1 sentinel,
      // a skipped completion write, a resolve failure misclassified as the
      // cover, then an ordinary cover misclassified as a track member) —
      // every one of those was a symptom of inferring identity from a
      // side-channel (a resolved URL) instead of checking the identity
      // itself. `explicitGuideId` IS that identity, threaded straight from
      // the click target (GuideList's current row, the cover page's CTA —
      // see Milestone.id's own doc comment) through link-handler.hook.ts and
      // docs-panel.tsx, so this is a plain string membership check against
      // `milestoneIds`/`manifestTracks` — both raw manifest data, already in
      // scope, no resolve involved.
      const milestoneIndex = explicitGuideId
        ? milestoneIds.indexOf(explicitGuideId)
        : milestones.findIndex((m) => m.url === contentUrl);

      // Only reachable with no `explicitGuideId` to check structurally
      // against — a load with no click behind it (the initial cover-page
      // open, a deep link, a bookmark). Two independent signals, either one
      // enough to positively rule out the cover page, because each can
      // independently fail on its own resolve:
      //  1. contentUrl matches a track's own resolved guide URL. Alone, this
      //     misclassified a track-only guide as the cover page whenever ITS
      //     OWN re-resolve (via resolvePackageTracks, run fresh on every
      //     applicable fetch) failed or returned a differently-shaped URL
      //     (a locked placeholder's url is '', not this guide's real one).
      //  2. baseUrlResolution (this SAME request's own resolve of the path's
      //     manifestId) succeeded and gave a URL that is NOT this load's
      //     contentUrl. Alone, this misclassified the REAL cover page as an
      //     unresolvable track member whenever THIS resolve failed/rejected.
      // Neither signal is reliable alone; together, each covers the other's
      // failure mode. When neither can confirm a track member, this defaults
      // to being the cover page — the same default this branch used before
      // tracks existed.
      const isConfirmedTrackMember =
        milestoneIndex < 0 &&
        (explicitGuideId
          ? getAllTrackGuideIds(manifestTracks).includes(explicitGuideId)
          : tracks.some((track) => track.milestones.some((m) => m.url === contentUrl)) ||
            (baseUrlResolution?.ok && baseUrlResolution.contentUrl !== contentUrl));
      const isCoverPageLoad = milestoneIndex < 0 && !isConfirmedTrackMember;

      // A guide that is neither a milestone nor the cover page isn't part of
      // the Foundations sequence a track is layered on top of
      // (COMPLETION-MODEL.md: a track is a presentation ordering only, not a
      // second completion authority) — it has no real position in
      // `milestones` to report. Earlier this synthesized a -1 sentinel
      // currentMilestone to dodge the cover-page branch below, but that
      // sentinel leaked into every consumer that assumes any non-zero value
      // is a real step: the docs-panel step label showed "Step -1 of N",
      // Previous stayed disabled, and Next jumped into Foundations module 1.
      // Leaving learningJourney undefined instead — the same, already-
      // supported state a path with zero resolved milestones produces —
      // renders this guide as a plain guide: no Foundations step label, no
      // Previous/Next milestone arrows. trackMemberBaseUrl below is what
      // keeps its completion write alive despite that (see its own doc
      // comment in content.types.ts): without it, a second bug — this
      // guide's completion never reaching milestoneCompletionStorage at
      // all — would replace the one this branch fixes.
      if (milestoneIndex >= 0 || isCoverPageLoad) {
        const currentMilestone = milestoneIndex >= 0 ? milestoneIndex + 1 : 0;

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
          // pathSlug is already suppressed for private packages at derivation, so a
          // non-null slug means this is a public path with a grafana.com docs page.
          ...(pathSlug != null && {
            websiteUrl: `https://grafana.com/docs/learning-paths/${pathSlug}/`,
          }),
        };

        if (currentMilestone === 0) {
          if (tracks.length > 0) {
            learningJourney.tracks = tracks;
          }

          // skipReadyToBegin: true — the React cover-page TOC (LearningPathTableOfContents)
          // renders its own Start/Resume CTA against real progress data; the
          // legacy HTML button always says "Ready to Begin" and always targets
          // milestone 1, so leaving both on would show two conflicting CTAs.
          contentString = injectJourneyExtrasIntoJsonGuide(
            ensureNonEmptyCoverContent(contentString),
            learningJourney,
            true
          );
        }
      } else if (baseUrlResolution && baseUrlResolution.ok) {
        trackMemberBaseUrl = baseUrlResolution.contentUrl;
      } else if (knownBaseUrl) {
        // This SAME request's own re-resolve of manifestId failed, but the
        // caller already knows the answer (the cover page this guide was
        // just clicked from) — use it rather than dropping the guide's
        // completion entirely for a transient resolver hiccup.
        trackMemberBaseUrl = knownBaseUrl;
      } else if (manifestId) {
        // Neither of the above had an answer — most commonly a direct or
        // deep-link load of a track-only guide, which never went through a
        // cover-page click and so was never given a `knownBaseUrl` (moxious
        // review, "track-only-parent-resolution-loses-completion"). One more
        // independent resolve gives a transient resolver hiccup a second
        // chance before this guide's completion is dropped for real.
        const retriedBaseUrl = await retryTrackMemberBaseUrlResolution(manifestId);
        if (retriedBaseUrl) {
          trackMemberBaseUrl = retriedBaseUrl;
        } else {
          // No fallback value exists even after a retry: this must be the
          // path's own resolved URL, the shared key completion writes and
          // cover-page reads agree on — this guide's own contentUrl would
          // silently write under the wrong key.
          logger.warn(`[fetchPackageContent] Could not resolve path base URL for track-only guide: ${contentUrl}`, {
            manifestId,
          });
        }
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
        // Merge, not replace: a catalogue entry is a slim projection and would
        // otherwise bury fields the loader resolved in full (issue #1681).
        ...(packageManifest !== undefined && {
          packageManifest: { ...result.content.metadata.packageManifest, ...packageManifest },
        }),
        // Fall back to the repository the baseUrl resolution already carries, so
        // an entry path that supplies no explicit one still keys the durable
        // completion on the true source instead of the manifest schema default.
        ...(resolvedRepository !== undefined && { repository: resolvedRepository }),
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
  repository?: string
): Promise<ContentFetchResult> {
  const resolver = await getPackageResolver();
  if (!resolver) {
    return {
      content: null,
      error: 'No package resolver configured — call setPackageResolver() first',
      errorType: 'other',
    };
  }

  // verifyPublished: the content fetch that follows has no publish-status gate
  // of its own (backend-guide.ts serves drafts on purpose, for share links and
  // tab restore), so a draft opened by bare id is only caught here. The baseUrl
  // hydration resolve() in fetchPackageContent stays unverified — it runs on
  // every milestone fetch and its id is already known-good.
  const resolution = await resolver.resolve(packageId, { loadContent: false, verifyPublished: true });

  if (!resolution.ok) {
    return {
      content: null,
      error: `Failed to resolve package: ${packageId}`,
      errorType: resolution.error.code === 'not-found' ? 'not-found' : 'other',
    };
  }

  // The probe already GET the resource to read its status; build content from
  // it rather than re-issuing the identical request.
  const preFetched = resolution.probedResource
    ? buildBackendGuideContent(resolution.probedResource as BackendGuideResource, resolution.contentUrl, packageId)
    : undefined;

  // Prefer an explicit caller-supplied repository, but fall back to the
  // resolver's own source so a bare-ID open still keys the durable completion
  // on the true repository instead of the manifest schema default.
  return fetchPackageContent(
    resolution.contentUrl,
    packageManifest,
    undefined,
    repository ?? resolution.repository,
    preFetched
  );
}
