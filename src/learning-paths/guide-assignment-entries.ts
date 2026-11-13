import { bundledTutorialCompletionSource } from '../lib/bundled-tutorial-identity';
import type { AssignmentEntry } from '../lib/assignments-client';
import type { CatalogPackage } from '../types/package-catalog.types';
import type { LearningPathEntry } from './learning-path-entries';
import { assignmentProgress, buildResolvedAssignment } from './assignments-core';

function sourceIdentity(source: string, id: string): string {
  const canonical = bundledTutorialCompletionSource(source, id);
  return canonical === 'online-cdn' ? 'interactive-tutorials' : canonical;
}

export function selectGuideAssignmentEntries(
  assignments: readonly AssignmentEntry[],
  catalog: readonly CatalogPackage[]
): LearningPathEntry[] {
  return assignments
    .filter((assignment) => assignment.targetType === 'guide')
    .map((assignment) => {
      const item = catalog.find(
        (candidate) =>
          candidate.format === 'guide' &&
          candidate.id === assignment.targetId &&
          sourceIdentity(candidate.key.slice(0, candidate.key.indexOf(':')), candidate.id) ===
            sourceIdentity(assignment.targetSource ?? '', assignment.targetId)
      );
      const title = item?.title ?? assignment.targetId;
      return {
        key: `assignment:guide:${assignment.targetSource}:${assignment.targetId}:${assignment.ruleId}:${assignment.assignedAt ?? ''}`,
        path: { id: assignment.targetId, title, description: '', guides: [], badgeId: '' },
        guides: [],
        percent: assignmentProgress(assignment.guides, 0),
        assignment: buildResolvedAssignment(assignment, { title }, assignmentProgress(assignment.guides, 0)),
        assignedGuide: item,
        isGuideAssignment: true,
      };
    });
}
