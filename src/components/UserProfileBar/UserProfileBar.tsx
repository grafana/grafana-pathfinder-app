/**
 * UserProfileBar Component
 *
 * A compact, single-row component showing badge progress, guide count,
 * streak info, and a CTA to open the next recommended guide.
 * Replaces the old "Recommended learning" header in the context panel.
 */

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
      {/* Badge count */}
      <Tooltip
        content={t('userProfileBar.badgesTooltip', '{{- earned}} of {{- total}} badges earned', {
          earned: badgesEarned,
          total: badgesTotal,
        })}
      >
        <span
          className={styles.stat}
          aria-label={t('userProfileBar.badgesTooltip', '{{- earned}} of {{- total}} badges earned', {
            earned: badgesEarned,
            total: badgesTotal,
          })}
        >
          <span className={styles.starEmoji} aria-hidden="true">
            🏆
          </span>
          <span className={styles.statValue}>
            {badgesEarned}/{badgesTotal}
          </span>
        </span>
      </Tooltip>

      {/* Guides completed */}
      <Tooltip
        content={t('userProfileBar.guidesTooltip', '{{- count}} learning guides completed', {
          count: guidesCompleted,
        })}
      >
        <span
          className={styles.stat}
          aria-label={t('userProfileBar.guidesTooltip', '{{- count}} learning guides completed', {
            count: guidesCompleted,
          })}
        >
          <Icon name="book" size="sm" className={styles.bookIcon} />
          <span className={styles.statValue}>{guidesCompleted}</span> {t('userProfileBar.guides', 'guides')}
        </span>
      </Tooltip>

      {/* Streak (only when > 0) */}
      {streakDays > 0 && (
        <Tooltip
          content={t('userProfileBar.streakTooltip', '{{- days}}-day learning streak — keep it going!', {
            days: streakDays,
          })}
        >
          <span
            className={styles.stat}
            aria-label={t('userProfileBar.streakTooltip', '{{- days}}-day learning streak — keep it going!', {
              days: streakDays,
            })}
          >
            <span className={styles.fireEmoji} aria-hidden="true">
              🔥
            </span>
            <span className={styles.statValue}>{streakDays}</span> {t('userProfileBar.days', 'days')}
          </span>
        </Tooltip>
      )}

      {/* Next action CTA or all-complete message */}
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
