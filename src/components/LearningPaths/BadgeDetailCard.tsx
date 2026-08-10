/**
 * Badge Detail Card
 *
 * Modal overlay showing a single badge's earned state, requirement, and
 * progress toward unlocking it.
 */

import React from 'react';
import { useStyles2, Icon } from '@grafana/ui';

import { testIds } from '../../constants/testIds';
import type { EarnedBadge } from '../../types';
import { BadgeIcon } from './BadgeIcon';
import { getBadgeRequirementText, type BadgeProgressInfo } from './badge-utils';
import { getBadgeDetailStyles } from './BadgeDetailCard.styles';

interface BadgeDetailCardProps {
  badge: EarnedBadge;
  progress: BadgeProgressInfo | null;
  onClose: () => void;
}

export function BadgeDetailCard({ badge, progress, onClose }: BadgeDetailCardProps) {
  const styles = useStyles2(getBadgeDetailStyles);
  const isEarned = !!badge.earnedAt;
  const isLegacy = badge.isLegacy;
  const requirementText = isLegacy
    ? 'This badge was earned in a previous version of Pathfinder'
    : getBadgeRequirementText(badge);

  const iconWrapperClass = isLegacy
    ? `${styles.iconWrapper} ${styles.iconLegacy}`
    : isEarned
      ? `${styles.iconWrapper} ${styles.iconEarned}`
      : `${styles.iconWrapper} ${styles.iconLocked}`;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()} data-testid={testIds.learningPaths.badgesModal}>
        <button className={styles.closeButton} onClick={onClose} data-testid={testIds.learningPaths.badgesModalClose}>
          <Icon name="times" size="lg" />
        </button>

        <div className={iconWrapperClass}>
          {!isLegacy && <div className={styles.iconGlow} />}
          <BadgeIcon emoji={badge.emoji} icon={badge.icon} size="xxxl" emojiClassName={styles.badgeEmoji} />
          {isEarned && !isLegacy && (
            <div className={styles.checkmark}>
              <Icon name="check" size="sm" />
            </div>
          )}
          {isLegacy && (
            <div className={styles.legacyIndicator}>
              <Icon name="history" size="sm" />
            </div>
          )}
        </div>

        <h3 className={styles.title}>{badge.title}</h3>

        <div
          className={`${styles.statusBadge} ${isLegacy ? styles.statusLegacy : isEarned ? styles.statusEarned : styles.statusLocked}`}
        >
          {isLegacy ? '📜 Legacy' : isEarned ? '✨ Unlocked' : '🔒 Locked'}
        </div>

        {isEarned && badge.earnedAt ? (
          <p className={styles.earnedDate}>
            Earned on{' '}
            {new Date(badge.earnedAt).toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        ) : !isLegacy ? (
          <p className={styles.description}>{badge.description}</p>
        ) : null}

        <div className={styles.requirementSection}>
          <div className={styles.requirementLabel}>{isLegacy ? 'Note' : isEarned ? 'Completed' : 'Requirement'}</div>
          <div className={styles.requirementText}>{requirementText}</div>
        </div>

        {!isEarned && !isLegacy && progress && progress.total > 0 && (
          <div className={styles.progressSection}>
            <div className={styles.progressHeader}>
              <span className={styles.progressLabel}>Progress</span>
              <span className={styles.progressValue}>
                {progress.current}/{progress.total} {progress.label}
              </span>
            </div>
            <div className={styles.progressBarOuter}>
              <div className={styles.progressBarInner} style={{ width: `${progress.percentage}%` }} />
              <div className={styles.progressBarShimmer} style={{ width: `${progress.percentage}%` }} />
            </div>
            <div className={styles.progressPercentage}>{progress.percentage}%</div>
          </div>
        )}
      </div>
    </div>
  );
}
