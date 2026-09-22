/**
 * Learning Path Card Component
 *
 * Collapsible learning path card with balanced compact design.
 */

import React, { useId, useState } from 'react';
import { useStyles2, Icon } from '@grafana/ui';
import { cx } from '@emotion/css';
import { t } from '@grafana/i18n';

import type { LearningPathCardProps } from '../../types/learning-paths.types';
import { daysUntilDue } from '../../learning-paths';
import { testIds } from '../../constants/testIds';
import { getLearningPathCardStyles } from './learning-paths.styles';
import { GuideList } from './GuideList';
import { ProgressRing } from './ProgressRing';

function formatDueDate(dueAt: string): string {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})T00:00:00(?:\.\d+)?Z$/.exec(dueAt);
  const date = dateOnly ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])) : new Date(dueAt);
  if (Number.isNaN(date.getTime())) {
    return dueAt;
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Card displaying a learning path with collapsible guide list
 */
export function LearningPathCard({
  path,
  guides,
  progress,
  isCompleted,
  onContinue,
  onReset,
  defaultExpanded = false,
  isLaunching = false,
  launchDisabled = false,
  assignment,
}: LearningPathCardProps & { defaultExpanded?: boolean }) {
  const styles = useStyles2(getLearningPathCardStyles);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);
  const detailsId = useId();

  const dueDays = assignment?.dueAt ? daysUntilDue(assignment.dueAt) : undefined;
  const isOverdue = Boolean(assignment?.overdue || (dueDays !== undefined && dueDays < 0));
  const isUpcoming = !isOverdue && dueDays === 0;
  const dueString =
    dueDays === undefined
      ? undefined
      : isOverdue
        ? t('myLearning.dueOverdue', 'Overdue')
        : dueDays === 0
          ? t('myLearning.dueRelativeToday', 'Today')
          : dueDays === 1
            ? t('myLearning.dueRelativeTomorrow', '{{count}} day', { count: dueDays })
            : t('myLearning.dueDayCount', '{{count}} days', { count: dueDays });

  // Whether this is a URL-based path (guides fetched dynamically)
  const isUrlBased = Boolean(path.url);
  const isLoadingGuides = isUrlBased && guides.length === 0;

  // Find the next guide to continue with
  const currentGuide = guides.find((g) => g.isCurrent);
  const firstIncompleteGuide = guides.find((g) => !g.completed);
  const firstGuide = guides[0];

  const handleContinue = (e: React.MouseEvent) => {
    e.stopPropagation();
    const guideToOpen = currentGuide?.id || firstIncompleteGuide?.id || firstGuide?.id;
    if (guideToOpen) {
      onContinue(guideToOpen, path.id);
    }
  };

  const handleResetClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsConfirmingReset(true);
  };

  const handleConfirmReset = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onReset) {
      onReset(path.id);
    }
    setIsConfirmingReset(false);
  };

  const handleCancelReset = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsConfirmingReset(false);
  };

  const handleToggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  const getButtonText = () => {
    if (progress === 0) {
      return 'Start';
    }
    return 'Continue';
  };

  const completedCount = guides.filter((g) => g.completed).length;

  return (
    <div
      className={cx(
        styles.card,
        isCompleted && styles.cardCompleted,
        isUpcoming && styles.cardUpcoming,
        isOverdue && styles.cardOverdue
      )}
      data-testid={testIds.learningPaths.card(path.id)}
    >
      {/*
       * Deliberately not `role="button"`: that role is Children Presentational,
       * so it would hide the nested Continue / Restart / chevron controls from
       * assistive tech. The chevron owns the disclosure semantics; this click
       * handler is only a mouse convenience.
       */}
      <div className={styles.header} onClick={handleToggleExpand}>
        <ProgressRing progress={progress} size={40} strokeWidth={3} isCompleted={isCompleted} showPercentage={true} />

        <div className={styles.content}>
          <h3 className={cx(styles.title, isCompleted && styles.titleCompleted)}>{path.title}</h3>

          <div className={styles.meta}>
            {!isCompleted && assignment && (
              <span className={cx(styles.pathCardBadge, styles.assignedBadge)}>
                <Icon name="user" size="xs" />
                {t('myLearning.assignedBadge', 'Assigned')}
              </span>
            )}
            {!isCompleted && dueString && (
              <span
                className={cx(
                  styles.pathCardBadge,
                  styles.dueBadge,
                  isUpcoming && styles.dueBadgeUpcoming,
                  isOverdue && styles.dueBadgeOverdue
                )}
              >
                <Icon name="clock-nine" size="xs" />
                {dueString}
              </span>
            )}
            {isLoadingGuides ? (
              <span>Loading guides...</span>
            ) : (
              <span>
                {completedCount}/{guides.length} guides
              </span>
            )}
          </div>
        </div>

        {/* Actions - fixed position at end */}
        <div className={styles.actions}>
          {!isCompleted && (
            <button
              className={styles.actionButton}
              onClick={handleContinue}
              disabled={launchDisabled}
              data-testid={testIds.learningPaths.continueButton(path.id)}
            >
              <Icon name={isLaunching ? 'fa fa-spinner' : 'play'} size="sm" />
              {isLaunching ? 'Opening…' : getButtonText()}
            </button>
          )}
          {isCompleted && onReset && !isConfirmingReset && (
            <button
              className={styles.resetButton}
              onClick={handleResetClick}
              data-testid={testIds.learningPaths.resetButton(path.id)}
            >
              <Icon name="history" size="sm" />
              Restart
            </button>
          )}
          {isCompleted && onReset && isConfirmingReset && (
            <>
              <button
                className={styles.confirmResetButton}
                onClick={handleConfirmReset}
                data-testid={testIds.learningPaths.confirmResetButton(path.id)}
              >
                Confirm
              </button>
              <button
                className={styles.cancelResetButton}
                onClick={handleCancelReset}
                data-testid={testIds.learningPaths.cancelResetButton(path.id)}
              >
                Cancel
              </button>
            </>
          )}
          <button
            className={cx(styles.expandChevron, isExpanded && styles.expandChevronRotated)}
            onClick={(e) => {
              e.stopPropagation();
              handleToggleExpand();
            }}
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
            aria-expanded={isExpanded}
            aria-controls={detailsId}
            data-testid={testIds.learningPaths.expandButton(path.id)}
          >
            <Icon name="angle-down" size="lg" />
          </button>
        </div>
      </div>

      {/* Only visually hidden when collapsed, so aria-hidden keeps a screen
          reader from reading the guide list the toggle reports as collapsed. */}
      <div
        id={detailsId}
        className={cx(styles.expandable, isExpanded && styles.expandableOpen)}
        aria-hidden={!isExpanded}
      >
        {assignment && !isCompleted && (
          <div className={cx(styles.expandMeta, !path.description && styles.expandMetaBordered)}>
            <div className={styles.expandMetaRow}>
              <Icon name="user" size="sm" />
              <span>
                {t('myLearning.assignedBy', 'Assigned by')}
                {assignment.assignedBy ? (
                  <>
                    {' '}
                    <strong>{assignment.assignedBy}</strong>
                  </>
                ) : null}
              </span>
            </div>
            {assignment.dueAt && dueString && (
              <div className={styles.expandMetaRow}>
                <Icon name="clock-nine" size="sm" />
                <span>
                  {t('myLearning.dueDetail', 'Due {{date}} — {{relative}}{{left}}', {
                    date: formatDueDate(assignment.dueAt),
                    relative: dueString,
                    left: dueDays !== undefined && dueDays > 0 ? t('myLearning.dueLeft', ' left') : '',
                  })}
                </span>
              </div>
            )}
          </div>
        )}
        {path.description && <p className={styles.description}>{path.description}</p>}
        <GuideList guides={guides} isLoading={isLoadingGuides} className={styles.guideList} />
      </div>
    </div>
  );
}
