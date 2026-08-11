/**
 * Badges Section
 *
 * A three-column tile grid of every badge, scrolled in place so the column
 * never grows and drags its sibling column down.
 */

import React from 'react';
import { Icon } from '@grafana/ui';
import { cx } from '@emotion/css';
import { t } from '@grafana/i18n';

import { testIds } from '../../../constants/testIds';
import type { EarnedBadge } from '../../../types';
import { useVerticalOverflow } from '../../../hooks';
import { BadgeGridItem } from '../BadgeGridItem';
import type { getMyLearningStyles } from '../MyLearningTab.styles';

interface BadgesSectionProps {
  badges: EarnedBadge[];
  completedGuides: string[];
  streakDays: number;
  paths: Array<{ id: string; guides: string[] }>;
  onSelect: (badge: EarnedBadge) => void;
  styles: ReturnType<typeof getMyLearningStyles>;
}

export function BadgesSection({ badges, completedGuides, streakDays, paths, onSelect, styles }: BadgesSectionProps) {
  const [gridRef, hasOverflow] = useVerticalOverflow<HTMLDivElement>();

  return (
    <div className={cx(styles.section, styles.columnSection)} data-testid={testIds.learningPaths.badgesSection}>
      <div className={styles.sectionHeader}>
        <Icon name="star" size="md" className={styles.sectionIcon} />
        <h2 className={styles.sectionTitle}>{t('myLearning.badges', 'Badges')}</h2>
      </div>
      <p className={styles.sectionDescription}>
        {t('myLearning.badgesDescription', 'Earn badges by completing paths and maintaining streaks')}
      </p>

      <div
        ref={gridRef}
        className={cx(styles.badgesGrid, styles.scrollRegion, hasOverflow && styles.scrollRegionFaded)}
      >
        {badges.map((badge, index) => (
          <BadgeGridItem
            key={badge.id}
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
  );
}
