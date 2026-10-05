import React from 'react';
import { useStyles2, Icon } from '@grafana/ui';
import { cx } from '@emotion/css';
import { t } from '@grafana/i18n';

import type { ResolvedAssignment } from '../../types/learning-paths.types';
import { getDueStatus, type DueStatus } from '../../learning-paths';
import { getLearningPathCardStyles } from './learning-paths.styles';

export function dueLabel(status: DueStatus): string {
  switch (status.tone) {
    case 'overdue':
      return t('myLearning.dueOverdue', 'Overdue');
    case 'today':
      return t('myLearning.dueRelativeToday', 'Today');
    case 'later':
      return t('myLearning.dueDayCount', '{{count}} days', { count: status.days });
  }
}

export function AssignmentBadges({ assignment }: { assignment: Pick<ResolvedAssignment, 'dueAt' | 'overdue'> }) {
  const styles = useStyles2(getLearningPathCardStyles);
  const status = getDueStatus(assignment);

  return (
    <>
      <span className={cx(styles.pathCardBadge, styles.assignedBadge)}>
        <Icon name="user" size="xs" />
        {t('myLearning.assignedBadge', 'Assigned')}
      </span>
      {status && (
        <span
          className={cx(
            styles.pathCardBadge,
            styles.dueBadge,
            status.tone === 'today' && styles.dueBadgeUpcoming,
            status.tone === 'overdue' && styles.dueBadgeOverdue
          )}
        >
          <Icon name="clock-nine" size="xs" />
          {dueLabel(status)}
        </span>
      )}
    </>
  );
}
