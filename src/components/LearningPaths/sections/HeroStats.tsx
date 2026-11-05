import React from 'react';
import { t, Trans } from '@grafana/i18n';
import { Icon } from '@grafana/ui';

import type { getMyLearningStyles } from '../MyLearningTab.styles';

interface HeroStatsProps {
  narrative?: boolean;
  guidesCompleted: number;
  pathsCompleted?: number;
  badgesEarned: number;
  streakDays: number;
  styles: ReturnType<typeof getMyLearningStyles>;
}

export function HeroStats({
  guidesCompleted,
  pathsCompleted = 0,
  badgesEarned,
  streakDays,
  styles,
  narrative = false,
}: HeroStatsProps) {
  if (narrative) {
    const guidesLabel =
      guidesCompleted === 1
        ? t('myLearning.summaryOneGuide', '1 guide')
        : t('myLearning.summaryGuides', '{{count}} guides', { count: guidesCompleted });
    const pathsLabel =
      pathsCompleted === 1
        ? t('myLearning.summaryOnePath', '1 learning path')
        : t('myLearning.summaryPaths', '{{count}} learning paths', { count: pathsCompleted });
    return (
      <p className={styles.learningSummary}>
        <Trans
          i18nKey="myLearning.learningSummary"
          values={{ guidesCompleted, pathsCompleted, streakDays, guidesLabel, pathsLabel }}
        >
          Your learning altitude is <strong>Fundamentals</strong>. You’ve completed <strong>{'{{guidesLabel}}'}</strong>
          , <strong>{'{{pathsLabel}}'}</strong>, and you’re on a <strong>{'{{streakDays}}'}-day streak</strong>. Pick up
          where you left off, or explore something new below.
        </Trans>
      </p>
    );
  }
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
            <div className={styles.statLabel}>{t('myLearning.learningAltitude', 'Your learning altitude')}</div>
            <div className={styles.statValueAltitude}>{t('myLearning.fundamentals', 'Fundamentals')}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
