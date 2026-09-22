/**
 * Tests for useMyAssignments: the fetch-once-on-mount/namespace-gated shape
 * (mirroring usePublishedGuides.test.ts's mocking style). Resolution rules
 * live in assignments-core.test.ts.
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

const noProgress = () => 0;
const neverCompleted = () => false;

beforeEach(() => {
  jest.clearAllMocks();
  mockNamespace = 'stacks-123';
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
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('resolves a fetched assignment into notDone', async () => {
    mockFetchMyAssignments.mockResolvedValue([assignment({ targetId: 'fundamentals' })]);

    const { result } = renderHook(() =>
      useMyAssignments({
        paths: [path({ id: 'fundamentals', title: 'Grafana Fundamentals' })],
        isPathCompleted: neverCompleted,
        getPathProgress: noProgress,
      })
    );

    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    expect(mockFetchMyAssignments).toHaveBeenCalledWith('stacks-123');
    expect(result.current.notDone.map((item) => item.title)).toEqual(['Grafana Fundamentals']);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs an unresolvable target without putting the path id on the warn', async () => {
    mockFetchMyAssignments.mockResolvedValue([assignment({ targetId: 'ghost-path' })]);

    const { result } = renderHook(() =>
      useMyAssignments({
        paths: [path({ id: 'real-path', title: 'Real Path' })],
        isPathCompleted: neverCompleted,
        getPathProgress: noProgress,
      })
    );

    await waitFor(() => expect(result.current.hasLoaded).toBe(true));
    await waitFor(() => expect(logger.warn).toHaveBeenCalled());

    expect(result.current.notDone).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('[assignments] unresolvable target', {
      reason: 'unresolvable-target',
      count: 1,
    });
    expect(logger.debug).toHaveBeenCalledWith('[assignments] unresolvable target', { targetIds: 'ghost-path' });
    expect(JSON.stringify((logger.warn as jest.Mock).mock.calls)).not.toContain('ghost-path');
  });
});
