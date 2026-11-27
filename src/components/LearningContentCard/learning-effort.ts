import { t } from '@grafana/i18n';
import type { LearningPath, PathGuide, ResolvedAssignment } from '../../types/learning-paths.types';
import { GuideStatsSummarySchema } from '../../types/guide-stats.schema';
import { GUIDE_STATS_VERSION } from '../../lib/guide-stats/summary';
import { meanOfMemberPercentages } from '../../lib/guide-stats';
import { resolvePathMemberPercentages } from '../../global-state/path-member-join';
import { interactiveCompletionStorage } from '../../lib/user-storage';
import { pathSequences } from '../../learning-paths';
import { getManifestMilestoneIds, getManifestTracks } from '../../types/package.types';
import type { CatalogPackage } from '../../types/package-catalog.types';

export function learningEffort(manifest: Record<string, unknown> | undefined, kind: 'guide' | 'path' | 'docs'): string {
  const stats = GuideStatsSummarySchema.safeParse(manifest?.stats);
  const minutes = manifest?.estimatedMinutes;
  const moduleCount = kind === 'path' ? manifestModuleCount(manifest) : undefined;
  return [
    moduleCount !== undefined
      ? moduleCountText(moduleCount)
      : kind === 'guide' &&
          stats.success &&
          stats.data.version === GUIDE_STATS_VERSION &&
          stats.data.completableBlockCount > 0
        ? t('learningCard.activities', '{{count}} activities', { count: stats.data.completableBlockCount })
        : undefined,
    typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0
      ? t('learningCard.time', 'About {{minutes}} min', { minutes })
      : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

function manifestModuleCount(manifest?: Record<string, unknown>): number | undefined {
  const defaultCount = getManifestMilestoneIds(manifest).length;
  return (
    defaultCount ||
    (getManifestTracks(manifest)[0]?.guides.length ?? (Array.isArray(manifest?.milestones) ? 0 : undefined))
  );
}

export function catalogModuleCountText(item: CatalogPackage, loadedCount?: number): string | undefined {
  if (item.format !== 'path') {
    return undefined;
  }
  const manifest = item.packageInfo?.packageManifest ?? item.curatedPath?.manifest;
  const count = manifestModuleCount(manifest) ?? (item.memberIds?.length || loadedCount);
  return count === undefined ? undefined : moduleCountText(count);
}

export function moduleCountText(count: number): string {
  return count === 1
    ? t('learningCard.oneModule', '1 module')
    : t('learningCard.modules', '{{count}} modules', { count });
}

export function courseCompletionCounts(path: LearningPath, guides: PathGuide[], assignment?: ResolvedAssignment) {
  if (assignment?.guides?.length) {
    return {
      completed: assignment.guides.filter((guide) => guide.completed).length,
      total: assignment.guides.length,
    };
  }
  const sequences = pathSequences(path);
  const guidesById = new Map(guides.map((guide) => [guide.id, guide]));
  if (!sequences.length || !sequences.every((ids) => ids.every((id) => guidesById.has(id)))) {
    return undefined;
  }
  const completedMemberIds = guides.filter((guide) => guide.completed).map((guide) => guide.id);
  const persistedPercentages = interactiveCompletionStorage.peekAll();
  const rollups = sequences.map((ids) => {
    const { resolvedPercentages } = resolvePathMemberPercentages(
      ids.map((id) => ({ id, url: guidesById.get(id)?.url })),
      { pathBaseUrl: path.url, completedMemberIds, persistedPercentages }
    );
    return {
      percent: meanOfMemberPercentages(resolvedPercentages).percent,
      completed: resolvedPercentages.filter((percent) => percent === 100).length,
      total: ids.length,
    };
  });
  const best = rollups.reduce((best, candidate) => (candidate.percent > best.percent ? candidate : best));
  return { completed: best.completed, total: best.total };
}
