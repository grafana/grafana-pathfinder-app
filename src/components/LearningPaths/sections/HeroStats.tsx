/**
 * Hero Stats
 *
 * The My Learning hero: a subtitle plus a compact stats row. The streak is
 * always shown (even at zero), and a static "learning altitude" reflects the
 * fixed Fundamentals stage.
 */

import React from 'react';
import { t } from '@grafana/i18n';

import type { getMyLearningStyles } from '../MyLearningTab.styles';

interface HeroStatsProps {
  guidesCompleted: number;
  badgesEarned: number;
  totalBadges: number;
  streakDays: number;
  styles: ReturnType<typeof getMyLearningStyles>;
}

export function HeroStats({ guidesCompleted, badgesEarned, totalBadges, streakDays, styles }: HeroStatsProps) {
  return (
    <div className={styles.heroSection}>
      <div className={styles.heroContent}>
        <p className={styles.heroSubtitle}>
          {t('myLearning.subtitle', 'Track your progress, earn badges, and master Grafana')}
        </p>
      </div>

      <div className={styles.statsRow}>
        <div className={styles.statItem}>
          <div className={styles.statValue}>{guidesCompleted}</div>
          <div className={styles.statLabel}>{t('myLearning.guidesCompleted', 'Guides completed')}</div>
        </div>
        <div className={styles.statDivider} />
        <div className={styles.statItem}>
          <div className={styles.statValue}>
            {badgesEarned}/{totalBadges}
          </div>
          <div className={styles.statLabel}>{t('myLearning.badgesEarned', 'Badges earned')}</div>
        </div>
        <div className={styles.statDivider} />
        <div className={styles.statItem}>
          <div className={styles.statValueStreak}>
            <span className={styles.fireEmoji}>🔥</span>
            {streakDays}
          </div>
          <div className={styles.statLabel}>{t('myLearning.dayStreak', 'Day streak')}</div>
        </div>
        <div className={styles.statDivider} />
        <div className={styles.statItem}>
          <div className={styles.statValueAltitude}>{t('myLearning.fundamentals', 'Fundamentals')}</div>
          <div className={styles.statLabel}>{t('myLearning.learningAltitude', 'Learning altitude')}</div>
        </div>
      </div>
    </div>
  );
}
