/**
 * My Courses Section
 *
 * Incomplete catalogue paths. Assigned paths always lead, ranked by due
 * date (soonest first, undated-but-assigned after those, unassigned last);
 * unassigned paths otherwise keep the incoming order. Completed paths move
 * to the Completed section.
 */

import React, { useMemo } from 'react';
import { Icon } from '@grafana/ui';
import { cx } from '@emotion/css';
import { t } from '@grafana/i18n';

import { testIds } from '../../../constants/testIds';
import type { LearningPath, PathGuide } from '../../../types/learning-paths.types';
import { compareDueAt, type ResolvedAssignment } from '../../../learning-paths';
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

// Assigned paths always lead, ranked by due date; unassigned paths keep
// their incoming order (Array.prototype.sort is stable, so ties never
// reorder them relative to each other).
function orderCourses(courses: LearningPath[], byTargetId: Map<string, ResolvedAssignment>): LearningPath[] {
  return [...courses].sort((a, b) => {
    const aAssignment = byTargetId.get(a.id);
    const bAssignment = byTargetId.get(b.id);
    if (Boolean(aAssignment) !== Boolean(bAssignment)) {
      return aAssignment ? -1 : 1;
    }
    if (!aAssignment || !bAssignment) {
      return 0;
    }
    const aDue = aAssignment.dueAt;
    const bDue = bAssignment.dueAt;
    if (aDue && bDue) {
      return compareDueAt(aDue, bDue);
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
  // `assignments` arrives sorted most-urgent-first (resolveAssignments):
  // overdue, then soonest due, then no-due-date. Two active rules can target
  // the same path — shapeAssignments keeps both rows rather than collapsing
  // them — so build this map first-wins, keeping the most urgent one visible
  // instead of `new Map(entries)`'s last-wins, which would silently surface
  // whichever duplicate happens to sort last.
  const byTargetId = useMemo(() => {
    const map = new Map<string, ResolvedAssignment>();
    for (const assignment of assignments) {
      if (!map.has(assignment.targetId)) {
        map.set(assignment.targetId, assignment);
      }
    }
    return map;
  }, [assignments]);
  const ordered = useMemo(() => orderCourses(courses, byTargetId), [courses, byTargetId]);

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
            const assignment = byTargetId.get(path.id);

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
