import React, { useId, useMemo, useState } from 'react';
import { useStyles2, Icon, ConfirmModal, Button } from '@grafana/ui';
import { cx } from '@emotion/css';
import { t } from '@grafana/i18n';

import { getLearningTopicMetadata } from '../LearningContentCard/learning-topic-visual';
import { LearningCardPreview } from '../LearningContentCard/LearningCardPreview';
import type { LearningPathCardProps } from '../../types/learning-paths.types';
import { formatDueDate, getDueStatus, getAssignmentGuideState } from '../../learning-paths';
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
  launchError,
  assignment,
  tile = false,
  selected = false,
  preview,
  presentation,
  onViewPath,
  showOrganization = false,
  topic,
}: LearningPathCardProps & {
  defaultExpanded?: boolean;
  tile?: boolean;
  selected?: boolean;
  preview?: { src: string; alt: string };
  presentation?: 'resume' | 'compact';
  onViewPath?: () => void;
  showOrganization?: boolean;
  topic?: string;
  launchError?: string;
}) {
  const styles = useStyles2(getLearningPathCardStyles);
  const topicMetadata = getLearningTopicMetadata(topic, 'path');
  const [isExpanded, setIsExpanded] = useState(tile ? false : defaultExpanded);
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);
  const [isConfirmingAssignmentReset, setIsConfirmingAssignmentReset] = useState(false);
  const detailsId = useId();

  const dueStatus = assignment ? getDueStatus(assignment) : undefined;
  // Whether this is a URL-based path (guides fetched dynamically)
  const isUrlBased = Boolean(path.url);
  const isLoadingGuides = isUrlBased && guides.length === 0;

  const assignmentGuides = assignment?.guides;
  const { effectiveGuides, mismatchedGuides } = useMemo(
    () => getAssignmentGuideState(guides, assignmentGuides),
    [guides, assignmentGuides]
  );

  const currentGuide = effectiveGuides.find((g) => g.isCurrent);
  const firstIncompleteGuide = effectiveGuides.find((g) => !g.completed);
  const nextGuide = currentGuide ?? firstIncompleteGuide;
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
  const imageDuration =
    tile &&
    typeof path.estimatedMinutes === 'number' &&
    Number.isFinite(path.estimatedMinutes) &&
    path.estimatedMinutes > 0;
  const resumeAction = tile && presentation === 'resume' && (
    <div className={styles.resumeAction}>
      <Button
        icon={isLaunching ? 'spinner' : 'play'}
        size="md"
        variant="primary"
        onClick={onViewPath}
        disabled={launchDisabled}
      >
        {isLaunching ? t('learningCard.opening', 'Opening…') : t('learningCard.resume', 'Resume')}
      </Button>
    </div>
  );

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
              if (!launchDisabled && !(event.target as HTMLElement).closest('button, a, input')) {
                onViewPath?.();
              }
            }
          : undefined
      }
      aria-busy={tile && isLaunching ? true : undefined}
      aria-disabled={tile && launchDisabled ? true : undefined}
      data-learning-card={tile ? true : undefined}
      data-selected={tile && selected ? true : undefined}
      data-learning-resume={tile && presentation === 'resume' ? true : undefined}
      data-testid={testIds.learningPaths.card(path.id)}
    >
      {tile && (
        <LearningCardPreview
          preview={preview}
          topic={topic}
          kind="path"
          estimatedMinutes={path.estimatedMinutes}
          organization={showOrganization && path.isPrivate}
          className={presentation === 'resume' ? styles.resumePreview : undefined}
        />
      )}
      {/* A button role would hide the nested actions from assistive technology. */}
      <div
        data-learning-card-body={tile ? true : undefined}
        className={styles.header}
        onClick={tile ? undefined : handleToggleExpand}
      >
        {!tile && (
          <ProgressRing progress={progress} size={44} strokeWidth={3} isCompleted={isCompleted} showPercentage={true} />
        )}

        <div className={styles.content}>
          {tile && (
            <div className={styles.tileEyebrow}>
              <Icon
                name={topicMetadata.icon}
                size="sm"
                className={topicMetadata.icon === 'graph-bar' ? styles.tileEyebrowMetricIcon : undefined}
              />
              <span>{topicMetadata.label ?? t('learningCard.path', 'Learning path')}</span>
            </div>
          )}
          <h3 className={cx(styles.title, isCompleted && styles.titleCompleted)}>
            {tile ? (
              <button
                type="button"
                className={styles.titleButton}
                onClick={onViewPath}
                disabled={launchDisabled}
                aria-current={selected || undefined}
              >
                {path.title}
              </button>
            ) : (
              path.title
            )}
          </h3>

          {tile && !presentation && path.description && <p className={styles.tileDescription}>{path.description}</p>}
          {tile && presentation === 'resume' && nextGuide && (
            <div className={styles.resumeNext} data-learning-next>
              <span>{t('coverPage.upNext', 'Up next')}</span>
              <strong>{nextGuide.title}</strong>
              {nextGuide.description && (
                <p className={cx(styles.tileDescription, styles.resumeDescription)}>{nextGuide.description}</p>
              )}
            </div>
          )}
          {resumeAction}

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
          <div className={styles.tileFooter} data-learning-card-footer>
            <div className={styles.tileProgress}>
              <ProgressRing
                progress={progress}
                size={presentation === 'compact' ? 32 : isCompleted ? 34 : 36}
                strokeWidth={2}
                isCompleted={isCompleted}
                showPercentage
              />
              <span className={styles.tileGuideCount}>
                {isCompleted && (
                  <span className={styles.completedLabel}>{t('learningCard.completed', 'Completed')}</span>
                )}
                <span>
                  {isLaunching && presentation !== 'resume' ? (
                    <span role="status">{t('learningCard.opening', 'Opening…')}</span>
                  ) : (
                    <span>{t('learningCard.path', 'Learning path')}</span>
                  )}
                  <span aria-hidden="true">·</span>
                  {isLoadingGuides
                    ? t('learningCard.loadingGuides', 'Loading guides…')
                    : presentation === 'resume' || presentation === 'compact'
                      ? guides.length === 1
                        ? t('myLearning.summaryOneGuide', '1 guide')
                        : t('myLearning.summaryGuides', '{{count}} guides', { count: guides.length })
                      : t('myLearning.guidesProgress', '{{completed}}/{{total}} guides', {
                          completed: completedCount,
                          total: guides.length,
                        })}
                </span>
                {presentation !== 'compact' &&
                  !imageDuration &&
                  typeof path.estimatedMinutes === 'number' &&
                  path.estimatedMinutes > 0 && (
                    <span>{t('packageBrowser.time', 'About {{minutes}} min', { minutes: path.estimatedMinutes })}</span>
                  )}
              </span>
            </div>
            {!isCompleted && assignment && <AssignmentBadges assignment={assignment} />}
          </div>
        )}
        {tile && launchError && (
          <p role="alert" className={styles.launchError}>
            {launchError}
          </p>
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
          {path.description && <p className={styles.description}>{path.description}</p>}
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
