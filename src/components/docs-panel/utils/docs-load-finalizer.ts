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
