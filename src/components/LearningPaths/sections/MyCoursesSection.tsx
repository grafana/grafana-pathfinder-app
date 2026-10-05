/**
 * Incomplete catalogue paths. Assigned paths lead, ranked by urgency;
 * unassigned paths keep the incoming order.
 */

import React, { useCallback, useMemo } from 'react';
import { Icon } from '@grafana/ui';
import { cx } from '@emotion/css';
import { t } from '@grafana/i18n';

import { testIds } from '../../../constants/testIds';
import type { LearningPath, PathGuide, ResolvedAssignment } from '../../../types/learning-paths.types';
import { compareResolvedAssignments } from '../../../learning-paths';
import { useVerticalOverflow } from '../../../hooks';
import { LearningPathCard } from '../LearningPathCard';
import type { getMyLearningStyles } from '../MyLearningTab.styles';

interface MyCoursesSectionProps {
  courses: LearningPath[];
  assignmentByTargetId: Map<string, ResolvedAssignment>;
  getPathGuides: (pathId: string) => PathGuide[];
  getPathProgress: (pathId: string) => number;
  onContinue: (guideId: string, pathId: string) => void;
  onReset: (pathId: string) => void;
  onResetGuides: (pathId: string, guides: ReadonlyArray<Pick<PathGuide, 'id' | 'url'>>) => Promise<void>;
  launchingPathId: string | null;
  launchDisabled: boolean;
  styles: ReturnType<typeof getMyLearningStyles>;
}

// Array.prototype.sort is stable, so unassigned paths keep their incoming order.
function orderCourses(
  courses: LearningPath[],
  activeById: (id: string) => ResolvedAssignment | undefined
): LearningPath[] {
  return [...courses].sort((a, b) => {
    const aAssignment = activeById(a.id);
    const bAssignment = activeById(b.id);
    if (aAssignment && bAssignment) {
      return compareResolvedAssignments(aAssignment, bAssignment);
    }
    return aAssignment ? -1 : bAssignment ? 1 : 0;
  });
}

export function MyCoursesSection({
  courses,
  assignmentByTargetId,
  getPathGuides,
  getPathProgress,
  onContinue,
  onReset,
  onResetGuides,
  launchingPathId,
  launchDisabled,
  styles,
}: MyCoursesSectionProps) {
  const [listRef, hasOverflow] = useVerticalOverflow<HTMLDivElement>();
  const activeAssignment = useCallback(
    (id: string) => {
      const assignment = assignmentByTargetId.get(id);
      return assignment && !assignment.satisfied ? assignment : undefined;
    },
    [assignmentByTargetId]
  );
  const ordered = useMemo(() => orderCourses(courses, activeAssignment), [courses, activeAssignment]);

  return (
    <div className={cx(styles.section, styles.columnSection)} data-testid={testIds.learningPaths.myCoursesSection}>
      <div className={styles.sectionHeader}>
        <Icon name="book-open" size="md" className={styles.sectionIcon} />
        <h2 className={styles.sectionTitle}>{t('myLearning.myCourses', 'My paths')}</h2>
      </div>
      <p className={styles.sectionDescription}>
        {t('myLearning.myCoursesDescription', "Assigned paths and paths you've started")}
      </p>

      {ordered.length === 0 ? (
        <div className={styles.emptyMessage}>
          <Icon name="book" size="xl" className={styles.emptyIcon} />
          <p>{t('myLearning.myCoursesEmpty', 'No learning paths available yet')}</p>
        </div>
      ) : (
        <div
          ref={listRef}
          className={cx(styles.pathsGrid, styles.scrollRegion, hasOverflow && styles.scrollRegionFaded)}
        >
          {ordered.map((path, index) => {
            const assignment = activeAssignment(path.id);
            const pathProgress = assignment ? assignment.progress : getPathProgress(path.id);
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
                onResetGuides={onResetGuides}
                defaultExpanded={isFirstInProgress}
                isLaunching={launchingPathId === path.id}
                launchDisabled={launchDisabled}
                assignment={assignment}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
