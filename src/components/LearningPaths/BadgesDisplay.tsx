/**
 * Badges Display Component
 *
 * Grid display of all badges showing earned status with golden effects
 * for earned badges and grayscale locked badges.
 */

import React from 'react';
import { useStyles2, Icon, Tooltip } from '@grafana/ui';
import { cx } from '@emotion/css';

import type { BadgesDisplayProps, EarnedBadge } from '../../types/learning-paths.types';
import { getBadgesDisplayStyles } from './learning-paths.styles';

/**
 * Grid display of all achievement badges
 */
export function BadgesDisplay({ badges, onBadgeClick }: BadgesDisplayProps) {
  const styles = useStyles2(getBadgesDisplayStyles);

  const earnedCount = badges.filter((b) => b.earnedAt).length;
  const totalCount = badges.length;

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <Icon name="star" size="md" className={styles.headerIcon} />
        <h4 className={styles.headerTitle}>Achievements</h4>
        <span className={styles.headerCount}>
          {earnedCount}/{totalCount}
        </span>
      </div>

      {/* Badges grid */}
      <div className={styles.grid}>
        {badges.map((badge) => (
          <BadgeItem
            key={badge.id}
            badge={badge}
            onClick={onBadgeClick}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Individual badge item with tooltip
 */
interface BadgeItemProps {
  badge: EarnedBadge;
  onClick?: (badge: EarnedBadge) => void;
}

function BadgeItem({ badge, onClick }: BadgeItemProps) {
  const styles = useStyles2(getBadgesDisplayStyles);

  const isEarned = !!badge.earnedAt;
  const isNew = badge.isNew;

  const handleClick = () => {
    if (onClick && isEarned) {
      onClick(badge);
    }
  };

  // Format earned date
  const getEarnedDateText = () => {
    if (!badge.earnedAt) {
      return '';
    }
    const date = new Date(badge.earnedAt);
    return `Earned ${date.toLocaleDateString()}`;
  };

  const tooltipContent = isEarned
    ? `${badge.title}\n${badge.description}\n${getEarnedDateText()}`
    : `${badge.title}\n${badge.description}\n(Locked)`;

  return (
    <Tooltip content={tooltipContent} placement="top">
      <div
        className={cx(
          styles.badge,
          isEarned && styles.badgeEarned,
          !isEarned && styles.badgeLocked,
          isNew && styles.badgeNew
        )}
        onClick={handleClick}
        role={isEarned ? 'button' : undefined}
        tabIndex={isEarned ? 0 : undefined}
      >
        <span
          className={cx(
            styles.badgeIcon,
            isEarned && styles.badgeIconEarned,
            !isEarned && styles.badgeIconLocked
          )}
        >
          <Icon name={badge.icon as any} size="xl" />
        </span>
        <span
          className={cx(
            styles.badgeTitle,
            isEarned && styles.badgeTitleEarned
          )}
        >
          {badge.title}
        </span>
      </div>
    </Tooltip>
  );
}

/**
 * Compact badges display showing just icons
 */
interface CompactBadgesDisplayProps {
  badges: EarnedBadge[];
  maxVisible?: number;
}

export function CompactBadgesDisplay({ badges, maxVisible = 4 }: CompactBadgesDisplayProps) {
  const styles = useStyles2(getBadgesDisplayStyles);

  const earnedBadges = badges.filter((b) => b.earnedAt);
  const visibleBadges = earnedBadges.slice(0, maxVisible);
  const remainingCount = earnedBadges.length - maxVisible;

  if (earnedBadges.length === 0) {
    return null;
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {visibleBadges.map((badge) => (
        <Tooltip key={badge.id} content={badge.title} placement="top">
          <span className={cx(styles.badgeIcon, styles.badgeIconEarned)}>
            <Icon name={badge.icon as any} size="md" />
          </span>
        </Tooltip>
      ))}
      {remainingCount > 0 && (
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          +{remainingCount}
        </span>
      )}
    </div>
  );
}
