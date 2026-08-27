/**
 * Private Paths Section
 *
 * The org's own App Platform paths, split out from the curated ones in My
 * paths. Renders nothing when there are none; completed ones move to the
 * Completed section.
 */

import React from 'react';
import { Icon } from '@grafana/ui';
import { cx } from '@emotion/css';
import { t } from '@grafana/i18n';

import { testIds } from '../../../constants/testIds';
import type { LearningPath, PathGuide } from '../../../types/learning-paths.types';
import { useVerticalOverflow } from '../../../hooks';
import { LearningPathCard } from '../LearningPathCard';
import type { getMyLearningStyles } from '../MyLearningTab.styles';

interface PrivatePathsSectionProps {
  paths: LearningPath[];
  getPathGuides: (pathId: string) => PathGuide[];
  getPathProgress: (pathId: string) => number;
  onContinue: (guideId: string, pathId: string) => void;
  onReset: (pathId: string) => void;
  launchingPathId: string | null;
  launchDisabled: boolean;
  styles: ReturnType<typeof getMyLearningStyles>;
}

export function PrivatePathsSection({
  paths,
  getPathGuides,
  getPathProgress,
  onContinue,
  onReset,
  launchingPathId,
  launchDisabled,
  styles,
}: PrivatePathsSectionProps) {
  const [listRef, hasOverflow] = useVerticalOverflow<HTMLDivElement>();

  if (paths.length === 0) {
    return null;
  }

  return (
    <div className={cx(styles.section, styles.columnSection)} data-testid={testIds.learningPaths.privatePathsSection}>
      <div className={styles.sectionHeader}>
        <Icon name="lock" size="md" className={styles.sectionIcon} />
        <h2 className={styles.sectionTitle}>{t('myLearning.privatePaths', 'Private paths')}</h2>
      </div>
      <p className={styles.sectionDescription}>
        {t('myLearning.privatePathsDescription', 'Paths published for your organization')}
      </p>

      <div ref={listRef} className={cx(styles.pathsGrid, styles.scrollRegion, hasOverflow && styles.scrollRegionFaded)}>
        {paths.map((path, index) => {
          const pathProgress = getPathProgress(path.id);
          const isFirstInProgress = index === 0 && pathProgress > 0;

          return (
            <LearningPathCard
              key={path.id}
              path={path}
              guides={getPathGuides(path.id)}
              progress={pathProgress}
              isCompleted={false}
              onContinue={onContinue}
              onReset={onReset}
              defaultExpanded={isFirstInProgress}
              isLaunching={launchingPathId === path.id}
              launchDisabled={launchDisabled}
            />
          );
        })}
      </div>
    </div>
  );
}
