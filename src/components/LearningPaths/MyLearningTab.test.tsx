/**
 * Tests for the MyLearningTab launch flow: the pending affordance while
 * `prepareGuideLaunch` runs, and the unmount guard that stops a resolved
 * launch from navigating the user after they've left the page. Also covers
 * the My Courses / Completed repartition and Discover More launching.
 * Badge/path presentation is covered by badge-utils tests.
 */

import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MyLearningTab } from './MyLearningTab';
import { prepareGuideLaunch, type PrepareGuideLaunchResult } from '../docs-panel/utils/prepare-guide-launch';
import { testIds } from '../../constants/testIds';

jest.mock('../docs-panel/utils/prepare-guide-launch', () => ({
  prepareGuideLaunch: jest.fn(),
}));

const publishMock = jest.fn();
jest.mock('@grafana/runtime', () => ({
  getAppEvents: () => ({ publish: publishMock }),
}));

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    vars ? fallback.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k])) : fallback,
}));

jest.mock('@grafana/ui', () => ({
  useStyles2: () => new Proxy({}, { get: () => 'style' }),
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

// Mutable so a test can inject Discover More items before rendering.
let mockDiscoverItems: Array<{ id: string; title: string; contentUrl: string; milestoneCount?: number }> = [];

jest.mock('../../learning-paths', () => ({
  BADGES: [],
  getPathsData: () => ({ guideMetadata: {} }),
  useDiscoverMore: () => ({ items: mockDiscoverItems, isLoading: false }),
  useLearningPaths: () => ({
    paths: [
      {
        id: 'path-1',
        title: 'First path',
        guides: ['guide-1'],
        url: 'https://grafana.com/docs/learning-paths/path-1/',
      },
      {
        id: 'path-done',
        title: 'Done path',
        guides: ['guide-2'],
      },
    ],
    badgesWithStatus: [],
    progress: { completedGuides: ['guide-2'], earnedBadges: [], streakDays: 0 },
    getPathGuides: (id: string) =>
      id === 'path-done'
        ? [{ id: 'guide-2', title: 'Guide two', completed: true, isCurrent: false }]
        : [{ id: 'guide-1', title: 'Guide one', completed: false, isCurrent: true }],
    getPathProgress: (id: string) => (id === 'path-done' ? 100 : 0),
    isPathCompleted: (id: string) => id === 'path-done',
    getGuideUrlForPath: () => 'https://grafana.com/docs/learning-paths/path-1/guide-1/',
    resetPath: jest.fn(),
    streakInfo: { days: 0 },
    isLoading: false,
  }),
}));

jest.mock('../SkeletonLoader', () => ({ SkeletonLoader: () => null }));
jest.mock('../FeedbackButton/FeedbackButton', () => ({ FeedbackButton: () => null }));
jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: new Proxy({}, { get: (_t, p) => String(p) }),
  AnalyticsContentType: new Proxy({}, { get: (_t, p) => String(p) }),
}));
jest.mock('../../lib/user-storage', () => ({
  learningProgressStorage: { clear: jest.fn() },
  journeyCompletionStorage: { getAll: jest.fn(async () => ({})), clear: jest.fn() },
  interactiveStepStorage: { clearAll: jest.fn() },
  interactiveCompletionStorage: { clearAll: jest.fn() },
}));
jest.mock('../../global-state/completion-store', () => ({ evictAllContentCaches: jest.fn() }));

const prepareMock = prepareGuideLaunch as jest.MockedFunction<typeof prepareGuideLaunch>;

function deferred() {
  let resolve!: (r: PrepareGuideLaunchResult) => void;
  const promise = new Promise<PrepareGuideLaunchResult>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const okResult: PrepareGuideLaunchResult = {
  ok: true,
  launch: {
    url: 'https://grafana.com/docs/learning-paths/path-1/guide-1/',
    title: 'Guide one',
    type: 'learning-journey',
    source: 'home_page',
    preparedContent: {
      content: '{}',
      metadata: { title: 'Guide one' },
      type: 'learning-journey',
      url: 'https://grafana.com/docs/learning-paths/path-1/guide-1/',
      lastFetched: '2026-07-29T00:00:00.000Z',
    },
    requiresGrafanaUi: false,
  },
} as PrepareGuideLaunchResult;

describe('MyLearningTab launch flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDiscoverItems = [];
  });

  it('shows a pending affordance on the launching card and re-enables after resolve', async () => {
    const { promise, resolve } = deferred();
    prepareMock.mockReturnValue(promise);
    const onOpenGuide = jest.fn();

    render(<MyLearningTab onOpenGuide={onOpenGuide} />);
    const continueButton = screen.getByTestId(testIds.learningPaths.continueButton('path-1'));
    fireEvent.click(continueButton);

    expect(continueButton).toBeDisabled();
    expect(continueButton).toHaveTextContent('Opening…');

    await act(async () => resolve(okResult));

    await waitFor(() => expect(onOpenGuide).toHaveBeenCalledTimes(1));
    expect(continueButton).not.toBeDisabled();
    expect(continueButton).not.toHaveTextContent('Opening…');
  });

  it('drops a launch that resolves after unmount instead of opening the guide', async () => {
    const { promise, resolve } = deferred();
    prepareMock.mockReturnValue(promise);
    const onOpenGuide = jest.fn();

    const { unmount } = render(<MyLearningTab onOpenGuide={onOpenGuide} />);
    fireEvent.click(screen.getByTestId(testIds.learningPaths.continueButton('path-1')));
    unmount();

    await act(async () => resolve(okResult));

    expect(onOpenGuide).not.toHaveBeenCalled();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('surfaces a failed prepare as an error alert without opening a guide', async () => {
    prepareMock.mockResolvedValue({ ok: false, error: 'Failed to load content' });
    const onOpenGuide = jest.fn();

    render(<MyLearningTab onOpenGuide={onOpenGuide} />);
    fireEvent.click(screen.getByTestId(testIds.learningPaths.continueButton('path-1')));

    await waitFor(() => expect(publishMock).toHaveBeenCalledTimes(1));
    expect(publishMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'alert-error' }));
    expect(onOpenGuide).not.toHaveBeenCalled();
  });

  it('shows completed paths in the Completed section, not My Courses', () => {
    render(<MyLearningTab onOpenGuide={jest.fn()} />);

    const myCourses = screen.getByTestId(testIds.learningPaths.myCoursesSection);
    const completed = screen.getByTestId(testIds.learningPaths.completedSection);

    // In-progress/not-started path lives in My Courses…
    expect(myCourses).toHaveTextContent('First path');
    // …while the 100% path lives in Completed with a Done badge.
    expect(completed).toHaveTextContent('Done path');
    expect(completed).toHaveTextContent('Done');
    expect(myCourses).not.toHaveTextContent('Done path');
  });

  it('launches a Discover More item through prepareGuideLaunch', async () => {
    mockDiscoverItems = [{ id: 'pkg-1', title: 'Package one', contentUrl: 'https://cdn.example/pkg-1/content.json' }];
    prepareMock.mockResolvedValue(okResult);
    const onOpenGuide = jest.fn();

    render(<MyLearningTab onOpenGuide={onOpenGuide} />);
    fireEvent.click(screen.getByTestId(testIds.learningPaths.discoverMoreStart('pkg-1')));

    await waitFor(() => expect(prepareMock).toHaveBeenCalledTimes(1));
    expect(prepareMock).toHaveBeenCalledWith(
      'https://cdn.example/pkg-1/content.json',
      expect.objectContaining({ title: 'Package one' })
    );
  });
});
