/**
 * My Courses Section
 *
 * Incomplete catalogue paths. Assigned items with a due date lead, soonest
 * first; everything else keeps the incoming order. Completed paths move to
 * the Completed section.
 */

import React, { useMemo } from 'react';
import { Icon } from '@grafana/ui';
import { cx } from '@emotion/css';
import { t } from '@grafana/i18n';

import { testIds } from '../../../constants/testIds';
import type { LearningPath, PathGuide } from '../../../types/learning-paths.types';
import type { ResolvedAssignment } from '../../../learning-paths';
import { useVerticalOverflow } from '../../../hooks';
import { LearningPathCard } from '../LearningPathCard';
import type { getMyLearningStyles } from '../MyLearningTab.styles';

interface MyCoursesSectionProps {
  courses: LearningPath[];
  assignments: ResolvedAssignment[];
  getPathGuides: (pathId: string) => PathGuide[];
  getPathProgress: (pathId: string) => number;
  onContinue: (guideId: string, pathId: string) => void;
  onReset: (pathId: string) => void;
  launchingPathId: string | null;
  launchDisabled: boolean;
  styles: ReturnType<typeof getMyLearningStyles>;
}

function orderCourses(courses: LearningPath[], byPathId: Map<string, ResolvedAssignment>): LearningPath[] {
  return [...courses].sort((a, b) => {
    const aDue = byPathId.get(a.id)?.dueAt;
    const bDue = byPathId.get(b.id)?.dueAt;
    if (aDue && bDue) {
      return aDue.localeCompare(bDue);
    }
    if (aDue) {
      return -1;
    }
    if (bDue) {
      return 1;
    }
    return 0;
  });
}

export function MyCoursesSection({
  courses,
  assignments,
  getPathGuides,
  getPathProgress,
  onContinue,
  onReset,
  launchingPathId,
  launchDisabled,
  styles,
}: MyCoursesSectionProps) {
  const [listRef, hasOverflow] = useVerticalOverflow<HTMLDivElement>();
  const byPathId = useMemo(() => new Map(assignments.map((a) => [a.pathId, a])), [assignments]);
  const ordered = useMemo(() => orderCourses(courses, byPathId), [courses, byPathId]);

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
            const pathProgress = getPathProgress(path.id);
            const isFirstInProgress = index === 0 && pathProgress > 0;
            const assignment = byPathId.get(path.id);

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
                assignment={
                  assignment
                    ? { assignedBy: assignment.assignedBy, dueAt: assignment.dueAt, overdue: assignment.overdue }
                    : undefined
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
