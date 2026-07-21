/**
 * Focused test for App Platform path/journey runtime ingestion
 * (RFC CUSTOM-GUIDE-PACKAGES.md §6.11) — merging into `paths` and
 * `resolveGuideMetadata`'s fallback tier. Other hook behavior (badges,
 * streaks, resets) is exercised elsewhere; this file mocks those
 * dependencies down to no-ops to isolate the merge logic.
 */
import { renderHook, waitFor } from '@testing-library/react';

let mockNamespace: string | undefined = 'stacks-123';
jest.mock('@grafana/runtime', () => ({
  config: {
    get namespace() {
      return mockNamespace;
    },
  },
}));

const mockFetchAppPlatformLearningPaths = jest.fn();
jest.mock('./app-platform-paths', () => ({
  fetchAppPlatformLearningPaths: (namespace: string) => mockFetchAppPlatformLearningPaths(namespace),
}));

jest.mock('./fetch-path-guides', () => ({
  fetchPathGuides: jest.fn().mockResolvedValue(null),
}));

jest.mock('./paths-data', () => ({
  getPathsData: () => ({
    paths: [{ id: 'bundled-path', title: 'Bundled path', description: '', guides: ['bundled-guide'], badgeId: '' }],
    guideMetadata: { 'bundled-guide': { title: 'Bundled guide', estimatedMinutes: 5 } },
  }),
}));

jest.mock('../lib/user-storage', () => ({
  learningProgressStorage: {
    get: jest.fn().mockResolvedValue({
      completedGuides: [],
      earnedBadges: [],
      streakDays: 0,
      lastActivityDate: '',
      pendingCelebrations: [],
    }),
    dismissCelebration: jest.fn(),
    removeCompletedGuides: jest.fn(),
  },
  interactiveStepStorage: { clearAllForContent: jest.fn() },
  interactiveCompletionStorage: { getAll: jest.fn().mockResolvedValue({}), clear: jest.fn() },
  journeyCompletionStorage: { getAll: jest.fn().mockResolvedValue({}), clear: jest.fn() },
  milestoneCompletionStorage: { clear: jest.fn() },
}));

jest.mock('./badge-coordinator', () => ({
  markGuideCompleted: jest.fn(),
}));

jest.mock('../global-state/completion-store', () => ({
  evictContentCache: jest.fn(),
}));

import { useLearningPaths } from './learning-paths.hook';

beforeEach(() => {
  jest.clearAllMocks();
  mockNamespace = 'stacks-123';
});

describe('useLearningPaths — App Platform path ingestion', () => {
  it('merges App Platform paths after bundled paths', async () => {
    mockFetchAppPlatformLearningPaths.mockResolvedValue({
      paths: [
        {
          id: 'fe-alerting-path',
          title: 'Alerting enablement',
          description: 'Alerting enablement',
          guides: ['fe-alerting-01'],
          badgeId: '',
        },
      ],
      guideMetadata: {
        'fe-alerting-01': { title: 'Alerting module 1', estimatedMinutes: 5, url: 'backend-guide:fe-alerting-01' },
      },
    });

    const { result } = renderHook(() => useLearningPaths());

    await waitFor(() => expect(result.current.paths.map((p) => p.id)).toContain('fe-alerting-path'));

    expect(result.current.paths.map((p) => p.id)).toEqual(['bundled-path', 'fe-alerting-path']);
  });

  it('resolves App Platform guide metadata (title + backend-guide: url) via getGuideUrlForPath', async () => {
    mockFetchAppPlatformLearningPaths.mockResolvedValue({
      paths: [
        { id: 'fe-alerting-path', title: 'Alerting enablement', description: '', guides: ['fe-alerting-01'], badgeId: '' },
      ],
      guideMetadata: {
        'fe-alerting-01': { title: 'Alerting module 1', estimatedMinutes: 5, url: 'backend-guide:fe-alerting-01' },
      },
    });

    const { result } = renderHook(() => useLearningPaths());

    await waitFor(() => expect(result.current.paths.map((p) => p.id)).toContain('fe-alerting-path'));

    expect(result.current.getGuideUrlForPath('fe-alerting-01', 'fe-alerting-path')).toBe(
      'backend-guide:fe-alerting-01'
    );
  });

  it('does not fetch when no namespace is available', async () => {
    mockNamespace = undefined;

    const { result } = renderHook(() => useLearningPaths());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockFetchAppPlatformLearningPaths).not.toHaveBeenCalled();
    expect(result.current.paths.map((p) => p.id)).toEqual(['bundled-path']);
  });
});
