/**
 * Badges Section
 *
 * A tile grid of badges, expandable to show the full set.
 */

import React from 'react';
import { Icon } from '@grafana/ui';
import { t } from '@grafana/i18n';

import { testIds } from '../../../constants/testIds';
import type { EarnedBadge } from '../../../types';
import { BadgeGridItem } from '../BadgeGridItem';
import type { getMyLearningStyles } from '../MyLearningTab.styles';

interface BadgesSectionProps {
  badges: EarnedBadge[];
  totalBadges: number;
  showAll: boolean;
  onToggleShowAll: () => void;
  completedGuides: string[];
  streakDays: number;
  paths: Array<{ id: string; guides: string[] }>;
  onSelect: (badge: EarnedBadge) => void;
  styles: ReturnType<typeof getMyLearningStyles>;
}

export function BadgesSection({
  badges,
  totalBadges,
  showAll,
  onToggleShowAll,
  completedGuides,
  streakDays,
  paths,
  onSelect,
  styles,
}: BadgesSectionProps) {
  const displayed = showAll ? badges : badges.slice(0, 6);

  return (
    <div className={styles.section} data-testid={testIds.learningPaths.badgesSection}>
      <div className={styles.sectionHeader}>
        <Icon name="star" size="md" className={styles.sectionIcon} />
        <h2 className={styles.sectionTitle}>{t('myLearning.badges', 'Badges')}</h2>
        <button
          className={styles.expandButton}
          onClick={onToggleShowAll}
          data-testid={testIds.learningPaths.showAllBadgesButton}
        >
          {showAll
            ? t('myLearning.showLess', 'Show less')
            : t('myLearning.viewAll', 'View all ({{count}})', { count: totalBadges })}
          <Icon name={showAll ? 'angle-up' : 'angle-down'} size="sm" />
        </button>
      </div>
      <p className={styles.sectionDescription}>
        {t('myLearning.badgesDescription', 'Earn badges by completing guides and maintaining streaks')}
      </p>

      <div className={`${styles.badgesGrid} ${showAll ? styles.badgesGridExpanded : ''}`}>
        {displayed.map((badge, index) => (
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
