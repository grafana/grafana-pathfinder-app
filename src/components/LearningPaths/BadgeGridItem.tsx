/**
 * Badge Grid Item
 *
 * A single badge rendered as a centered-icon tile: icon on top, label beneath,
 * and — for locked badges with measurable progress — a thin progress bar at
 * the foot of the tile.
 */

import React from 'react';

import { Icon } from '@grafana/ui';

import { testIds } from '../../constants/testIds';
import type { EarnedBadge } from '../../types';
import { BADGES } from '../../learning-paths';
import { BadgeIcon } from './BadgeIcon';
import { getBadgeProgress } from './badge-utils';
import type { getMyLearningStyles } from './MyLearningTab.styles';

interface BadgeGridItemProps {
  badge: EarnedBadge;
  index: number;
  completedGuides: string[];
  streakDays: number;
  paths: Array<{ id: string; guides: string[] }>;
  styles: ReturnType<typeof getMyLearningStyles>;
  onSelect: (badge: EarnedBadge) => void;
}

export function BadgeGridItem({
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
  const badgeProgress = baseBadge ? getBadgeProgress(baseBadge, completedGuides, streakDays, paths) : null;

  const tileClass = isLegacy
    ? `${styles.badgeTile} ${styles.badgeTileLegacy}`
    : isEarned
      ? `${styles.badgeTile} ${styles.badgeTileEarned}`
      : `${styles.badgeTile} ${styles.badgeTileLocked}`;

  const labelClass = `${styles.badgeTileLabel} ${!isEarned && !isLegacy ? styles.badgeTileLabelLocked : ''} ${
    isLegacy ? styles.badgeTileLabelLegacy : ''
  }`;

  return (
    <button
      className={tileClass}
      onClick={() => onSelect(badge)}
      style={{ animationDelay: `${index * 50}ms` }}
      title={isLegacy ? 'This badge was earned in a previous version' : undefined}
      data-testid={testIds.learningPaths.badgeItem(badge.id)}
    >
      <div className={styles.badgeTileIconWrapper}>
        <BadgeIcon emoji={badge.emoji} icon={badge.icon} size="xl" emojiClassName={styles.badgeTileEmoji} />
        {isEarned && !isLegacy && (
          <div className={styles.badgeCheckmark}>
            <Icon name="check" size="xs" />
          </div>
        )}
        {isLegacy && (
          <div className={styles.badgeLegacyIndicator}>
            <Icon name="history" size="xs" />
          </div>
        )}
      </div>

      <span className={labelClass}>{badge.title}</span>

      {!isEarned && !isLegacy && badgeProgress && badgeProgress.total > 0 && (
        <div className={styles.badgeTileProgress}>
          <div className={styles.badgeTileProgressTrack}>
            <div className={styles.badgeTileProgressBar} style={{ width: `${badgeProgress.percentage}%` }} />
          </div>
          <span className={styles.badgeTileProgressText}>
            {badgeProgress.current}/{badgeProgress.total}
          </span>
        </div>
      )}
    </button>
  );
}
