import React from 'react';
import { t } from '@grafana/i18n';
import { Icon } from '@grafana/ui';

import type { getMyLearningStyles } from '../MyLearningTab.styles';

interface HeroStatsProps {
  guidesCompleted: number;
  badgesEarned: number;
  streakDays: number;
  styles: ReturnType<typeof getMyLearningStyles>;
}

export function HeroStats({ guidesCompleted, badgesEarned, streakDays, styles }: HeroStatsProps) {
  return (
    <div className={styles.heroSection}>
      <div className={styles.statsRow}>
        <div className={styles.statItem}>
          <span className={styles.statIconCompleted}>
            <Icon name="check-circle" size="lg" />
          </span>
          <div className={styles.statContent}>
            <div className={styles.statLabel}>{t('myLearning.guidesCompleted', 'Guides completed')}</div>
            <div className={styles.statValue}>{guidesCompleted}</div>
          </div>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statIconBadges}>
            <Icon name="star" size="lg" />
          </span>
          <div className={styles.statContent}>
            <div className={styles.statLabel}>{t('myLearning.badgesEarned', 'Badges earned')}</div>
            <div className={styles.statValueBadges}>{badgesEarned}</div>
          </div>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statIconStreak}>
            <Icon name="fire" size="lg" />
          </span>
          <div className={styles.statContent}>
            <div className={styles.statLabel}>{t('myLearning.dayStreak', 'Day streak')}</div>
            <div className={styles.statValueStreak}>{streakDays}</div>
          </div>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statIconAltitude}>
            <Icon name="layer-group" size="lg" />
          </span>
          <div className={styles.statContent}>
            <div className={styles.statLabel}>{t('myLearning.learningAltitude', 'Learning altitude')}</div>
            <div className={styles.statValueAltitude}>{t('myLearning.fundamentals', 'Fundamentals')}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
