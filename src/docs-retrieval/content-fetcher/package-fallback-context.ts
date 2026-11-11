import { loadBundledManifest } from '../../lib/bundled-package-files';
import { isBundledTutorial } from '../../lib/bundled-tutorial-identity';
import { getMilestoneSlug } from '../../lib/learning-journey-url';
import { buildPackageFileUrl, getCachedPackageRecommendations } from '../../lib/package-recommendations-client';
import { RuntimeManifestJsonObjectSchema } from '../../lib/runtime-manifest';
import { isTrustedFinalUrl } from '../../security';
import type { CoverPageTrack, Milestone } from '../../types/content.types';
import { getManifestMilestoneIds, getManifestTracks } from '../../types/package.types';

export function resolveOfflinePathContext(
  contentUrl: string,
  manifest: Record<string, unknown>,
  suppliedMilestones: Milestone[] | undefined,
  repository: string | undefined,
  explicitGuideId: string | undefined,
  knownBaseUrl: string | undefined
) {
  const source = repository ?? manifest.repository;
  const publicPath = source === undefined || source === 'interactive-tutorials' || source === 'online-cdn';
  const index = publicPath ? getCachedPackageRecommendations() : null;
  const parent = index?.packages.find((entry) => entry.id === manifest.id);
  const cachedManifest = RuntimeManifestJsonObjectSchema.safeParse(parent?.manifest);
  const owningManifest =
    cachedManifest.success &&
    cachedManifest.data.id === manifest.id &&
    (cachedManifest.data.type === 'path' || cachedManifest.data.type === 'journey')
      ? { ...manifest, ...cachedManifest.data }
      : manifest;
  const loadedGuideId = explicitGuideId ?? getMilestoneSlug(contentUrl);

  const indexedUrl = (id: string): string | undefined => {
    const entry = index?.packages.find((item) => item.id === id);
    const url = entry && index ? buildPackageFileUrl(index.baseUrl, entry.path, 'content.json') : '';
    return url && isTrustedFinalUrl(url) ? url : undefined;
  };
  const baseUrl = knownBaseUrl ?? (typeof manifest.id === 'string' ? indexedUrl(manifest.id) : undefined);

  const resolveMember = (id: string, number: number): Milestone => {
    const supplied = suppliedMilestones?.find((m) => m.id === id || (!m.id && getMilestoneSlug(m.url) === id));
    if (supplied) {
      return { ...supplied, number };
    }
    const cached = index?.packages.find((entry) => entry.id === id);
    const bundled = publicPath && isBundledTutorial(id) ? loadBundledManifest(id) : undefined;
    const cachedMemberManifest = RuntimeManifestJsonObjectSchema.safeParse(cached?.manifest);
    const packageManifest =
      cachedMemberManifest.success && cachedMemberManifest.data.id === id
        ? cachedMemberManifest.data
        : bundled?.ok
          ? bundled.data
          : undefined;
    const url =
      id === loadedGuideId
        ? contentUrl
        : (indexedUrl(id) ??
          (bundled?.ok
            ? new URL(`/packages/${encodeURIComponent(id)}/content.json`, 'https://interactive-learning.grafana.net')
                .href
            : ''));
    return {
      id,
      number,
      title: cached?.title ?? id,
      url,
      isActive: false,
      ...(packageManifest && { packageManifest }),
      ...(!url && { isLocked: true }),
    };
  };

  const milestoneIds = getManifestMilestoneIds(owningManifest);
  const milestones = Array.isArray(owningManifest.milestones)
    ? milestoneIds.map((id, i) => resolveMember(id, i + 1))
    : (suppliedMilestones ?? []);
  const declared = getManifestTracks(owningManifest);
  const tracks: CoverPageTrack[] = declared.map((track) => ({
    trackId: track.trackId,
    label: track.label,
    milestones: track.guides.map((id, i) => resolveMember(id, i + 1)),
  }));

  return {
    manifest: owningManifest,
    loadedGuideId,
    baseUrl,
    milestones,
    hasUnavailableMilestones: milestones.some((m) => m.isLocked),
    pathTracks: {
      declared,
      resolved: tracks,
      authoritative: owningManifest !== manifest || Array.isArray(manifest.tracks),
    },
  };
}
