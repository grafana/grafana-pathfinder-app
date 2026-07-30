/**
 * My Courses Section
 *
 * The learning paths the user has (or could have) started — everything not yet
 * completed. Completed paths move to the Completed section.
 */

import React from 'react';
import { Icon } from '@grafana/ui';
import { t } from '@grafana/i18n';

import { testIds } from '../../../constants/testIds';
import type { LearningPath, PathGuide } from '../../../types/learning-paths.types';
import { LearningPathCard } from '../LearningPathCard';
import type { getMyLearningStyles } from '../MyLearningTab.styles';

interface MyCoursesSectionProps {
  courses: LearningPath[];
  showAll: boolean;
  onToggleShowAll: () => void;
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
  showAll,
  onToggleShowAll,
  getPathGuides,
  getPathProgress,
  onContinue,
  onReset,
  launchingPathId,
  launchDisabled,
  styles,
}: MyCoursesSectionProps) {
  const displayed = showAll ? courses : courses.slice(0, 4);

  return (
    <div className={styles.section} data-testid={testIds.learningPaths.myCoursesSection}>
      <div className={styles.sectionHeader}>
        <Icon name="book-open" size="md" className={styles.sectionIcon} />
        <h2 className={styles.sectionTitle}>{t('myLearning.myCourses', 'My courses')}</h2>
        {courses.length > 4 && (
          <button
            className={styles.expandButton}
            onClick={onToggleShowAll}
            data-testid={testIds.learningPaths.showAllPathsButton}
          >
            {showAll
              ? t('myLearning.showLess', 'Show less')
              : t('myLearning.viewAll', 'View all ({{count}})', { count: courses.length })}
            <Icon name={showAll ? 'angle-up' : 'angle-down'} size="sm" />
          </button>
        )}
      </div>
      <p className={styles.sectionDescription}>{t('myLearning.myCoursesDescription', "Paths you've started")}</p>

      {courses.length === 0 ? (
        <div className={styles.emptyMessage}>
          <Icon name="book" size="xl" className={styles.emptyIcon} />
          <p>{t('myLearning.myCoursesEmpty', "You haven't started a course yet — pick one from Discover more")}</p>
        </div>
      ) : (
        <div className={styles.pathsGrid}>
          {displayed.map((path, index) => {
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
