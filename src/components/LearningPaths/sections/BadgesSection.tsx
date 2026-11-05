import React from 'react';
import { LinkButton, Icon } from '@grafana/ui';
import { cx } from '@emotion/css';
import { t } from '@grafana/i18n';

import { testIds } from '../../../constants/testIds';
import type { EarnedBadge } from '../../../types';
import { useVerticalOverflow } from '../../../hooks';
import { BadgeGridItem } from '../BadgeGridItem';
import type { getMyLearningStyles } from '../MyLearningTab.styles';
import { ROUTES } from '../../../constants';
import { prefixRoute } from '../../../utils/utils.routing';

interface BadgesSectionProps {
  compact?: boolean;
  gallery?: boolean;
  selectedBadgeId?: string;
  badges: EarnedBadge[];
  completedGuides: string[];
  streakDays: number;
  paths: Array<{ id: string; guides: string[] }>;
  onSelect: (badge: EarnedBadge) => void;
  styles: ReturnType<typeof getMyLearningStyles>;
}

export function BadgesSection({
  compact = false,
  gallery = false,
  selectedBadgeId,
  badges,
  completedGuides,
  streakDays,
  paths,
  onSelect,
  styles,
}: BadgesSectionProps) {
  const [gridRef, hasOverflow] = useVerticalOverflow<HTMLDivElement>();

  const visible = compact && !gallery ? badges.filter((badge) => badge.earnedAt) : badges;

  return (
    <div
      className={cx(styles.openSection, styles.columnSection, compact && styles.achievements)}
      role={compact ? 'region' : undefined}
      aria-label={compact ? t('myLearning.badges', 'Badges') : undefined}
      data-testid={testIds.learningPaths.badgesSection}
    >
      {!compact && (
        <div className={styles.sectionHeader}>
          <span className={styles.sectionIcon}>
            <Icon name="star" size="lg" />
          </span>
          <div className={styles.sectionHeadingText}>
            <h2 className={styles.sectionTitle}>{t('myLearning.badges', 'Badges')}</h2>
            <p className={styles.sectionDescription}>
              {t('myLearning.badgesDescription', 'Earn badges as you complete guides and learning paths.')}
            </p>
          </div>
        </div>
      )}

      {compact && !gallery && (
        <div className={styles.achievementsAction}>
          <LinkButton variant="secondary" fill="text" size="sm" href={prefixRoute(ROUTES.Badges)}>
            Show all badges
          </LinkButton>
        </div>
      )}
      <div className={compact ? styles.achievementsRow : undefined}>
        <div
          ref={gridRef}
          className={
            compact
              ? cx(styles.achievementsGrid, gallery && styles.badgeGallery)
              : cx(styles.badgesGrid, styles.scrollRegion, hasOverflow && styles.scrollRegionFaded)
          }
        >
          {visible.map((badge, index) => (
            <BadgeGridItem
              key={badge.id}
              gallery={gallery}
              selected={selectedBadgeId === badge.id}
              badge={badge}
              index={index}
              completedGuides={completedGuides}
              streakDays={streakDays}
              paths={paths}
              styles={styles}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
