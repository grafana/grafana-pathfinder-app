import type { Milestone } from '../types/content.types';
import type { PackageOpenInfo } from '../types/content-panel.types';
import type { PublishedGuide } from './usePublishedGuides';

export function packageInfoForPath(
  path: PublishedGuide,
  resolvedMilestones?: Milestone[],
  trackId?: string
): PackageOpenInfo {
  return {
    packageId: path.id,
    // The cover loader needs the entry ID on its slim manifest.
    packageManifest: { ...(path.manifest as unknown as Record<string, unknown>), id: path.id },
    resolvedMilestones,
    launchSource: 'custom_guide',
    ...(trackId && { trackId }),
  };
}

export function pathTitle(path: PublishedGuide): string {
  return path.title || path.manifest?.description || path.id;
}
