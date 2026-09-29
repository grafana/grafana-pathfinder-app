/**
 * Learning Path Card Component
 *
 * Collapsible learning path card with balanced compact design.
 */

import React, { useId, useMemo, useState } from 'react';
import { useStyles2, Icon, ConfirmModal } from '@grafana/ui';
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
  onResetGuides,
  defaultExpanded = false,
  isLaunching = false,
  launchDisabled = false,
  assignmentDetails,
}: LearningPathCardProps & { defaultExpanded?: boolean }) {
  const styles = useStyles2(getLearningPathCardStyles);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);
  const [isConfirmingAssignmentReset, setIsConfirmingAssignmentReset] = useState(false);
  const detailsId = useId();

  const dueDays = assignmentDetails?.dueAt ? daysUntilDue(assignmentDetails.dueAt) : undefined;
  const isOverdue = Boolean(assignmentDetails?.overdue || (dueDays !== undefined && dueDays < 0));
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

  // Assignment satisfaction is completion-record-driven (assignment_satisfaction.go),
  // not local progress — local can drift from what's actually on record. When
  // the assignment resolved a guide list, override each covered guide's
  // `completed` here so the breakout below agrees with the badge/progress ring
  // above it, then recompute `isCurrent` with the same first-incomplete-wins
  // rule getPathGuides itself uses, so Continue/Up next follow whichever
  // completion source is in effect instead of the pre-override local one.
  const assignmentGuides = assignmentDetails?.guides;
  const effectiveGuides = useMemo(() => {
    if (!assignmentGuides || assignmentGuides.length === 0) {
      return guides;
    }
    const completedByGuideId = new Map(assignmentGuides.map((g) => [g.guideId, g.completed]));
    let foundCurrent = false;
    return guides.map((guide) => {
      const completed = completedByGuideId.get(guide.id) ?? guide.completed;
      const isCurrent = !completed && !foundCurrent;
      if (isCurrent) {
        foundCurrent = true;
      }
      return { ...guide, completed, isCurrent };
    });
  }, [guides, assignmentGuides]);

  // Find the next guide to continue with
  const currentGuide = effectiveGuides.find((g) => g.isCurrent);
  const firstIncompleteGuide = effectiveGuides.find((g) => !g.completed);
  const firstGuide = effectiveGuides[0];

  // Guides local storage says are done but the assignment's own record
  // doesn't credit — reopening one as-is would still look pre-completed
  // locally, so a fresh completion for it would never fire. Continuing has
  // to clear these first, not just visually override them above.
  const mismatchedGuides = useMemo(() => {
    if (!assignmentGuides) {
      return [];
    }
    const assignmentCompletedByGuideId = new Map(assignmentGuides.map((g) => [g.guideId, g.completed]));
    return guides.filter((guide) => guide.completed && assignmentCompletedByGuideId.get(guide.id) === false);
  }, [guides, assignmentGuides]);

  const guideToOpen = currentGuide?.id || firstIncompleteGuide?.id || firstGuide?.id;

  const handleContinue = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (mismatchedGuides.length > 0) {
      setIsConfirmingAssignmentReset(true);
      return;
    }
    if (guideToOpen) {
      onContinue(guideToOpen, path.id);
    }
  };

  const handleConfirmAssignmentReset = async () => {
    await onResetGuides?.(
      path.id,
      mismatchedGuides.map((guide) => guide.id)
    );
    setIsConfirmingAssignmentReset(false);
    if (guideToOpen) {
      onContinue(guideToOpen, path.id);
    }
  };

  const handleCancelAssignmentReset = () => {
    setIsConfirmingAssignmentReset(false);
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

  const completedCount = effectiveGuides.filter((g) => g.completed).length;

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
            {!isCompleted && assignmentDetails && (
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
        {assignmentDetails && !isCompleted && (
          <div className={cx(styles.expandMeta, !path.description && styles.expandMetaBordered)}>
            <div className={styles.expandMetaRow}>
              <Icon name="user" size="sm" />
              <span>
                {t('myLearning.assignedBy', 'Assigned by')}
                {assignmentDetails.assignedBy ? (
                  <>
                    {' '}
                    <strong>{assignmentDetails.assignedBy}</strong>
                  </>
                ) : null}
              </span>
            </div>
            {assignmentDetails.dueAt && dueString && (
              <div className={styles.expandMetaRow}>
                <Icon name="clock-nine" size="sm" />
                <span>
                  {t('myLearning.dueDetail', 'Due {{date}} — {{relative}}{{left}}', {
                    date: formatDueDate(assignmentDetails.dueAt),
                    relative: dueString,
                    left: dueDays !== undefined && dueDays > 0 ? t('myLearning.dueLeft', ' left') : '',
                  })}
                </span>
              </div>
            )}
          </div>
        )}
        {path.description && <p className={styles.description}>{path.description}</p>}
        <GuideList guides={effectiveGuides} isLoading={isLoadingGuides} className={styles.guideList} />
      </div>

      {onResetGuides && (
        <ConfirmModal
          isOpen={isConfirmingAssignmentReset}
          title={t('myLearning.assignmentResetTitle', 'Reset local progress?')}
          body={
            <>
              <p>
                {t(
                  'myLearning.assignmentResetBody',
                  "Starting this assignment will reset local progress on the following guide(s), so they're recorded again:"
                )}
              </p>
              <ul>
                {mismatchedGuides.map((guide) => (
                  <li key={guide.id}>{guide.title}</li>
                ))}
              </ul>
            </>
          }
          confirmText={t('myLearning.assignmentResetConfirm', 'Reset and continue')}
          dismissText={t('myLearning.assignmentResetCancel', 'Cancel')}
          onConfirm={handleConfirmAssignmentReset}
          onDismiss={handleCancelAssignmentReset}
        />
      )}
    </div>
  );
}
