/**
 * Resolution rules for Path Assignments, exercised directly rather than
 * through useMyAssignments: catalogue lookup, track labels, the wire
 * satisfaction boolean, overdue, and sort order.
 */
import type { AssignmentEntry } from '../lib/assignments-client';
import type { LearningPath } from '../types/learning-paths.types';
import { resolveAssignments, type ResolvedAssignment } from './assignments-core';

function path(overrides: Partial<LearningPath> & { id: string; title: string }): LearningPath {
  return { description: '', guides: [], badgeId: '', ...overrides };
}

function assignment(overrides: Partial<AssignmentEntry> & { targetId: string }): AssignmentEntry {
  return { targetType: 'path', satisfied: false, lifecycle: 'active', ...overrides };
}

const NOW = Date.parse('2026-06-15T00:00:00Z');
const noProgress = () => 0;

function resolve(options: {
  entries: AssignmentEntry[];
  paths: LearningPath[];
  getPathProgress?: (targetId: string) => number;
  now?: number;
}): { notDone: ResolvedAssignment[]; completed: ResolvedAssignment[]; unresolvedTargetIds: string[] } {
  const { items, unresolvedTargetIds } = resolveAssignments(
    options.entries,
    options.paths,
    options.getPathProgress ?? noProgress,
    options.now ?? NOW
  );
  return {
    notDone: items.filter((item) => !item.satisfied),
    completed: items.filter((item) => item.satisfied),
    unresolvedTargetIds,
  };
}

describe('resolveAssignments', () => {
  it('reports assignments whose path is not in the catalogue instead of rendering them', () => {
    const result = resolve({
      entries: [assignment({ targetId: 'ghost-path' })],
      paths: [path({ id: 'real-path', title: 'Real Path' })],
    });

    expect(result.notDone).toEqual([]);
    expect(result.completed).toEqual([]);
    expect(result.unresolvedTargetIds).toEqual(['ghost-path']);
  });

  it('drops a non-path target instead of treating it as a missing path', () => {
    const result = resolve({
      entries: [
        assignment({ targetId: 'github-visualize', targetType: 'guide' }),
        assignment({ targetId: 'fundamentals' }),
      ],
      paths: [path({ id: 'fundamentals', title: 'Grafana Fundamentals' })],
    });

    expect(result.notDone.map((item) => item.targetId)).toEqual(['fundamentals']);
    expect(result.notDone[0]!.targetType).toBe('path');
    expect(result.unresolvedTargetIds).toEqual([]);
  });

  it('resolves title from the matching path', () => {
    const result = resolve({
      entries: [assignment({ targetId: 'fundamentals' })],
      paths: [path({ id: 'fundamentals', title: 'Grafana Fundamentals' })],
    });

    expect(result.notDone).toHaveLength(1);
    expect(result.notDone[0]!.title).toBe('Grafana Fundamentals');
    expect(result.unresolvedTargetIds).toEqual([]);
  });

  it('formats assignedBy the same way as a track label', () => {
    const result = resolve({
      entries: [assignment({ targetId: 'fundamentals', assignedBy: 'l-and-d' })],
      paths: [path({ id: 'fundamentals', title: 'Grafana Fundamentals' })],
    });

    expect(result.notDone[0]!.assignedBy).toBe('L And D');
  });

  it('formats a kebab-case trackId into a display label without altering targetId', () => {
    const result = resolve({
      entries: [assignment({ targetId: 'fundamentals', trackId: 'seller-track' })],
      paths: [path({ id: 'fundamentals', title: 'Grafana Fundamentals' })],
    });

    expect(result.notDone[0]!.trackLabel).toBe('Seller Track');
    expect(result.notDone[0]!.targetId).toBe('fundamentals');
  });

  it('formats a snake_case trackId into a display label', () => {
    const result = resolve({
      entries: [assignment({ targetId: 'fundamentals', trackId: 'seller_track' })],
      paths: [path({ id: 'fundamentals', title: 'Grafana Fundamentals' })],
    });

    expect(result.notDone[0]!.trackLabel).toBe('Seller Track');
  });

  it('puts a wire-satisfied assignment in completed, not notDone', () => {
    const result = resolve({
      entries: [assignment({ targetId: 'p1', satisfied: true })],
      paths: [path({ id: 'p1', title: 'P1' })],
    });

    expect(result.completed).toHaveLength(1);
    expect(result.notDone).toHaveLength(0);
  });

  it('keeps two records for one path, and a wire false stays notDone', () => {
    const result = resolve({
      entries: [
        assignment({ targetId: 'p1', ruleId: 'annual-2025', satisfied: true, dueAt: '2025-12-31T00:00:00Z' }),
        assignment({ targetId: 'p1', ruleId: 'annual-2026', satisfied: false, dueAt: '2026-12-31T00:00:00Z' }),
      ],
      paths: [path({ id: 'p1', title: 'P1' })],
    });

    expect(result.completed).toHaveLength(1);
    expect(result.notDone).toHaveLength(1);
    expect(result.notDone[0]!.dueAt).toBe('2026-12-31T00:00:00Z');
  });

  it('flags overdue when dueAt is in the past and not satisfied', () => {
    const result = resolve({
      entries: [assignment({ targetId: 'p1', dueAt: '2026-01-01T00:00:00Z' })],
      paths: [path({ id: 'p1', title: 'P1' })],
    });

    expect(result.notDone[0]!.overdue).toBe(true);
  });

  it('does not flag overdue when satisfied, even past due', () => {
    const result = resolve({
      entries: [assignment({ targetId: 'p1', dueAt: '2026-01-01T00:00:00Z', satisfied: true })],
      paths: [path({ id: 'p1', title: 'P1' })],
    });

    expect(result.completed[0]!.overdue).toBe(false);
  });

  it('does not flag overdue on the due calendar day for a midnight-UTC timestamp', () => {
    const now = new Date();
    const dueAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T00:00:00Z`;

    const result = resolve({
      entries: [assignment({ targetId: 'p1', dueAt })],
      paths: [path({ id: 'p1', title: 'P1' })],
      now: now.getTime(),
    });

    expect(result.notDone[0]!.overdue).toBe(false);
  });

  it('does not flag overdue when dueAt is in the future', () => {
    const result = resolve({
      entries: [assignment({ targetId: 'p1', dueAt: '2026-12-01T00:00:00Z' })],
      paths: [path({ id: 'p1', title: 'P1' })],
    });

    expect(result.notDone[0]!.overdue).toBe(false);
  });

  it('sorts notDone overdue first, then soonest due date, then no-due-date', () => {
    const result = resolve({
      entries: [
        assignment({ targetId: 'satisfied-one', satisfied: true }),
        assignment({ targetId: 'no-due' }),
        assignment({ targetId: 'due-soon', dueAt: '2026-07-01T00:00:00Z' }),
        assignment({ targetId: 'overdue-one', dueAt: '2026-01-01T00:00:00Z' }),
      ],
      paths: [
        path({ id: 'satisfied-one', title: 'Satisfied' }),
        path({ id: 'no-due', title: 'No Due' }),
        path({ id: 'due-soon', title: 'Due Soon' }),
        path({ id: 'overdue-one', title: 'Overdue' }),
      ],
    });

    expect(result.notDone.map((item) => item.targetId)).toEqual(['overdue-one', 'due-soon', 'no-due']);
    expect(result.completed.map((item) => item.targetId)).toEqual(['satisfied-one']);
  });
});
