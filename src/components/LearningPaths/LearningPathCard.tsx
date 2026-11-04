import React, { useId, useMemo, useState } from 'react';
import { useStyles2, Icon, ConfirmModal, Button } from '@grafana/ui';
import { cx } from '@emotion/css';
import { t } from '@grafana/i18n';

import { getLearningTopicMetadata } from '../LearningContentCard/learning-topic-visual';
import { LearningTopicIcon } from '../LearningContentCard/LearningTopicIcon';
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
  preview,
  presentation,
  onViewPath,
  showOrganization = false,
  topic,
}: LearningPathCardProps & {
  defaultExpanded?: boolean;
  tile?: boolean;
  preview?: { src: string; alt: string };
  presentation?: 'resume' | 'compact';
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
        tile && presentation === 'resume' && styles.resumeTile,
        tile && presentation === 'compact' && styles.compactTile,
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
      data-learning-card={tile ? true : undefined}
      data-learning-resume={tile && presentation === 'resume' ? true : undefined}
      data-testid={testIds.learningPaths.card(path.id)}
    >
      {tile && preview && <img className={styles.tilePreview} src={preview.src} alt={preview.alt} loading="lazy" />}
      <div
        data-learning-card-body={tile ? true : undefined}
        className={styles.header}
        onClick={tile ? undefined : handleToggleExpand}
      >
        {!tile && (
          <ProgressRing progress={progress} size={40} strokeWidth={3} isCompleted={isCompleted} showPercentage={true} />
        )}

        <div className={styles.content}>
          {tile &&
            (preview || presentation ? (
              <div className={styles.tileEyebrow}>
                <Icon name={getLearningTopicMetadata(topic, 'path').icon} size="sm" />
                <span>{getLearningTopicMetadata(topic, 'path').label ?? 'Learning path'}</span>
              </div>
            ) : (
              <div className={styles.tileTopic}>
                <LearningTopicIcon topic={topic} kind="path" size="sm" bordered surface="secondary" />
              </div>
            ))}
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
          {tile && presentation === 'resume' && (currentGuide ?? firstIncompleteGuide) && (
            <div className={styles.resumeNext}>
              <span>Up next</span>
              <strong>{(currentGuide ?? firstIncompleteGuide)?.title}</strong>
            </div>
          )}

          {!tile && (
            <div className={styles.meta}>
              {!isCompleted && assignment && <AssignmentBadges assignment={assignment} />}
              {isLoadingGuides ? (
                <span>Loading guides...</span>
              ) : (
                <span>
                  {completedCount}/{guides.length} guides
                </span>
              )}
            </div>
          )}
        </div>

        {tile && (
          <div className={styles.tileFooter}>
            <div className={styles.tileProgress}>
              <ProgressRing
                progress={progress}
                size={presentation === 'resume' ? 56 : isCompleted ? 30 : 32}
                strokeWidth={presentation === 'resume' ? 3 : 2}
                isCompleted={isCompleted}
                showPercentage
              />
              <span className={styles.tileGuideCount}>
                {isCompleted && (
                  <span className={styles.completedLabel}>{t('learningCard.completed', 'Completed')}</span>
                )}
                <span>
                  <Icon name="book-open" size="xs" />
                  <strong>{t('learningCard.path', 'Learning path')}</strong>
                  <span aria-hidden="true">·</span>
                  {isLoadingGuides ? 'Loading guides…' : `${completedCount}/${guides.length} guides`}
                </span>
                {typeof path.estimatedMinutes === 'number' && path.estimatedMinutes > 0 && (
                  <span>
                    <Icon name="clock-nine" size="xs" />
                    About {path.estimatedMinutes} min
                  </span>
                )}
                {showOrganization && path.isPrivate && (
                  <span>
                    <Icon name="users-alt" size="xs" />
                    Your organisation
                  </span>
                )}
              </span>
            </div>
            {!isCompleted && assignment && <AssignmentBadges assignment={assignment} />}
            {presentation === 'resume' && (
              <Button icon="play" size="md" variant="primary" onClick={onViewPath}>
                Resume
              </Button>
            )}
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
                  handleToggleExpand();
                }}
                aria-label={isExpanded ? 'Collapse' : 'Expand'}
                aria-expanded={isExpanded}
                aria-controls={detailsId}
                data-testid={testIds.learningPaths.expandButton(path.id)}
              >
                <Icon name="angle-down" size="lg" />
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
