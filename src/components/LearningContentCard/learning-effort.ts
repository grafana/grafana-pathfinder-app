import { t } from '@grafana/i18n';
import { GuideStatsSummarySchema } from '../../types/guide-stats.schema';
import { GUIDE_STATS_VERSION } from '../../lib/guide-stats/summary';

export function learningEffort(manifest: Record<string, unknown> | undefined, kind: 'guide' | 'path' | 'docs'): string {
  const stats = GuideStatsSummarySchema.safeParse(manifest?.stats);
  const minutes = manifest?.estimatedMinutes;
  return [
    kind === 'path' && Array.isArray(manifest?.milestones)
      ? milestoneCountText(manifest.milestones.length)
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

export function milestoneCountText(count: number): string {
  return count === 1
    ? t('learningCard.oneMilestone', '1 milestone')
    : t('learningCard.milestones', '{{count}} milestones', { count });
}
