import React from 'react';
import { cx } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';
import type { Milestone } from '../../types/content.types';
import { getStyles } from '../../styles/context-panel.styles';
import { getSkeletonStyles } from '../../styles/skeleton.styles';
import { getSidebarHubStyles } from './sidebar-hub.styles';
import { Prerequisites } from '../Prerequisites';
import { LearningModuleList } from '../LearningContentCard/LearningModuleList';

export interface HubExpansion {
  expanded: boolean;
  hasDetails: boolean;
  hasModules: boolean;
  prerequisites?: unknown;
  modules: Milestone[];
  isResolving: boolean;
  totalSteps?: number;
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
  const { prerequisites, modules, isResolving, totalSteps } = expansion;

  return (
    <>
      <Prerequisites prerequisites={prerequisites} compact />
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
      {modules.length > 0 && (
        <div>
          <h4 className={hubStyles.detailsHeading}>{t('learningCard.modulesTitle', 'Milestones')}</h4>
          <LearningModuleList compact modules={modules} itemTestId={moduleTestId} onOpen={onOpenModule} />
        </div>
      )}
    </>
  );
}
