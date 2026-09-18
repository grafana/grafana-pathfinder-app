/**
 * Tests for useMyAssignments: the fetch-once-on-mount/namespace-gated shape
 * (mirroring usePublishedGuides.test.ts's mocking style) plus the resolution
 * behavior formerly covered by resolve-assignments.test.ts — dropping
 * unresolvable targets, title lookup, track-label formatting, the
 * satisfied-OR-locally-complete fallback, overdue, window-based merging,
 * and sort order — now exercised through the hook's own return value instead
 * of a standalone pure function. Assertions read `notDone`/`completed`
 * (the hook's pre-split return shape) rather than a flat `assignments` list.
 */
import { renderHook, waitFor } from '@testing-library/react';

import type { LearningPath } from '../types/learning-paths.types';
import type { AssignmentEntry } from '../lib/assignments-client';

let mockNamespace: string | undefined = 'stacks-123';
jest.mock('@grafana/runtime', () => ({
  config: {
    get namespace() {
      return mockNamespace;
    },
  },
}));

const mockFetchMyAssignments = jest.fn();
jest.mock('../lib/assignments-client', () => ({
  fetchMyAssignments: (namespace: string) => mockFetchMyAssignments(namespace),
}));

import { useMyAssignments } from './useMyAssignments';

function path(overrides: Partial<LearningPath> & { id: string; title: string }): LearningPath {
  return { description: '', guides: [], badgeId: '', ...overrides };
}

function assignment(overrides: Partial<AssignmentEntry> & { pathId: string }): AssignmentEntry {
  return { satisfied: false, lifecycle: 'active', ...overrides };
}

const NOW = Date.parse('2026-06-15T00:00:00Z');
const noProgress = () => 0;
const neverCompleted = () => false;

function renderAssignments(options: {
  entries: AssignmentEntry[];
  paths: LearningPath[];
  isPathCompleted?: (pathId: string) => boolean;
  getPathProgress?: (pathId: string) => number;
}) {
  mockFetchMyAssignments.mockResolvedValue(options.entries);
  return renderHook(() =>
    useMyAssignments({
      paths: options.paths,
      isPathCompleted: options.isPathCompleted ?? neverCompleted,
      getPathProgress: options.getPathProgress ?? noProgress,
    })
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNamespace = 'stacks-123';
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useMyAssignments', () => {
  it('reports empty and does not fetch when no namespace is available', async () => {
    mockNamespace = undefined;

    const { result } = renderHook(() =>
      useMyAssignments({ paths: [], isPathCompleted: neverCompleted, getPathProgress: noProgress })
    );

    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    expect(result.current.notDone).toEqual([]);
    expect(result.current.completed).toEqual([]);
    expect(mockFetchMyAssignments).not.toHaveBeenCalled();
  });

  it('drops assignments whose path is not in the catalogue', async () => {
    const { result } = renderAssignments({
      entries: [assignment({ pathId: 'ghost-path' })],
      paths: [path({ id: 'real-path', title: 'Real Path' })],
    });

    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    expect(result.current.notDone).toEqual([]);
    expect(result.current.completed).toEqual([]);
  });

  it('resolves title from the matching path', async () => {
    const { result } = renderAssignments({
      entries: [assignment({ pathId: 'fundamentals' })],
      paths: [path({ id: 'fundamentals', title: 'Grafana Fundamentals' })],
    });

    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    expect(result.current.notDone).toHaveLength(1);
    expect(result.current.notDone[0]!.title).toBe('Grafana Fundamentals');
  });

  it('formats assignedBy the same way as a track label', async () => {
    const { result } = renderAssignments({
      entries: [assignment({ pathId: 'fundamentals', assignedBy: 'l-and-d' })],
      paths: [path({ id: 'fundamentals', title: 'Grafana Fundamentals' })],
    });

    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    expect(result.current.notDone[0]!.assignedBy).toBe('L And D');
  });

  it('formats a kebab-case trackId into a display label without altering pathId', async () => {
    const { result } = renderAssignments({
      entries: [assignment({ pathId: 'fundamentals', trackId: 'seller-track' })],
      paths: [path({ id: 'fundamentals', title: 'Grafana Fundamentals' })],
    });

    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    expect(result.current.notDone[0]!.trackLabel).toBe('Seller Track');
    expect(result.current.notDone[0]!.pathId).toBe('fundamentals');
  });

  it('formats a snake_case trackId into a display label', async () => {
    const { result } = renderAssignments({
      entries: [assignment({ pathId: 'fundamentals', trackId: 'seller_track' })],
      paths: [path({ id: 'fundamentals', title: 'Grafana Fundamentals' })],
    });

    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    expect(result.current.notDone[0]!.trackLabel).toBe('Seller Track');
  });

  it('puts a wire-satisfied assignment in completed, not notDone', async () => {
    const { result } = renderAssignments({
      entries: [assignment({ pathId: 'p1', satisfied: true })],
      paths: [path({ id: 'p1', title: 'P1' })],
    });

    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    expect(result.current.completed).toHaveLength(1);
    expect(result.current.notDone).toHaveLength(0);
  });

  it('puts a locally-complete assignment in completed even if the wire says false', async () => {
    const { result } = renderAssignments({
      entries: [assignment({ pathId: 'p1', satisfied: false })],
      paths: [path({ id: 'p1', title: 'P1' })],
      isPathCompleted: (id) => id === 'p1',
    });

    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    expect(result.current.completed).toHaveLength(1);
    expect(result.current.notDone).toHaveLength(0);
  });

  it('flags overdue when dueAt is in the past and not satisfied', async () => {
    const { result } = renderAssignments({
      entries: [assignment({ pathId: 'p1', dueAt: '2026-01-01T00:00:00Z' })],
      paths: [path({ id: 'p1', title: 'P1' })],
    });

    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    expect(result.current.notDone[0]!.overdue).toBe(true);
  });

  it('does not flag overdue when satisfied, even past due', async () => {
    const { result } = renderAssignments({
      entries: [assignment({ pathId: 'p1', dueAt: '2026-01-01T00:00:00Z', satisfied: true })],
      paths: [path({ id: 'p1', title: 'P1' })],
    });

    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    expect(result.current.completed[0]!.overdue).toBe(false);
  });

  it('does not flag overdue on the due calendar day for a midnight-UTC timestamp', async () => {
    const now = new Date();
    const dueAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T00:00:00Z`;

    const { result } = renderAssignments({
      entries: [assignment({ pathId: 'p1', dueAt })],
      paths: [path({ id: 'p1', title: 'P1' })],
    });

    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    expect(result.current.notDone[0]!.overdue).toBe(false);
  });

  it('does not flag overdue when dueAt is in the future', async () => {
    const { result } = renderAssignments({
      entries: [assignment({ pathId: 'p1', dueAt: '2026-12-01T00:00:00Z' })],
      paths: [path({ id: 'p1', title: 'P1' })],
    });

    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    expect(result.current.notDone[0]!.overdue).toBe(false);
  });

  it('merges duplicate (path, track) records to the soonest due date and ORs satisfied', async () => {
    const { result } = renderAssignments({
      entries: [
        assignment({ pathId: 'p1', ruleId: 'onboarding', dueAt: '2026-08-01T00:00:00Z', satisfied: false }),
        assignment({ pathId: 'p1', ruleId: 'annual-training', dueAt: '2026-07-01T00:00:00Z', satisfied: true }),
      ],
      paths: [path({ id: 'p1', title: 'P1' })],
    });

    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    expect(result.current.notDone).toHaveLength(0);
    expect(result.current.completed).toHaveLength(1);
    expect(result.current.completed[0]!.dueAt).toBe('2026-07-01T00:00:00Z');
  });

  it('merges a whole-path record with a track-scoped record for the same path when their windows overlap', async () => {
    // Same material, overlapping windows -> one obligation: completing it
    // satisfies both, regardless of which rule (or track) assigned it.
    const { result } = renderAssignments({
      entries: [
        assignment({ pathId: 'p1', ruleId: 'oncall', satisfied: false, dueAt: '2026-09-01T00:00:00Z' }),
        assignment({
          pathId: 'p1',
          ruleId: 'compliance',
          trackId: 'annual-compliance',
          satisfied: true,
          acceptCompletionsFrom: '2026-01-01T00:00:00Z',
          dueAt: '2026-08-15T00:00:00Z',
        }),
      ],
      paths: [path({ id: 'p1', title: 'P1' })],
    });

    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    expect(result.current.notDone).toHaveLength(0);
    expect(result.current.completed).toHaveLength(1);
    expect(result.current.completed[0]!.dueAt).toBe('2026-08-15T00:00:00Z');
    expect(result.current.completed[0]!.trackLabel).toBeUndefined();
  });

  it('does not let a prior satisfied cycle swallow a later unbounded assignment', async () => {
    // Fixture shape: last year's track-scoped cycle is done; this year's
    // whole-path row has a due date but no acceptCompletionsFrom. assignedAt
    // has to bound that window or the merge ORs satisfied and the current
    // obligation disappears from My paths and the panel.
    const { result } = renderAssignments({
      entries: [
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
      ],
      paths: [path({ id: 'observability-basics', title: 'Observability basics' })],
    });

    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    expect(result.current.notDone).toHaveLength(1);
    expect(result.current.completed).toHaveLength(1);
    expect(result.current.notDone[0]!.dueAt).toBe('2026-09-01T00:00:00Z');
    expect(result.current.completed[0]!.trackLabel).toBe('Annual Compliance');
  });

  it("keeps same-pathId records separate when their accept/due windows don't overlap", async () => {
    // Two disjoint annual cycles for the same path — merging these would
    // let last year's completion silently satisfy this year's obligation.
    const { result } = renderAssignments({
      entries: [
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
      ],
      paths: [path({ id: 'p1', title: 'P1' })],
    });

    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    expect(result.current.notDone).toHaveLength(1);
    expect(result.current.completed).toHaveLength(1);
    expect(result.current.notDone[0]!.dueAt).toBe('2026-12-31T00:00:00Z');
    expect(result.current.completed[0]!.dueAt).toBe('2025-12-31T00:00:00Z');
  });

  it('sorts notDone overdue first, then soonest due date, then no-due-date', async () => {
    const { result } = renderAssignments({
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

    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    expect(result.current.notDone.map((r) => r.pathId)).toEqual(['overdue-one', 'due-soon', 'no-due']);
    expect(result.current.completed.map((r) => r.pathId)).toEqual(['satisfied-one']);
  });
});
