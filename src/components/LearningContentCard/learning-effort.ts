import { t } from '@grafana/i18n';
import { GuideStatsSummarySchema } from '../../types/guide-stats.schema';
import { GUIDE_STATS_VERSION } from '../../lib/guide-stats/summary';
import { getManifestMilestoneIds, getManifestTracks } from '../../types/package.types';
import type { CatalogPackage } from '../../types/package-catalog.types';

export function learningEffort(manifest: Record<string, unknown> | undefined, kind: 'guide' | 'path' | 'docs'): string {
  const stats = GuideStatsSummarySchema.safeParse(manifest?.stats);
  const minutes = manifest?.estimatedMinutes;
  const moduleCount = kind === 'path' ? manifestModuleCount(manifest) : undefined;
  return [
    moduleCount !== undefined
      ? moduleCountText(moduleCount)
      : kind === 'guide' && stats.success && stats.data.version === GUIDE_STATS_VERSION
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
