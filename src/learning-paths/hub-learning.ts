import type { LearningPath, PathGuide, ResolvedAssignment } from '../types/learning-paths.types';
import { getDueStatus, getPathAssignment } from './assignments-core';
import { getPathsData } from './paths-data';

export interface HubLearningDeps {
  paths: readonly LearningPath[];
  assignmentByTargetId: ReadonlyMap<string, ResolvedAssignment>;
  getPathProgress: (pathId: string) => number;
  isPathCompleted: (pathId: string) => boolean;
  getPathGuides: (pathId: string) => PathGuide[];
}

export interface HubResume {
  pathId: string;
  pathTitle: string;
  guideTitle: string;
  guideUrl: string;
  percent: number;
  moduleNumber: number;
  moduleCount: number;
  trackId?: string;
  trackLabel?: string;
  pathUrl?: string;
  manifest?: Record<string, unknown>;
  isPrivate?: boolean;
}

export type HubDue = { tone: 'today' | 'later' | 'overdue'; days: number; dueAt: string };

export interface HubStats {
  assignments: number;
  nextDue?: HubDue;
  inProgress: number;
  completed: number;
}

/** Per-guide URL first so a partially-completed URL-based path opens its next module, not its base (#744). */
function resolveCurrentGuideUrl(path: Pick<LearningPath, 'url'>, guide: Pick<PathGuide, 'id' | 'url'>): string {
  if (guide.url) {
    return guide.url;
  }
  if (path.url) {
    return path.url;
  }
  return getPathsData().guideMetadata[guide.id]?.url ?? `bundled:${guide.id}`;
}

function startedPaths(deps: HubLearningDeps): HubResume[] {
  const { paths, assignmentByTargetId, getPathProgress, isPathCompleted, getPathGuides } = deps;
  const resumes = paths.flatMap((path): HubResume[] => {
    const assignment = getPathAssignment(assignmentByTargetId, path);
    const percent = assignment?.progress ?? getPathProgress(path.id);
    const done = assignment ? assignment.satisfied : isPathCompleted(path.id);
    if (done || !(percent > 0)) {
      return [];
    }
    const guides = getPathGuides(path.id);
    const current = guides.find((guide) => guide.isCurrent);
    if (!current) {
      return [];
    }
    return [
      {
        pathId: path.id,
        pathTitle: path.title,
        guideTitle: current.title,
        guideUrl: resolveCurrentGuideUrl(path, current),
        percent,
        moduleNumber: guides.indexOf(current) + 1,
        moduleCount: guides.length,
        trackId: assignment?.trackId,
        trackLabel: assignment?.trackLabel,
        pathUrl: path.url,
        manifest: path.manifest,
        isPrivate: path.isPrivate,
      },
    ];
  });
  return resumes.sort((a, b) => b.percent - a.percent);
}

export function selectHubResume(deps: HubLearningDeps): HubResume | null {
  return startedPaths(deps)[0] ?? null;
}

export function selectHubStats(
  deps: HubLearningDeps,
  assignments: readonly ResolvedAssignment[],
  completedGuides: number
): HubStats {
  const due = assignments.find((assignment) => getDueStatus(assignment));
  const status = due && getDueStatus(due);
  return {
    assignments: assignments.length,
    nextDue: due?.dueAt && status ? { tone: status.tone, days: status.days, dueAt: due.dueAt } : undefined,
    inProgress: startedPaths(deps).length,
    completed: completedGuides,
  };
}
