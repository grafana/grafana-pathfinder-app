import type { MyCompletionsResponseWire } from '../types/backend-api.schema';
import {
  RECOMMEND_COMPLETIONS_MAX_ITEMS,
  type RecommendCompletionItemWire,
  type RecommendCompletionsWire,
} from '../types/recommender-completions.schema';
import { isPublicGuideSource, normalizeGuideId } from './completion-identity';

export { RECOMMEND_COMPLETIONS_MAX_ITEMS };

interface Row {
  source: string;
  id: string;
  percent: number;
  method: string;
  count: number;
  completedAt: string;
  durationSeconds: number;
  startedAt: string;
  recordedAt: string;
}

// Unparseable and empty stamps are "missing": they never beat a parseable one.
function stampMs(stamp: string): number {
  return stamp === '' ? NaN : Date.parse(stamp);
}

function isLater(candidate: string, current: string): boolean {
  const c = stampMs(candidate);
  const t = stampMs(current);
  if (Number.isNaN(c)) {
    return false;
  }
  return Number.isNaN(t) || c > t;
}

function laterStamp(current: string, candidate: string): string {
  if (current === '') {
    return candidate;
  }
  return isLater(candidate, current) ? candidate : current;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.trunc(value)));
}

function normalizeSource(source: string): string {
  return source === 'online-cdn' ? 'interactive-tutorials' : source;
}

// `durationSeconds` is the latest completion's snapshot, not a total across attempts.
function mergeRows(current: Row, next: Row): Row {
  const owner = nextWins(current, next) ? next : current;
  return {
    source: current.source,
    id: current.id,
    percent: Math.max(current.percent, next.percent),
    method: owner.method,
    count: current.count + next.count,
    completedAt: owner.completedAt,
    durationSeconds: owner.durationSeconds,
    startedAt: laterStamp(current.startedAt, next.startedAt),
    recordedAt: laterStamp(current.recordedAt, next.recordedAt),
  };
}

function nextWins(current: Row, next: Row): boolean {
  if (next.completedAt === '') {
    return false;
  }
  return current.completedAt === '' || isLater(next.completedAt, current.completedAt);
}

function completedRow(c: MyCompletionsResponseWire['completions'][number]): Row {
  return {
    source: normalizeSource(c.guideSource),
    id: normalizeGuideId(c.guideId),
    percent: clampPercent(c.maxCompletionPercent),
    method: c.latestSource,
    count: Math.max(0, Math.trunc(c.count)),
    completedAt: c.latestCompletedAt,
    durationSeconds: c.latestDurationSeconds ?? 0,
    startedAt: c.latestAttemptStartedAt ?? '',
    recordedAt: c.lastRecordedAt ?? '',
  };
}

function partialRow(p: MyCompletionsResponseWire['inProgress'][number]): Row {
  return {
    source: normalizeSource(p.guideSource),
    id: normalizeGuideId(p.guideId),
    percent: clampPercent(p.completionPercent),
    method: '',
    count: 0,
    completedAt: '',
    durationSeconds: 0,
    startedAt: p.attemptStartedAt ?? '',
    recordedAt: p.lastUpdatedAt,
  };
}

function toItem(row: Row): RecommendCompletionItemWire {
  return {
    guide_source: row.source,
    guide_id: row.id,
    percent: row.percent,
    ...(row.method !== '' && { method: row.method }),
    count: row.count,
    ...(row.completedAt !== '' && { completed_at: row.completedAt }),
    ...(row.durationSeconds > 0 && { duration_seconds: row.durationSeconds }),
    ...(row.startedAt !== '' && { started_at: row.startedAt }),
    ...(row.recordedAt !== '' && { recorded_at: row.recordedAt }),
  };
}

function compareRows(a: Row, b: Row): number {
  const ta = stampMs(a.recordedAt);
  const tb = stampMs(b.recordedAt);
  const aMissing = Number.isNaN(ta);
  const bMissing = Number.isNaN(tb);
  if (aMissing !== bMissing) {
    return aMissing ? 1 : -1;
  }
  if (!aMissing && ta !== tb) {
    return tb - ta;
  }
  if (a.source !== b.source) {
    return a.source < b.source ? -1 : 1;
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
}

/**
 * Projects the `/my` response onto the recommender wire shape. Items are built
 * field by field so nothing outside the contract (userId, orgId, ...) can leak.
 */
export function projectRecommendCompletions(my: MyCompletionsResponseWire): RecommendCompletionsWire {
  const merged = new Map<string, Row>();
  const rows = [
    ...my.completions.filter((c) => isPublicGuideSource(c.guideSource, c.guideId)).map(completedRow),
    ...my.inProgress.filter((p) => isPublicGuideSource(p.guideSource, p.guideId)).map(partialRow),
  ];
  for (const row of rows) {
    const key = JSON.stringify([row.source, row.id]);
    const existing = merged.get(key);
    merged.set(key, existing ? mergeRows(existing, row) : row);
  }

  const sorted = [...merged.values()].sort(compareRows);
  const kept = sorted.slice(0, RECOMMEND_COMPLETIONS_MAX_ITEMS);
  return {
    v: 1,
    ...(my.asOf !== undefined && my.asOf !== '' && { as_of: my.asOf }),
    truncated: sorted.length > kept.length,
    items: kept.map(toItem),
  };
}
