import React from 'react';
import { useStyles2, Icon, Tooltip } from '@grafana/ui';
import { t } from '@grafana/i18n';

import { useNextLearningAction } from '../../learning-paths';
import { getUserProfileBarStyles } from './UserProfileBar.styles';
import { testIds } from '../../constants/testIds';

interface UserProfileBarProps {
  onOpenGuide: (url: string, title: string) => void;
}

export function UserProfileBar({ onOpenGuide }: UserProfileBarProps) {
  const styles = useStyles2(getUserProfileBarStyles);
  const { badgesEarned, badgesTotal, guidesCompleted, streakDays, nextAction, isLoading } = useNextLearningAction();
  const badgesTooltip = t('userProfileBar.badgesTooltip', '{{- earned}} of {{- total}} badges earned', {
    earned: badgesEarned,
    total: badgesTotal,
  });
  const guidesTooltip = t(
    'userProfileBar.guidesTooltip',
    guidesCompleted === 1 ? '{{- count}} learning guide completed' : '{{- count}} learning guides completed',
    {
      count: guidesCompleted,
    }
  );
  const guidesLabel = t('userProfileBar.guides', guidesCompleted === 1 ? 'guide' : 'guides', {
    count: guidesCompleted,
  });
  const streakTooltip = t('userProfileBar.streakTooltip', '{{- days}}-day learning streak — keep it going!', {
    count: streakDays,
    days: streakDays,
  });
  const daysLabel = t('userProfileBar.days', streakDays === 1 ? 'day' : 'days', {
    count: streakDays,
  });

  if (isLoading) {
    return (
      <div className={styles.skeleton} data-testid={testIds.contextPanel.userProfileBarLoading}>
        <div className={styles.skeletonBlock} />
        <div className={styles.skeletonBlock} />
        <div className={styles.skeletonBlockWide} />
      </div>
    );
  }

  return (
    <div className={styles.container} data-testid={testIds.contextPanel.userProfileBar}>
      <Tooltip content={badgesTooltip}>
        <span className={styles.stat} aria-label={badgesTooltip}>
          <span className={styles.starEmoji} aria-hidden="true">
            🏆
          </span>
          <span className={styles.statValue}>
            {badgesEarned}/{badgesTotal}
          </span>
        </span>
      </Tooltip>

      <Tooltip content={guidesTooltip}>
        <span className={styles.stat} aria-label={guidesTooltip}>
          <Icon name="book" size="sm" className={styles.bookIcon} />
          <span className={styles.statValue}>{guidesCompleted}</span> {guidesLabel}
        </span>
      </Tooltip>

      {streakDays > 0 && (
        <Tooltip content={streakTooltip}>
          <span className={styles.stat} aria-label={streakTooltip}>
            <span className={styles.fireEmoji} aria-hidden="true">
              🔥
            </span>
            <span className={styles.statValue}>{streakDays}</span> {daysLabel}
          </span>
        </Tooltip>
      )}

      {nextAction ? (
        <Tooltip
          content={t('userProfileBar.nextTooltip', 'Continue "{{- pathTitle}}" — {{- percent}}% done', {
            pathTitle: nextAction.pathTitle,
            percent: nextAction.pathProgress,
          })}
        >
          <button
            className={styles.nextAction}
            onClick={() => onOpenGuide(nextAction.guideUrl, nextAction.guideTitle)}
            data-testid={testIds.contextPanel.userProfileBarNextAction}
          >
            <Icon name="arrow-right" size="sm" />
            <span className={styles.nextActionLabel}>
              {t('userProfileBar.nextGuide', 'Next: {{- title}}', { title: nextAction.guideTitle })}
            </span>
          </button>
        </Tooltip>
      ) : (
        <Tooltip content={t('userProfileBar.allCompleteTooltip', "You've completed every learning path — nice work!")}>
          <span className={styles.allComplete} data-testid={testIds.contextPanel.userProfileBarAllComplete}>
            <Icon name="check-circle" size="sm" />
            {t('userProfileBar.allComplete', 'All paths complete!')}
          </span>
        </Tooltip>
      )}
    </div>
  );
}
