/**
 * App Platform Learning Paths Adapter
 *
 * Synthesizes LearningPath-shaped entries from the App Platform custom-guide
 * catalogue (pkg/plugin/custom_guide_repository.go) so private paths/journeys
 * appear on the My Learning homepage at runtime, alongside the bundled
 * paths.json/paths-cloud.json scaffold.
 *
 * An adapter, not a LearningPath type extension — the smaller MVP-shaped
 * change (RFC CUSTOM-GUIDE-PACKAGES.md §11.5); the type-extension path is the
 * L3-ready alternative, deferred until nested journeys are in scope.
 *
 * Member guide IDs are used as-is for `LearningPath.guides` — these are bare
 * package IDs (e.g. `fe-alerting-01`), the same identifier the completion-keying
 * fix (Appendix A F13) now records completions under, so progress calculation
 * (`completedGuides.includes(guideId)`) works with no extra glue.
 *
 * @coupling Client: fetchCustomGuideRepository in lib/custom-guide-repository-client.ts
 */
import { fetchCustomGuideRepository } from '../lib/custom-guide-repository-client';
import type { LearningPath, GuideMetadataEntry } from '../types/learning-paths.types';

export interface AppPlatformPathsResult {
  paths: LearningPath[];
  guideMetadata: Record<string, GuideMetadataEntry>;
}

const EMPTY_RESULT: AppPlatformPathsResult = { paths: [], guideMetadata: {} };

/**
 * Fetches the namespace's custom-guide catalogue and splits it into
 * path/journey entries (shown as My Learning cards) and a guide-ID -> title/url
 * lookup covering every published guide (path members included), so
 * `resolveGuideMetadata` can resolve member titles/URLs without a second
 * round-trip.
 */
export async function fetchAppPlatformLearningPaths(namespace: string): Promise<AppPlatformPathsResult> {
  if (!namespace) {
    return EMPTY_RESULT;
  }

  const entries = await fetchCustomGuideRepository(namespace);
  const published = entries.filter((entry) => entry.status === 'published');
  if (published.length === 0) {
    return EMPTY_RESULT;
  }

  const guideMetadata: Record<string, GuideMetadataEntry> = {};
  for (const entry of published) {
    guideMetadata[entry.id] = {
      title: entry.title || entry.id,
      estimatedMinutes: 5,
      url: `backend-guide:${entry.id}`,
    };
  }

  const paths: LearningPath[] = published
    .filter((entry) => entry.manifest?.type === 'path' || entry.manifest?.type === 'journey')
    .map((entry) => ({
      id: entry.id,
      title: entry.manifest?.description || entry.title || entry.id,
      description: entry.manifest?.description || '',
      guides: entry.manifest?.milestones ?? [],
      badgeId: '',
    }));

  return { paths, guideMetadata };
}
