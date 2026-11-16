import React from 'react';
import { LinkButton } from '@grafana/ui';
import { t, Trans } from '@grafana/i18n';
import { cx } from '@emotion/css';

import { ROUTES } from '../../../constants';
import { testIds } from '../../../constants/testIds';
import type { EarnedBadge } from '../../../types';
import { prefixRoute } from '../../../utils/utils.routing';
import { BadgeGridItem } from '../BadgeGridItem';
import { BadgeMedallion } from '../BadgeMedallion';
import type { BadgeProgressInfo } from '../badge-utils';
import type { getMyLearningStyles } from '../MyLearningTab.styles';

interface HomeBadgesSummaryProps {
  badges: EarnedBadge[];
  selectedBadgeId?: string;
  badgeProgress: ReadonlyMap<string, BadgeProgressInfo>;
  completedGuides: string[];
  streakDays: number;
  paths: Array<{ id: string; guides: string[] }>;
  onSelect: (badge: EarnedBadge) => void;
  styles: ReturnType<typeof getMyLearningStyles>;
}

export function HomeBadgesSummary({
  badges,
  selectedBadgeId,
  badgeProgress,
  styles,
  ...itemProps
}: HomeBadgesSummaryProps) {
  const earned = badges.filter((badge) => badge.earnedAt);
  const nextBadge = badges
    .filter((badge) => {
      const progress = badgeProgress.get(badge.id);
      return (
        !badge.earnedAt &&
        !badge.isLegacy &&
        progress &&
        progress.total > 0 &&
        progress.percentage > 0 &&
        progress.percentage < 100
      );
    })
    .sort((a, b) => (badgeProgress.get(b.id)?.percentage ?? 0) - (badgeProgress.get(a.id)?.percentage ?? 0))[0];
  const nextProgress = nextBadge ? badgeProgress.get(nextBadge.id) : undefined;
  const renderBadge = (badge: EarnedBadge, index: number) => (
    <BadgeGridItem
      key={badge.id}
      {...itemProps}
      summary
      badge={badge}
      selected={selectedBadgeId === badge.id}
      progress={badgeProgress.get(badge.id)}
      index={index}
      styles={styles}
    />
  );

  return (
    <aside
      className={styles.homeBadgeShelf}
      role="region"
      aria-label={t('myLearning.badges', 'Badges')}
      data-testid={testIds.learningPaths.badgesSection}
    >
      <div className={styles.homeBadgeHeader}>
        <h2>
          {earned.length === 1
            ? t('myLearning.oneBadgeUnlocked', 'You’ve unlocked 1 badge')
            : t('myLearning.badgesUnlocked', 'You’ve unlocked {{count}} badges', { count: earned.length })}
        </h2>
        <LinkButton variant="secondary" fill="outline" size="md" href={prefixRoute(ROUTES.Badges)}>
          {t('myLearning.showAllBadges', 'Show all badges')}
        </LinkButton>
      </div>
      {(earned.length > 0 || nextBadge) && (
        <div className={styles.homeBadgeGroup}>
          {earned.map(renderBadge)}
          {nextBadge && nextProgress && (
            <button
              type="button"
              className={styles.homeBadgeTarget}
              onClick={() => itemProps.onSelect(nextBadge)}
              data-selected={selectedBadgeId === nextBadge.id || undefined}
              aria-current={selectedBadgeId === nextBadge.id || undefined}
            >
              <BadgeMedallion badge={nextBadge} />
              <span className={styles.homeBadgeTargetBody}>
                <span>
                  <Trans i18nKey="myLearning.almostUnlockedBadge" values={{ badge: nextBadge.title }}>
                    You’ve almost unlocked <span className={styles.homeBadgeTargetName}>{'{{badge}}'}</span>
                  </Trans>
                </span>
                <span
                  className={cx(styles.badgeTileProgressTrack, styles.homeBadgeTargetTrack)}
                  role="progressbar"
                  aria-label={nextBadge.title}
                  aria-valuemin={0}
                  aria-valuemax={nextProgress.total}
                  aria-valuenow={nextProgress.current}
                >
                  <span
                    className={styles.badgeTileProgressBar}
                    style={{ display: 'block', width: `${nextProgress.percentage}%` }}
                  />
                </span>
                <span className={styles.homeBadgeTargetDescription}>
                  {nextProgress.current}/{nextProgress.total}
                </span>
              </span>
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
