import type {
  LearningInsightsAssignment,
  LearningInsightsCompletion,
  LearningInsightsPerson,
} from '../../types/learning-insights';
import { buildPathfinderShareUrl } from '../../utils/pathfinder-search-params';

export function personName(person: LearningInsightsPerson | undefined, userId: string): string {
  return person?.userDisplayName || person?.userLogin || userId;
}

export function defaultWindow(days = 28, now = new Date()) {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - days);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function utcDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toISOString().slice(0, 10);
}

export function utcTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toISOString().replace('T', ' ').replace('.000Z', ' UTC');
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
  const count = Math.min(4, Math.max(1, Math.ceil((end - start) / 86400000)));
  const width = (end - start) / count;
  return Array.from({ length: count }, (_, index) => {
    const lower = start + width * index;
    const upper = index === count - 1 ? end : start + width * (index + 1);
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
  const base = new URL('/a/grafana-pathfinder-app', origin);
  if (!['http:', 'https:'].includes(base.protocol)) {
    return null;
  }
  const doc = source === 'app-platform' ? `backend-guide:${id}` : `bundled:${id}/content.json`;
  return buildPathfinderShareUrl({ base, doc, guideType: kind === 'path' ? 'learning-journey' : undefined });
}
