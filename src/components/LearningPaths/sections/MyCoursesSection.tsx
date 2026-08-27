/**
 * My Courses Section
 *
 * The learning paths the user has (or could have) started — everything not yet
 * completed. Completed paths move to the Completed section.
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

interface MyCoursesSectionProps {
  courses: LearningPath[];
  getPathGuides: (pathId: string) => PathGuide[];
  getPathProgress: (pathId: string) => number;
  onContinue: (guideId: string, pathId: string) => void;
  onReset: (pathId: string) => void;
  launchingPathId: string | null;
  launchDisabled: boolean;
  styles: ReturnType<typeof getMyLearningStyles>;
}

export function MyCoursesSection({
  courses,
  getPathGuides,
  getPathProgress,
  onContinue,
  onReset,
  launchingPathId,
  launchDisabled,
  styles,
}: MyCoursesSectionProps) {
  const [listRef, hasOverflow] = useVerticalOverflow<HTMLDivElement>();

  return (
    <div className={cx(styles.section, styles.columnSection)} data-testid={testIds.learningPaths.myCoursesSection}>
      <div className={styles.sectionHeader}>
        <Icon name="book-open" size="md" className={styles.sectionIcon} />
        <h2 className={styles.sectionTitle}>{t('myLearning.myCourses', 'My paths')}</h2>
      </div>
      <p className={styles.sectionDescription}>
        {t('myLearning.myCoursesDescription', 'Paths to explore and continue')}
      </p>

      {courses.length === 0 ? (
        <div className={styles.emptyMessage}>
          <Icon name="book" size="xl" className={styles.emptyIcon} />
          <p>{t('myLearning.myCoursesEmpty', 'No learning paths available yet')}</p>
        </div>
      ) : (
        <div
          ref={listRef}
          className={cx(styles.pathsGrid, styles.scrollRegion, hasOverflow && styles.scrollRegionFaded)}
        >
          {courses.map((path, index) => {
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
      )}
    </div>
  );
}
