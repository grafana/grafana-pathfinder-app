import { config } from '@grafana/runtime';
import { PLUGIN_BASE_URL } from '../../constants';
import type {
  LearningInsightsAssignment,
  LearningInsightsCompletion,
  LearningInsightsPerson,
} from '../../types/learning-insights';
import { buildPathfinderShareUrl } from '../../utils/pathfinder-search-params';

export function personName(person: LearningInsightsPerson | undefined, userId: string): string {
  return person?.userDisplayName || person?.userLogin || userId;
}

const ONLINE_GUIDE_SOURCES = new Set(['online-cdn', 'interactive-tutorials']);

export function guideTitle(source: string, id: string, completions: LearningInsightsCompletion[]): string {
  const exactTitle = completions.find(
    (guide) => guide.guideId === id && guide.guideSource === source && guide.guideTitle
  )?.guideTitle;
  return (
    exactTitle ||
    (ONLINE_GUIDE_SOURCES.has(source)
      ? completions.find(
          (guide) => guide.guideId === id && ONLINE_GUIDE_SOURCES.has(guide.guideSource) && guide.guideTitle
        )?.guideTitle
      : undefined) ||
    id
  );
}

export function assignmentTitle(row: LearningInsightsAssignment, completions: LearningInsightsCompletion[]): string {
  return row.targetType === 'guide' ? guideTitle(row.targetSource, row.targetId, completions) : row.targetId;
}

export function assignmentIssue(reason: string): string {
  switch (reason) {
    case 'target-unresolved':
      return 'Learning content could not be found or its required guides could not be identified.';
    case 'target-fetch-failed':
      return 'Learning content could not be loaded. Refresh to retry.';
    case 'completion-history-incomplete':
      return 'Completion history could not be fully loaded. Refresh to retry.';
    case 'lifecycle-unsupported':
      return 'This assignment uses an unsupported state. Ask your administrator to check it.';
    default:
      return 'Completion could not be checked. Refresh, then ask your administrator to check the assignment.';
  }
}

export function assignmentStatus(status: LearningInsightsAssignment['status']): string {
  return status === 'unknown'
    ? 'Needs review'
    : status === 'complete'
      ? 'Complete'
      : status === 'overdue'
        ? 'Overdue'
        : status === 'withdrawn'
          ? 'Withdrawn'
          : 'Outstanding';
}

export function displayTime(value: string, timeZone = 'UTC'): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Not recorded'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(date);
}

export function displayDate(value: string, timeZone = 'UTC'): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone }).format(new Date(value));
}

export function completionMethod(value: string): string {
  switch (value) {
    case 'objectives':
      return 'Steps completed';
    case 'manual':
      return 'Marked complete';
    default:
      return 'Completion recorded';
  }
}

export function contentKey(source: string, id: string): string {
  return JSON.stringify([source, id]);
}

export function completionTrend(rows: LearningInsightsCompletion[], from: string, to: string) {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return [];
  }
  const days = (end - start) / 86400000;
  const bucketDays = days <= 7 ? 1 : days <= 42 ? 7 : Math.ceil(days / 49) * 7;
  const width = bucketDays * 86400000;
  const count = Math.ceil((end - start) / width);
  return Array.from({ length: count }, (_, index) => {
    const lower = start + width * index;
    const upper = Math.min(end, start + width * (index + 1));
    return {
      from: new Date(lower).toISOString(),
      to: new Date(upper).toISOString(),
      count: rows.filter((row) => Date.parse(row.completedAt) >= lower && Date.parse(row.completedAt) < upper).length,
    };
  });
}

export function assignmentCounts(rows: LearningInsightsAssignment[]) {
  return {
    complete: rows.filter((row) => row.status === 'complete').length,
    outstanding: rows.filter((row) => row.status === 'outstanding' || row.status === 'overdue').length,
    overdue: rows.filter((row) => row.status === 'overdue').length,
    unknown: rows.filter((row) => row.status === 'unknown').length,
    withdrawn: rows.filter((row) => row.status === 'withdrawn').length,
  };
}

export function learningLink(source: string, id: string, kind: string, origin = window.location.origin): string | null {
  if (!id || !['guide', 'path'].includes(kind) || !['app-platform', 'bundled'].includes(source)) {
    return null;
  }
  const base = new URL(`${config.appSubUrl ?? ''}${PLUGIN_BASE_URL}`, origin);
  if (!['http:', 'https:'].includes(base.protocol)) {
    return null;
  }
  const doc = source === 'app-platform' ? `backend-guide:${id}` : `bundled:${id}/content.json`;
  return buildPathfinderShareUrl({ base, doc, guideType: kind === 'path' ? 'learning-journey' : undefined });
}
