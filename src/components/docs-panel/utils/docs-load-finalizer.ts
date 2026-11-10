import { isAllowedContentUrl } from '../../../security';
import { evaluateAlignment, resolveStartingLocation, type LaunchSource } from '../../../recovery';
import type { LearningJourneyTab, PackageOpenInfo, PendingAlignment } from '../../../types/content-panel.types';
import type { RawContent } from '../../../types/content.types';
import { getPackageRenderType, isSamePackageRepository } from '../../../types/package.types';
import { getInteractiveLearningUrlTitle } from '../../../utils/doc-page-title';

export interface DocsLoadAlignmentInput {
  requestedUrl: string;
  packageManifest?: Record<string, unknown>;
  fetchedManifest?: Record<string, unknown>;
  packageManifestIsFromEnclosingPath?: boolean;
  currentPath: string;
  launchSource: LaunchSource | null;
  isAdmin: boolean;
  isFullScreen: boolean;
}

export interface PendingAlignmentDecision {
  startingLocation: string;
  currentPath: string;
  launchSource: string;
}

/**
 * Implied 0th step: decide whether to prompt the user to navigate to the
 * guide's declared starting location before step 1 begins.
 *
 * Two manifests can describe this launch and they are not equally complete.
 * `packageManifest` comes from the catalogue proxy, whose Go
 * `customGuideManifest` declares no starting location, so the key is dropped
 * at the wire boundary; `fetchedManifest` carries the loader's copy intact.
 * Passing both keeps `packageManifest` authoritative wherever it actually
 * declares a value and only falls back where it previously resolved to null —
 * so a guide opened from inside a learning path gets the same prompt as the
 * same guide opened standalone.
 *
 * A path member (fetched content carries `journeyManifest`) inverts that
 * order: `packageManifest` is then the enclosing path's, and the guide on
 * screen is closer to the reader, so its own declaration narrows the path's.
 */
export function resolveDocsLoadAlignment({
  requestedUrl,
  packageManifest,
  fetchedManifest,
  packageManifestIsFromEnclosingPath,
  currentPath,
  launchSource,
  isAdmin,
  isFullScreen,
}: DocsLoadAlignmentInput): PendingAlignmentDecision | undefined {
  const startingLocation = resolveStartingLocation(
    requestedUrl,
    packageManifestIsFromEnclosingPath ? [fetchedManifest, packageManifest] : [packageManifest, fetchedManifest],
    { isAdmin }
  );
  const evaluation = evaluateAlignment({
    currentPath,
    startingLocation,
    launchSource: launchSource ?? undefined,
  });

  if (isFullScreen || !evaluation.shouldPrompt || !startingLocation) {
    return undefined;
  }

  return {
    startingLocation,
    currentPath,
    launchSource: launchSource ?? 'unknown',
  };
}

export interface DocsLoadSuccessPatchInput {
  tab: LearningJourneyTab;
  requestedUrl: string;
  fetchedContent: RawContent;
  packageInfo?: PackageOpenInfo;
  pendingAlignment?: PendingAlignment;
  isReload?: boolean;
}

export function titleFromLoadedContent(
  tab: LearningJourneyTab,
  requestedUrl: string,
  fetchedContent: RawContent,
  isReload = false
): string | undefined {
  const fetched = fetchedContent.metadata.title?.trim();
  if (!fetched) {
    return undefined;
  }
  const isOwnBackendGuide =
    tab.baseUrl.startsWith('backend-guide:') && requestedUrl === tab.baseUrl && fetchedContent.url === tab.baseUrl;
  if (isReload && isOwnBackendGuide) {
    return fetched === tab.title ? undefined : fetched;
  }
  const placeholder =
    backendGuideResourceName(tab.baseUrl) ??
    backendGuideResourceName(fetchedContent.url) ??
    (requestedUrl === tab.baseUrl ? getInteractiveLearningUrlTitle(tab.baseUrl) : undefined);
  if (!placeholder || tab.title !== placeholder || fetched === placeholder) {
    return undefined;
  }
  return fetched;
}

function backendGuideResourceName(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  const prefix = url.startsWith('backend-guide:') ? 'backend-guide:' : url.startsWith('api:') ? 'api:' : '';
  if (!prefix) {
    return undefined;
  }
  const name = url.slice(prefix.length).trim();
  return name || undefined;
}

export function buildDocsLoadSuccessPatch({
  tab,
  requestedUrl,
  fetchedContent,
  packageInfo,
  pendingAlignment,
  isReload,
}: DocsLoadSuccessPatchInput): Partial<LearningJourneyTab> {
  const learningJourney = fetchedContent.metadata.learningJourney;
  const title = titleFromLoadedContent(tab, requestedUrl, fetchedContent, isReload);

  return {
    content: fetchedContent,
    ...(title ? { title } : {}),
    baseUrl: tab.baseUrl || fetchedContent.url,
    currentUrl: fetchedContent.url || requestedUrl,
    type:
      packageInfo != null
        ? getPackageRenderType(packageInfo.packageManifest)
        : fetchedContent.type === 'interactive'
          ? 'interactive'
          : tab.type,
    packageInfo: retainResolvedPath(packageInfo ?? tab.packageInfo, fetchedContent),
    pathContext: learningJourney ? { learningJourney } : undefined,
    pendingAlignment,
  };
}

function retainResolvedPath(
  packageInfo: PackageOpenInfo | undefined,
  content: RawContent
): PackageOpenInfo | undefined {
  const manifest = packageInfo?.packageManifest;
  const metadata = content.metadata;
  const owner = metadata.journeyManifest ?? metadata.packageManifest;
  const baseUrl = metadata.learningJourney?.baseUrl ?? metadata.trackMemberBaseUrl;
  const repository = packageInfo?.repository ?? manifest?.repository;
  if (
    !packageInfo ||
    !manifest ||
    (manifest.type !== 'path' && manifest.type !== 'journey') ||
    typeof manifest.id !== 'string' ||
    owner?.id !== manifest.id ||
    (owner.repository !== undefined && !isSamePackageRepository(owner.repository, repository)) ||
    !baseUrl ||
    !isAllowedContentUrl(baseUrl)
  ) {
    return packageInfo;
  }
  const resolvedTracks = metadata.learningJourney?.tracks;
  const tracks = resolvedTracks?.map((track) => ({
    trackId: track.trackId,
    label: track.label,
    guides: track.milestones.flatMap((milestone) => (milestone.id ? [milestone.id] : [])),
  }));
  const packageManifest: Record<string, unknown> = {
    ...manifest,
    ...((owner.type === 'path' || owner.type === 'journey') && owner),
    ...(tracks !== undefined && { tracks }),
  };
  const foundationsChanged = JSON.stringify(packageManifest.milestones) !== JSON.stringify(manifest.milestones);
  return {
    ...packageInfo,
    packageManifest,
    ...(foundationsChanged && { resolvedMilestones: undefined }),
    resolvedPath: {
      id: manifest.id,
      ...(typeof repository === 'string' && { repository }),
      baseUrl,
    },
  };
}
