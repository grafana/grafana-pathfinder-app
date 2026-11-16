import React from 'react';

import { Tooltip } from '@grafana/ui';
import { t } from '@grafana/i18n';

import { testIds } from '../../constants/testIds';
import type { EarnedBadge } from '../../types';
import { BADGES } from '../../learning-paths';
import { BadgeMedallion } from './BadgeMedallion';
import { BadgeProgress } from './BadgeProgress';
import { getBadgeProgress, type BadgeProgressInfo } from './badge-utils';
import type { getMyLearningStyles } from './MyLearningTab.styles';

interface BadgeGridItemProps {
  summary?: boolean;
  gallery?: boolean;
  selected?: boolean;
  progress?: BadgeProgressInfo;
  badge: EarnedBadge;
  index: number;
  completedGuides: string[];
  streakDays: number;
  paths: Array<{ id: string; guides: string[] }>;
  styles: ReturnType<typeof getMyLearningStyles>;
  onSelect: (badge: EarnedBadge) => void;
}

export function BadgeGridItem({
  summary = false,
  gallery = false,
  selected = false,
  progress: progressOverride,
  badge,
  index,
  completedGuides,
  streakDays,
  paths,
  styles,
  onSelect,
}: BadgeGridItemProps) {
  const isEarned = !!badge.earnedAt;
  const isLegacy = badge.isLegacy;
  const baseBadge = BADGES.find((b) => b.id === badge.id);
  const badgeProgress =
    progressOverride ?? (baseBadge ? getBadgeProgress(baseBadge, completedGuides, streakDays, paths) : null);

  const details = (
    <div className={styles.badgeTileBody}>
      <span className={styles.badgeTileLabel} data-earned={isEarned}>
        {badge.title}
      </span>
      {gallery && badge.earnedAt ? (
        <time className={styles.badgeTileEarnedDate} dateTime={new Date(badge.earnedAt).toISOString()}>
          {t('myLearning.badgeEarnedOn', 'Earned on {{date}}', {
            date: new Date(badge.earnedAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            }),
          })}
        </time>
      ) : null}
      {!isEarned && !isLegacy && badgeProgress && badgeProgress.total > 0 && (
        <BadgeProgress progress={badgeProgress} ariaLabel={badge.title} />
      )}
    </div>
  );

  const item = (
    <button
      type="button"
      className={`${styles.badgeTile} ${summary ? styles.badgeSummaryItem : ''}`}
      onClick={() => onSelect(badge)}
      data-selected={selected || undefined}
      aria-current={selected || undefined}
      aria-label={summary && isEarned ? badge.title : undefined}
      style={{ animationDelay: `${index * 50}ms` }}
      title={isLegacy ? 'This badge was earned in a previous version' : undefined}
      data-testid={testIds.learningPaths.badgeItem(badge.id)}
    >
      <BadgeMedallion badge={badge} size={gallery ? 'lg' : 'sm'} />

      {(!summary || !isEarned) && details}
    </button>
  );
  return summary && isEarned ? <Tooltip content={badge.title}>{item}</Tooltip> : item;
}
