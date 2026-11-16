import React from 'react';
import { useStyles2, Icon, TextLink, Portal } from '@grafana/ui';

import { testIds } from '../../constants/testIds';
import type { EarnedBadge } from '../../types';
import { getPathsData } from '../../learning-paths';
import { isAllowedContentUrl } from '../../security/url-validator';
import { buildPathfinderShareUrl } from '../../utils/pathfinder-search-params';
import { openGuideInSidebar } from '../docs-panel/utils/open-prepared-guide';
import { BadgeMedallion } from './BadgeMedallion';
import { BadgeProgress } from './BadgeProgress';
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
  const { trigger } = badge;
  const path =
    !isLegacy && trigger.type === 'path-completed'
      ? getPathsData().paths.find((candidate) => candidate.id === trigger.pathId)
      : undefined;
  const pathUrl = path?.url && isAllowedContentUrl(path.url) ? path.url : undefined;
  const pathHref = pathUrl
    ? buildPathfinderShareUrl({
        doc: pathUrl,
        guideType: 'learning-journey',
        panelMode: 'sidebar',
      })
    : undefined;
  const requirementText = isLegacy
    ? 'This badge was earned in a previous version of interactive learning'
    : getBadgeRequirementText(badge);

  return (
    <Portal>
      <div className={styles.overlay} onClick={onClose}>
        <div
          className={styles.card}
          onClick={(e) => e.stopPropagation()}
          data-testid={testIds.learningPaths.badgesModal}
        >
          <button className={styles.closeButton} onClick={onClose} data-testid={testIds.learningPaths.badgesModalClose}>
            <Icon name="times" size="lg" />
          </button>

          <div className={styles.medallion}>
            <BadgeMedallion badge={badge} size="lg" />
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
            <div className={styles.requirementText}>
              {pathHref && path && pathUrl ? (
                <>
                  Complete all guides in the &quot;
                  <TextLink
                    href={pathHref}
                    variant="bodySmall"
                    inline={false}
                    onClick={(event) => {
                      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                        return;
                      }
                      event.preventDefault();
                      onClose();
                      openGuideInSidebar({ url: pathUrl, title: path.title, source: 'content_link' });
                    }}
                  >
                    {path.title}
                  </TextLink>
                  &quot; learning path
                </>
              ) : (
                requirementText
              )}
            </div>
          </div>

          {!isEarned && !isLegacy && progress && progress.total > 0 && (
            <div className={styles.progressSection}>
              <div className={styles.progressHeader}>
                <span className={styles.progressLabel}>Progress</span>
                <span className={styles.progressValue}>
                  {progress.current}/{progress.total} {progress.label}
                </span>
              </div>
              <BadgeProgress progress={progress} ariaLabel={badge.title} showCount={false} />
              <div className={styles.progressPercentage}>{progress.percentage}%</div>
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}
