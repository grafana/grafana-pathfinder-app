import { LearningTopicIcon } from '../LearningContentCard/LearningTopicIcon';
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
import { formatDueDate, getDueStatus, markCurrentGuide } from '../../learning-paths';
import { testIds } from '../../constants/testIds';
import { getLearningPathCardStyles } from './learning-paths.styles';
import { AssignmentBadges, dueLabel } from './AssignmentBadges';
import { GuideList } from './GuideList';
import { ProgressRing } from './ProgressRing';

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
  assignment,
  tile = false,
  onViewPath,
  showOrganization = false,
  topic,
}: LearningPathCardProps & {
  defaultExpanded?: boolean;
  tile?: boolean;
  onViewPath?: () => void;
  showOrganization?: boolean;
  topic?: string;
}) {
  const styles = useStyles2(getLearningPathCardStyles);
  const [isExpanded, setIsExpanded] = useState(tile ? false : defaultExpanded);
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);
  const [isConfirmingAssignmentReset, setIsConfirmingAssignmentReset] = useState(false);
  const detailsId = useId();

  const dueStatus = assignment ? getDueStatus(assignment) : undefined;

  // Whether this is a URL-based path (guides fetched dynamically)
  const isUrlBased = Boolean(path.url);
  const isLoadingGuides = isUrlBased && guides.length === 0;

  // Satisfaction follows completion records, not local progress; guides local
  // storage marks done but the assignment doesn't credit must reset before Continue.
  const assignmentGuides = assignment?.guides;
  const { effectiveGuides, mismatchedGuides } = useMemo(() => {
    if (!assignmentGuides || assignmentGuides.length === 0) {
      return { effectiveGuides: guides, mismatchedGuides: [] };
    }
    const completedByGuideId = new Map(assignmentGuides.map((g) => [g.guideId, g.completed]));
    return {
      effectiveGuides: markCurrentGuide(
        guides.map((guide) => ({ ...guide, completed: completedByGuideId.get(guide.id) ?? guide.completed }))
      ),
      mismatchedGuides: guides.filter((guide) => guide.completed && completedByGuideId.get(guide.id) === false),
    };
  }, [guides, assignmentGuides]);

  const currentGuide = effectiveGuides.find((g) => g.isCurrent);
  const firstIncompleteGuide = effectiveGuides.find((g) => !g.completed);
  const firstGuide = effectiveGuides[0];

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
    await onResetGuides?.(path.id, mismatchedGuides);
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
        tile && styles.tile,
        isCompleted && styles.cardCompleted,
        dueStatus?.tone === 'today' && styles.cardUpcoming,
        dueStatus?.tone === 'overdue' && styles.cardOverdue
      )}
      onClick={
        tile
          ? (event) => {
              if (!(event.target as HTMLElement).closest('button, a, input')) {
                onViewPath?.();
              }
            }
          : undefined
      }
      data-testid={testIds.learningPaths.card(path.id)}
    >
      <div className={styles.header} onClick={tile ? undefined : handleToggleExpand}>
        {!tile && (
          <ProgressRing progress={progress} size={40} strokeWidth={3} isCompleted={isCompleted} showPercentage={true} />
        )}

        <div className={styles.content}>
          {tile && (
            <div className={styles.tileTopic}>
              <LearningTopicIcon topic={topic} kind="path" size="sm" bordered surface="secondary" />
            </div>
          )}
          <h3 className={cx(styles.title, isCompleted && styles.titleCompleted)}>
            {tile ? (
              <button type="button" className={styles.titleButton} onClick={onViewPath}>
                {path.title}
              </button>
            ) : (
              path.title
            )}
          </h3>

          {tile && path.description && <p className={styles.tileDescription}>{path.description}</p>}
          <div className={styles.meta}>
            {!tile && !isCompleted && assignment && <AssignmentBadges assignment={assignment} />}
            {!tile &&
              (isLoadingGuides ? (
                <span>Loading guides...</span>
              ) : (
                <span>
                  {completedCount}/{guides.length} guides
                </span>
              ))}
          </div>
        </div>

        {tile && (
          <div className={styles.tileProgress}>
            <ProgressRing progress={progress} size={40} strokeWidth={3} isCompleted={isCompleted} showPercentage />
            <span className={styles.tileGuideCount}>
              {isLoadingGuides ? 'Loading guides…' : `${completedCount}/${guides.length} guides`}
              {path.estimatedMinutes ? ` · About ${path.estimatedMinutes} min` : ''}
              {showOrganization && path.isPrivate ? ' · Your organisation' : ''}
            </span>
            {!isCompleted && assignment && <AssignmentBadges assignment={assignment} />}
          </div>
        )}
        {(!tile || isCompleted) && (
          <div className={styles.actions}>
            {!tile && !isCompleted && (
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
            {!tile && (
              <button
                className={cx(styles.expandChevron, isExpanded && styles.expandChevronRotated)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (tile) {
                    onViewPath?.();
                  } else {
                    handleToggleExpand();
                  }
                }}
                aria-label={tile ? `View path: ${path.title}` : isExpanded ? 'Collapse' : 'Expand'}
                aria-expanded={tile ? undefined : isExpanded}
                aria-controls={tile ? undefined : detailsId}
                data-testid={testIds.learningPaths.expandButton(path.id)}
              >
                {tile ? 'View path' : <Icon name="angle-down" size="lg" />}
              </button>
            )}
          </div>
        )}
      </div>

      {!tile && (
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
              {assignment.trackLabel && (
                <div className={styles.expandMetaRow}>
                  <Icon name="layer-group" size="sm" />
                  <span>
                    {t('myLearning.assignedTrack', 'Track')}{' '}
                    <strong className={styles.trackHighlight}>{assignment.trackLabel}</strong>
                  </span>
                </div>
              )}
              {dueStatus && (
                <div className={styles.expandMetaRow}>
                  <Icon name="clock-nine" size="sm" />
                  <span>
                    {t('myLearning.dueDetail', 'Due {{date}} — {{relative}}{{left}}', {
                      date: formatDueDate(assignment.dueAt!),
                      relative: dueLabel(dueStatus),
                      left: dueStatus.days > 0 ? t('myLearning.dueLeft', ' left') : '',
                    })}
                  </span>
                </div>
              )}
            </div>
          )}
          {!tile && path.description && <p className={styles.description}>{path.description}</p>}
          <GuideList guides={effectiveGuides} isLoading={isLoadingGuides} className={styles.guideList} />
        </div>
      )}

      {onResetGuides && (
        <ConfirmModal
          isOpen={isConfirmingAssignmentReset}
          title={t('myLearning.assignmentResetTitle', 'Reset local progress?')}
          body={
            <>
              <p>
                {t(
                  'myLearning.assignmentResetBody',
                  'Starting this assignment will reset local progress on the following guide(s):'
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
