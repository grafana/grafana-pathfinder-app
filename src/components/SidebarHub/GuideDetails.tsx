import React from 'react';
import { cx } from '@emotion/css';
import { Button, useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';
import type { Milestone } from '../../types/content.types';
import { getStyles } from '../../styles/context-panel.styles';
import { getSkeletonStyles } from '../../styles/skeleton.styles';
import { getSidebarHubStyles } from './sidebar-hub.styles';
import { Prerequisites } from '../Prerequisites';
import { LearningModuleList } from '../LearningContentCard/LearningModuleList';
import { getLearningContentCardStyles } from '../LearningContentCard/learning-content-card.styles';

export interface HubExpansion {
  expanded: boolean;
  hasDetails: boolean;
  hasModules: boolean;
  prerequisites?: unknown;
  modules: Milestone[];
  isResolving: boolean;
  totalSteps?: number;
  /** Completion percent by milestone id. */
  progress?: Record<string, number>;
  /** The milestone to resume at: labelled, announced as the current step, and scrolled into view. */
  currentIndex?: number;
  /** Shown above the milestone list, such as a track switch. */
  controls?: React.ReactNode;
  /** Set when the milestones could not be loaded; offers a retry. */
  onRetry?: () => void;
  onToggle: () => void;
  onOpenModule: (module: Milestone) => void | Promise<void>;
}

interface GuideDetailsProps {
  expansion: HubExpansion;
  loadingTestId?: string;
  moduleTestId?: (index: number) => string;
  onOpenModule: (module: Milestone) => void | Promise<void>;
}

const DEFERRED_PLACEHOLDER_ROWS = 3;

export function GuideDetails({ expansion, loadingTestId, moduleTestId, onOpenModule }: GuideDetailsProps) {
  const styles = useStyles2(getStyles);
  const skeletonStyles = useStyles2(getSkeletonStyles);
  const hubStyles = useStyles2(getSidebarHubStyles);
  const cardStyles = useStyles2(getLearningContentCardStyles);
  const { prerequisites, modules, isResolving, totalSteps, onRetry } = expansion;

  return (
    <>
      <Prerequisites prerequisites={prerequisites} compact />
      {expansion.controls}
      {isResolving && (
        <div
          className={cx(skeletonStyles.skeleton, styles.deferredSkeleton, hubStyles.detailsSkeleton)}
          data-testid={loadingTestId}
        >
          {Array.from({ length: totalSteps ? Math.min(totalSteps, DEFERRED_PLACEHOLDER_ROWS) : 2 }).map((_, index) => (
            <div key={index} className={styles.deferredSkeletonRow}>
              <div className={styles.deferredSkeletonCircle}></div>
              <div className={styles.deferredSkeletonBar}></div>
            </div>
          ))}
        </div>
      )}
      {onRetry && !isResolving && (
        <div className={cardStyles.error} role="alert">
          <p>{t('learningCard.membersError', 'Could not load milestone details.')}</p>
          <Button size="sm" variant="secondary" onClick={onRetry}>
            {t('learningCard.retry', 'Retry')}
          </Button>
        </div>
      )}
      {modules.length > 0 && (
        <div>
          <h4 className={hubStyles.detailsHeading}>{t('learningCard.modulesTitle', 'Milestones')}</h4>
          <LearningModuleList
            compact
            modules={modules}
            itemTestId={moduleTestId}
            onOpen={onOpenModule}
            progress={expansion.progress}
            currentIndex={expansion.currentIndex}
          />
        </div>
      )}
    </>
  );
}
