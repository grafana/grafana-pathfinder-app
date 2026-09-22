/**
 * Resolution rules for Path Assignments, exercised directly rather than
 * through useMyAssignments: catalogue lookup, track labels, the satisfaction
 * stand-in, overdue, window collapse, and sort order.
 */
import type { AssignmentEntry } from '../lib/assignments-client';
import type { LearningPath } from '../types/learning-paths.types';
import { collapseOverlappingWindows, resolveAssignments, type ResolvedAssignment } from './assignments-core';

function path(overrides: Partial<LearningPath> & { id: string; title: string }): LearningPath {
  return { description: '', guides: [], badgeId: '', ...overrides };
}

function assignment(overrides: Partial<AssignmentEntry> & { pathId: string }): AssignmentEntry {
  return { satisfied: false, lifecycle: 'active', ...overrides };
}

const NOW = Date.parse('2026-06-15T00:00:00Z');
const noProgress = () => 0;
const neverCompleted = () => false;

function resolve(options: {
  entries: AssignmentEntry[];
  paths: LearningPath[];
  isPathCompleted?: (pathId: string) => boolean;
  getPathProgress?: (pathId: string) => number;
  now?: number;
}): { notDone: ResolvedAssignment[]; completed: ResolvedAssignment[]; unresolvedPathIds: string[] } {
  const { items, unresolvedPathIds } = resolveAssignments(
    options.entries,
    options.paths,
    options.isPathCompleted ?? neverCompleted,
    options.getPathProgress ?? noProgress,
    options.now ?? NOW
  );
  return {
    notDone: items.filter((item) => !item.satisfied),
    completed: items.filter((item) => item.satisfied),
    unresolvedPathIds,
  };
}

describe('collapseOverlappingWindows', () => {
  it('merges duplicate records to the soonest due date and ORs satisfied', () => {
    const merged = collapseOverlappingWindows([
      assignment({ pathId: 'p1', ruleId: 'onboarding', dueAt: '2026-08-01T00:00:00Z', satisfied: false }),
      assignment({ pathId: 'p1', ruleId: 'annual-training', dueAt: '2026-07-01T00:00:00Z', satisfied: true }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.dueAt).toBe('2026-07-01T00:00:00Z');
    expect(merged[0]!.satisfied).toBe(true);
  });

  it('merges a whole-path record with a track-scoped record for the same path when their windows overlap', () => {
    const merged = collapseOverlappingWindows([
      assignment({ pathId: 'p1', ruleId: 'oncall', satisfied: false, dueAt: '2026-09-01T00:00:00Z' }),
      assignment({
        pathId: 'p1',
        ruleId: 'compliance',
        trackId: 'annual-compliance',
        satisfied: true,
        acceptCompletionsFrom: '2026-01-01T00:00:00Z',
        dueAt: '2026-08-15T00:00:00Z',
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.dueAt).toBe('2026-08-15T00:00:00Z');
    expect(merged[0]!.trackId).toBeUndefined();
    expect(merged[0]!.satisfied).toBe(true);
  });

  it('does not let a prior satisfied cycle swallow a later unbounded assignment', () => {
    const merged = collapseOverlappingWindows([
      assignment({
        pathId: 'observability-basics',
        ruleId: 'oncall-rotation-2026',
        assignedAt: '2026-08-01T09:00:00Z',
        dueAt: '2026-09-01T00:00:00Z',
        satisfied: false,
      }),
      assignment({
        pathId: 'observability-basics',
        trackId: 'annual-compliance',
        ruleId: 'annual-compliance-2025',
        assignedAt: '2025-01-06T09:00:00Z',
        dueAt: '2025-12-31T00:00:00Z',
        acceptCompletionsFrom: '2025-01-01T00:00:00Z',
        satisfied: true,
      }),
    ]);

    expect(merged).toHaveLength(2);
    expect(merged.map((entry) => entry.dueAt).sort()).toEqual(['2025-12-31T00:00:00Z', '2026-09-01T00:00:00Z']);
  });

  it("keeps same-pathId records separate when their accept/due windows don't overlap", () => {
    const merged = collapseOverlappingWindows([
      assignment({
        pathId: 'p1',
        ruleId: 'annual-2025',
        acceptCompletionsFrom: '2025-01-01T00:00:00Z',
        dueAt: '2025-12-31T00:00:00Z',
        satisfied: true,
      }),
      assignment({
        pathId: 'p1',
        ruleId: 'annual-2026',
        acceptCompletionsFrom: '2026-01-01T00:00:00Z',
        dueAt: '2026-12-31T00:00:00Z',
        satisfied: false,
      }),
    ]);

    expect(merged).toHaveLength(2);
    expect(merged.find((entry) => entry.satisfied)?.dueAt).toBe('2025-12-31T00:00:00Z');
    expect(merged.find((entry) => !entry.satisfied)?.dueAt).toBe('2026-12-31T00:00:00Z');
  });
});

describe('resolveAssignments', () => {
  it('reports assignments whose path is not in the catalogue instead of rendering them', () => {
    const result = resolve({
      entries: [assignment({ pathId: 'ghost-path' })],
      paths: [path({ id: 'real-path', title: 'Real Path' })],
    });

    expect(result.notDone).toEqual([]);
    expect(result.completed).toEqual([]);
    expect(result.unresolvedPathIds).toEqual(['ghost-path']);
  });

  it('resolves title from the matching path', () => {
    const result = resolve({
      entries: [assignment({ pathId: 'fundamentals' })],
      paths: [path({ id: 'fundamentals', title: 'Grafana Fundamentals' })],
    });

    expect(result.notDone).toHaveLength(1);
    expect(result.notDone[0]!.title).toBe('Grafana Fundamentals');
    expect(result.unresolvedPathIds).toEqual([]);
  });

  it('formats assignedBy the same way as a track label', () => {
    const result = resolve({
      entries: [assignment({ pathId: 'fundamentals', assignedBy: 'l-and-d' })],
      paths: [path({ id: 'fundamentals', title: 'Grafana Fundamentals' })],
    });

    expect(result.notDone[0]!.assignedBy).toBe('L And D');
  });

  it('formats a kebab-case trackId into a display label without altering pathId', () => {
    const result = resolve({
      entries: [assignment({ pathId: 'fundamentals', trackId: 'seller-track' })],
      paths: [path({ id: 'fundamentals', title: 'Grafana Fundamentals' })],
    });

    expect(result.notDone[0]!.trackLabel).toBe('Seller Track');
    expect(result.notDone[0]!.pathId).toBe('fundamentals');
  });

  it('formats a snake_case trackId into a display label', () => {
    const result = resolve({
      entries: [assignment({ pathId: 'fundamentals', trackId: 'seller_track' })],
      paths: [path({ id: 'fundamentals', title: 'Grafana Fundamentals' })],
    });

    expect(result.notDone[0]!.trackLabel).toBe('Seller Track');
  });

  it('puts a wire-satisfied assignment in completed, not notDone', () => {
    const result = resolve({
      entries: [assignment({ pathId: 'p1', satisfied: true })],
      paths: [path({ id: 'p1', title: 'P1' })],
    });

    expect(result.completed).toHaveLength(1);
    expect(result.notDone).toHaveLength(0);
  });

  it('puts a locally-complete assignment in completed even if the wire says false', () => {
    const result = resolve({
      entries: [assignment({ pathId: 'p1', satisfied: false })],
      paths: [path({ id: 'p1', title: 'P1' })],
      isPathCompleted: (id) => id === 'p1',
    });

    expect(result.completed).toHaveLength(1);
    expect(result.notDone).toHaveLength(0);
  });

  it('flags overdue when dueAt is in the past and not satisfied', () => {
    const result = resolve({
      entries: [assignment({ pathId: 'p1', dueAt: '2026-01-01T00:00:00Z' })],
      paths: [path({ id: 'p1', title: 'P1' })],
    });

    expect(result.notDone[0]!.overdue).toBe(true);
  });

  it('does not flag overdue when satisfied, even past due', () => {
    const result = resolve({
      entries: [assignment({ pathId: 'p1', dueAt: '2026-01-01T00:00:00Z', satisfied: true })],
      paths: [path({ id: 'p1', title: 'P1' })],
    });

    expect(result.completed[0]!.overdue).toBe(false);
  });

  it('does not flag overdue on the due calendar day for a midnight-UTC timestamp', () => {
    const now = new Date();
    const dueAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T00:00:00Z`;

    const result = resolve({
      entries: [assignment({ pathId: 'p1', dueAt })],
      paths: [path({ id: 'p1', title: 'P1' })],
      now: now.getTime(),
    });

    expect(result.notDone[0]!.overdue).toBe(false);
  });

  it('does not flag overdue when dueAt is in the future', () => {
    const result = resolve({
      entries: [assignment({ pathId: 'p1', dueAt: '2026-12-01T00:00:00Z' })],
      paths: [path({ id: 'p1', title: 'P1' })],
    });

    expect(result.notDone[0]!.overdue).toBe(false);
  });

  it('sorts notDone overdue first, then soonest due date, then no-due-date', () => {
    const result = resolve({
      entries: [
        assignment({ pathId: 'satisfied-one', satisfied: true }),
        assignment({ pathId: 'no-due' }),
        assignment({ pathId: 'due-soon', dueAt: '2026-07-01T00:00:00Z' }),
        assignment({ pathId: 'overdue-one', dueAt: '2026-01-01T00:00:00Z' }),
      ],
      paths: [
        path({ id: 'satisfied-one', title: 'Satisfied' }),
        path({ id: 'no-due', title: 'No Due' }),
        path({ id: 'due-soon', title: 'Due Soon' }),
        path({ id: 'overdue-one', title: 'Overdue' }),
      ],
    });

    expect(result.notDone.map((item) => item.pathId)).toEqual(['overdue-one', 'due-soon', 'no-due']);
    expect(result.completed.map((item) => item.pathId)).toEqual(['satisfied-one']);
  });
});
