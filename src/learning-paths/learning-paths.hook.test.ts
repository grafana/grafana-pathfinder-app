import { act, renderHook, waitFor } from '@testing-library/react';

import { useLearningPaths } from './learning-paths.hook';
import {
  interactiveCompletionStorage,
  interactiveStepStorage,
  journeyCompletionStorage,
  learningProgressStorage,
  milestoneCompletionStorage,
} from '../lib/user-storage';

jest.mock('../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: {
    CoursesFallbackUsed: 'courses-fallback-used',
  },
}));

jest.mock('./paths-data', () => ({
  getPathsData: jest.fn(() => ({
    paths: [
      {
        id: 'linux-server-integration',
        title: 'Monitor a Linux server',
        description: 'Set up Linux server observability.',
        guides: ['linux-server-integration-lj', 'https://grafana.com/docs/learning-paths/linux-server-integration/'],
        badgeId: 'penguin-wrangler',
      },
    ],
    guideMetadata: {},
    badges: [],
  })),
  initCoursesData: jest.fn().mockResolvedValue({ source: 'cdn' }),
}));

jest.mock('../lib/user-storage', () => ({
  learningProgressStorage: {
    get: jest.fn(),
    removeCompletedGuides: jest.fn(),
    markGuideCompleted: jest.fn(),
    dismissCelebration: jest.fn(),
  },
  interactiveStepStorage: {
    clearAllForContent: jest.fn(),
  },
  interactiveCompletionStorage: {
    clear: jest.fn(),
  },
  journeyCompletionStorage: {
    clear: jest.fn(),
  },
  milestoneCompletionStorage: {
    getCompleted: jest.fn(),
    clear: jest.fn(),
  },
}));

const JOURNEY_URL = 'https://grafana.com/docs/learning-paths/linux-server-integration/';

describe('useLearningPaths', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (learningProgressStorage.get as jest.Mock).mockResolvedValue({
      completedGuides: [],
      earnedBadges: [],
      streakDays: 0,
      lastActivityDate: '',
      pendingCelebrations: [],
    });
    (learningProgressStorage.removeCompletedGuides as jest.Mock).mockResolvedValue(undefined);
    (interactiveStepStorage.clearAllForContent as jest.Mock).mockResolvedValue(undefined);
    (interactiveCompletionStorage.clear as jest.Mock).mockResolvedValue(undefined);
    (journeyCompletionStorage.clear as jest.Mock).mockResolvedValue(undefined);
    (milestoneCompletionStorage.getCompleted as jest.Mock).mockResolvedValue(
      new Set(['select-platform', 'install-alloy'])
    );
    (milestoneCompletionStorage.clear as jest.Mock).mockResolvedValue(undefined);
  });

  it('clears URL milestone storage and orphaned milestone completions when resetting a path', async () => {
    const { result } = renderHook(() => useLearningPaths());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.resetPath('linux-server-integration');
    });

    expect(milestoneCompletionStorage.getCompleted).toHaveBeenCalledWith(JOURNEY_URL);
    expect(milestoneCompletionStorage.clear).toHaveBeenCalledWith(JOURNEY_URL);
    expect(learningProgressStorage.removeCompletedGuides).toHaveBeenCalledWith([
      'linux-server-integration-lj',
      JOURNEY_URL,
      'select-platform',
      'install-alloy',
    ]);
  });
});
