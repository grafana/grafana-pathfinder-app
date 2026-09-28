import { evaluateAlignment, resolveStartingLocation, type LaunchSource } from '../../../recovery';
import type { LearningJourneyTab, PackageOpenInfo, PendingAlignment } from '../../../types/content-panel.types';
import type { RawContent } from '../../../types/content.types';
import { getPackageRenderType } from '../../../types/package.types';

export interface DocsLoadAlignmentInput {
  requestedUrl: string;
  packageManifest?: Record<string, unknown>;
  fetchedManifest?: Record<string, unknown>;
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
 */
export function resolveDocsLoadAlignment({
  requestedUrl,
  packageManifest,
  fetchedManifest,
  currentPath,
  launchSource,
  isAdmin,
  isFullScreen,
}: DocsLoadAlignmentInput): PendingAlignmentDecision | undefined {
  const startingLocation = resolveStartingLocation(requestedUrl, [packageManifest, fetchedManifest], { isAdmin });
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
}

export function buildDocsLoadSuccessPatch({
  tab,
  requestedUrl,
  fetchedContent,
  packageInfo,
  pendingAlignment,
}: DocsLoadSuccessPatchInput): Partial<LearningJourneyTab> {
  const learningJourney = fetchedContent.metadata.learningJourney;

  return {
    content: fetchedContent,
    baseUrl: tab.baseUrl || fetchedContent.url,
    currentUrl: fetchedContent.url || requestedUrl,
    type:
      packageInfo != null
        ? getPackageRenderType(packageInfo.packageManifest)
        : fetchedContent.type === 'interactive'
          ? 'interactive'
          : tab.type,
    packageInfo: packageInfo ?? tab.packageInfo,
    pathContext: learningJourney ? { learningJourney } : undefined,
    pendingAlignment,
  };
}
