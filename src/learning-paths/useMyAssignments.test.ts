/**
 * Tests for useMyAssignments: the fetch-once-on-mount/namespace-gated shape
 * (mirroring usePublishedGuides.test.ts's mocking style). Resolution rules
 * live in assignments-core.test.ts.
 */
import { act, renderHook, waitFor } from '@testing-library/react';

import type { LearningPath } from '../types/learning-paths.types';
import type { AssignmentEntry } from '../lib/assignments-client';

let mockNamespace: string | undefined = 'stacks-123';
const mockBackendGet = jest.fn();
jest.mock('@grafana/runtime', () => ({
  config: {
    get namespace() {
      return mockNamespace;
    },
  },
  getBackendSrv: () => ({ get: mockBackendGet }),
}));

jest.mock('../utils/interactive-guides-api', () => ({
  isBackendApiAvailable: () => true,
}));

const completionListeners = new Set<() => void>();
jest.mock('../completion-records/completion-write-hook', () => ({
  onCompletionPublished: (listener: () => void) => {
    completionListeners.add(listener);
    return () => completionListeners.delete(listener);
  },
}));

const mockFetchMyAssignments = jest.fn();
jest.mock('../lib/assignments-client', () => ({
  fetchMyAssignments: (namespace: string) => mockFetchMyAssignments(namespace),
}));

jest.mock('../lib/telemetry/facade', () => ({
  recordAssignmentTargetsUnresolved: jest.fn(),
  recordAssignmentsUnavailable: jest.fn(),
}));

// Empty by default so an unresolved target stays unresolved; tests override it for the online path.
const mockFetchOnlinePackageRecommendations = jest.fn();
jest.mock('../lib/package-recommendations-client', () => ({
  fetchOnlinePackageRecommendations: () => mockFetchOnlinePackageRecommendations(),
  buildPackageFileUrl: (baseUrl: string, entryPath: string, fileName: string) => `${baseUrl}${entryPath}/${fileName}`,
}));

const { recordAssignmentTargetsUnresolved: mockReportUnresolvedAssignmentTargets } = jest.requireMock(
  '../lib/telemetry/facade'
) as { recordAssignmentTargetsUnresolved: jest.Mock };

jest.mock('../lib/logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
}));

import { logger } from '../lib/logging';
import { useMyAssignments } from './useMyAssignments';

function path(overrides: Partial<LearningPath> & { id: string; title: string }): LearningPath {
  return { description: '', guides: [], badgeId: '', ...overrides };
}

function assignment(overrides: Partial<AssignmentEntry> & { targetId: string }): AssignmentEntry {
  return { targetType: 'path', satisfied: false, lifecycle: 'active', ...overrides };
}

const mockResolveNavLinks = jest.fn();
const noProgress = () => 0;
const noGuides = () => [];
const baseOptions = {
  getPathProgress: noProgress,
  getPathGuides: noGuides,
  completedGuides: [] as string[],
  resolveNavLinks: mockResolveNavLinks,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockNamespace = 'stacks-123';
  mockFetchOnlinePackageRecommendations.mockResolvedValue({ baseUrl: '', packages: [] });
  mockResolveNavLinks.mockResolvedValue([]);
});

describe('useMyAssignments', () => {
  it('reports empty and does not fetch when no namespace is available', async () => {
    mockNamespace = undefined;

    const { result } = renderHook(() => useMyAssignments({ ...baseOptions, paths: [] }));

    await waitFor(() => expect(result.current.items).toEqual([]));

    expect(result.current.notDone).toEqual([]);
    expect(mockFetchMyAssignments).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('resolves a fetched assignment into notDone', async () => {
    mockFetchMyAssignments.mockResolvedValue({ ok: true, assignments: [assignment({ targetId: 'fundamentals' })] });

    const { result } = renderHook(() =>
      useMyAssignments({
        ...baseOptions,
        paths: [path({ id: 'fundamentals', title: 'Grafana Fundamentals' })],
      })
    );

    await waitFor(() => expect(result.current.items).toHaveLength(1));

    expect(mockFetchMyAssignments).toHaveBeenCalledWith('stacks-123');
    expect(result.current.notDone.map((item) => item.title)).toEqual(['Grafana Fundamentals']);
    expect(result.current.assignmentByTargetId.get('fundamentals')?.title).toBe('Grafana Fundamentals');
    expect(logger.warn).not.toHaveBeenCalled();
    expect(mockReportUnresolvedAssignmentTargets).not.toHaveBeenCalled();
  });

  it('logs an unresolvable target without putting the path id on the warn', async () => {
    mockFetchMyAssignments.mockResolvedValue({ ok: true, assignments: [assignment({ targetId: 'ghost-path' })] });

    const { result } = renderHook(() =>
      useMyAssignments({
        ...baseOptions,
        paths: [path({ id: 'real-path', title: 'Real Path' })],
      })
    );

    await waitFor(() => expect(logger.warn).toHaveBeenCalled());

    expect(result.current.notDone).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('[assignments] unresolvable target', {
      reason: 'unresolvable-target',
      count: 1,
    });
    expect(logger.debug).toHaveBeenCalledWith('[assignments] unresolvable target', { targetIds: 'ghost-path' });
    expect(JSON.stringify((logger.warn as jest.Mock).mock.calls)).not.toContain('ghost-path');
    expect(mockReportUnresolvedAssignmentTargets).toHaveBeenCalledWith(1);
  });

  it("reflects local completion in an online target's guides", async () => {
    mockFetchMyAssignments.mockResolvedValue({ ok: true, assignments: [assignment({ targetId: 'online-path' })] });
    mockFetchOnlinePackageRecommendations.mockResolvedValue({
      baseUrl: 'https://cdn.example/',
      packages: [
        { id: 'online-path', type: 'path', title: 'Online path', path: 'online-path' },
        { id: 'g1', type: 'guide', title: 'Guide one', path: 'g1' },
        { id: 'g2', type: 'guide', title: 'Guide two', path: 'g2' },
      ],
    });
    mockResolveNavLinks.mockResolvedValue([
      { title: 'Online path', manifest: { id: 'online-path', type: 'path', milestones: ['g1', 'g2'] } },
    ]);

    const { result } = renderHook(() => useMyAssignments({ ...baseOptions, paths: [], completedGuides: ['g1'] }));

    await waitFor(() => expect(result.current.onlinePaths).toHaveLength(1));

    expect(result.current.getPathGuides('online-path').map((g) => [g.id, g.completed, g.isCurrent])).toEqual([
      ['g1', true, false],
      ['g2', false, true],
    ]);
  });

  it("returns a track assignment's guides in track order with the first incomplete current", async () => {
    mockFetchMyAssignments.mockResolvedValue({
      ok: true,
      assignments: [assignment({ targetId: 'p', trackId: 'ops' })],
    });
    const guide = (id: string, completed = false) => ({ id, title: id, completed, isCurrent: false });
    const manifest = {
      id: 'p',
      type: 'path',
      milestones: ['g1'],
      tracks: [{ trackId: 'ops', label: 'Ops', guides: ['g3', 'missing', 'g2'] }],
    } as LearningPath['manifest'];

    const { result } = renderHook(() =>
      useMyAssignments({
        ...baseOptions,
        paths: [path({ id: 'p', title: 'P', manifest })],
        getPathGuides: () => [guide('g1'), guide('g2'), guide('g3', true)],
      })
    );

    await waitFor(() => expect(result.current.items).toHaveLength(1));

    expect(result.current.getPathGuides('p').map(({ id, isCurrent }) => ({ id, isCurrent }))).toEqual([
      { id: 'g3', isCurrent: false },
      { id: 'g2', isCurrent: true },
    ]);
  });

  describe('completion-triggered refresh', () => {
    const ok = (...targetIds: string[]) => ({
      ok: true,
      assignments: targetIds.map((targetId) => assignment({ targetId })),
    });
    const catalogue = [path({ id: 'a', title: 'A' }), path({ id: 'b', title: 'B' })];

    it('runs one follow-up request after a completion lands mid-fetch, and applies it', async () => {
      const resolvers: Array<(v: unknown) => void> = [];
      mockFetchMyAssignments.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));

      const { result } = renderHook(() => useMyAssignments({ ...baseOptions, paths: catalogue }));
      await waitFor(() => expect(resolvers).toHaveLength(1));

      act(() => {
        completionListeners.forEach((listener) => listener());
        completionListeners.forEach((listener) => listener());
      });
      expect(mockFetchMyAssignments).toHaveBeenCalledTimes(1);

      await act(async () => resolvers[0]!(ok('a')));
      await waitFor(() => expect(resolvers).toHaveLength(2));
      await act(async () => resolvers[1]!(ok('b')));

      expect(mockFetchMyAssignments).toHaveBeenCalledTimes(2);
      expect(result.current.items.map((item) => item.targetId)).toEqual(['b']);
    });

    it('keeps the previous assignments when a refetch fails', async () => {
      mockFetchMyAssignments.mockResolvedValueOnce(ok('a')).mockResolvedValueOnce({ ok: false });

      const { result } = renderHook(() => useMyAssignments({ ...baseOptions, paths: catalogue }));
      await waitFor(() => expect(result.current.items).toHaveLength(1));

      await act(async () => completionListeners.forEach((listener) => listener()));

      expect(mockFetchMyAssignments).toHaveBeenCalledTimes(2);
      expect(result.current.items.map((item) => item.targetId)).toEqual(['a']);
    });

    it('keeps the previous assignments when a refetch gets the capability-unavailable envelope', async () => {
      mockFetchMyAssignments.mockImplementation(jest.requireActual('../lib/assignments-client').fetchMyAssignments);
      mockBackendGet
        .mockResolvedValueOnce({ capability: { available: true }, assignments: [assignment({ targetId: 'a' })] })
        .mockResolvedValueOnce({ capability: { available: false, reason: 'obo-unavailable' }, assignments: [] });

      const { result } = renderHook(() => useMyAssignments({ ...baseOptions, paths: catalogue }));
      await waitFor(() => expect(result.current.items).toHaveLength(1));

      await act(async () => completionListeners.forEach((listener) => listener()));

      expect(mockBackendGet).toHaveBeenCalledTimes(2);
      expect(result.current.items.map((item) => item.targetId)).toEqual(['a']);
    });

    it('stops listening for completions on unmount', async () => {
      mockFetchMyAssignments.mockResolvedValue(ok('a'));

      const { unmount } = renderHook(() => useMyAssignments({ ...baseOptions, paths: catalogue }));
      await waitFor(() => expect(mockFetchMyAssignments).toHaveBeenCalledTimes(1));
      unmount();

      expect(completionListeners.size).toBe(0);
      completionListeners.forEach((listener) => listener());
      expect(mockFetchMyAssignments).toHaveBeenCalledTimes(1);
    });
  });

  describe('unresolved-target telemetry', () => {
    const ok = (...targetIds: string[]) => ({
      ok: true,
      assignments: targetIds.map((targetId) => assignment({ targetId })),
    });
    const fire = () => act(async () => completionListeners.forEach((listener) => listener()));

    it('emits once when the same unresolved set is seen across refetches', async () => {
      mockFetchMyAssignments.mockResolvedValue(ok('ghost'));

      renderHook(() => useMyAssignments({ ...baseOptions, paths: [] }));
      await waitFor(() => expect(mockReportUnresolvedAssignmentTargets).toHaveBeenCalledTimes(1));

      await fire();
      await fire();

      expect(mockFetchMyAssignments).toHaveBeenCalledTimes(3);
      expect(mockReportUnresolvedAssignmentTargets).toHaveBeenCalledTimes(1);
    });

    it('emits again when the unresolved set changes', async () => {
      mockFetchMyAssignments.mockResolvedValueOnce(ok('ghost')).mockResolvedValueOnce(ok('ghost', 'phantom'));

      renderHook(() => useMyAssignments({ ...baseOptions, paths: [] }));
      await waitFor(() => expect(mockReportUnresolvedAssignmentTargets).toHaveBeenCalledWith(1));

      await fire();

      await waitFor(() => expect(mockReportUnresolvedAssignmentTargets).toHaveBeenLastCalledWith(2));
      expect(mockReportUnresolvedAssignmentTargets).toHaveBeenCalledTimes(2);
    });
  });
});
