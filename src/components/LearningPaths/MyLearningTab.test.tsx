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
  t: (key: string, fallback: string, vars?: Record<string, unknown>) => {
    const template =
      key === 'myLearning.discoverMoreMilestones' && vars?.count === 1 ? '{{count}} milestone' : fallback;
    return vars ? template.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k])) : template;
  },
}));

jest.mock('@grafana/ui', () => ({
  useStyles2: () => new Proxy({}, { get: () => 'style' }),
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

let mockDiscoverItems: Array<{ id: string; title: string; contentUrl: string; milestoneCount?: number }> = [];
let mockDiscoverExcludeTitles: Set<string> | undefined;

jest.mock('../../learning-paths', () => ({
  BADGES: [],
  getPathsData: () => ({ guideMetadata: {} }),
  useDiscoverMore: ({ excludeTitles }: { excludeTitles?: Set<string> }) => {
    mockDiscoverExcludeTitles = excludeTitles;
    return { items: mockDiscoverItems, isLoading: false };
  },
  useLearningPaths: () => ({
    paths: [
      {
        id: 'path-1',
        title: 'Started path',
        guides: ['guide-1'],
        url: 'https://grafana.com/docs/learning-paths/path-1/',
      },
      {
        id: 'path-new',
        title: 'New path',
        guides: ['guide-new'],
      },
      {
        id: 'edge-low',
        title: 'Barely started',
        guides: ['guide-1'],
      },
      {
        id: 'edge-high',
        title: 'Almost done',
        guides: ['guide-1'],
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
        : id === 'path-new'
          ? [{ id: 'guide-new', title: 'New guide', completed: false, isCurrent: true }]
          : [{ id: 'guide-1', title: 'Guide one', completed: false, isCurrent: true }],
    getPathProgress: (id: string) =>
      id === 'path-done' ? 100 : id === 'path-1' ? 50 : id === 'edge-low' ? 1 : id === 'edge-high' ? 99 : 0,
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
    mockDiscoverExcludeTitles = undefined;
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

  it('keeps every not-yet-complete path in My Courses and only 100% in Completed', () => {
    render(<MyLearningTab onOpenGuide={jest.fn()} />);

    const myCourses = screen.getByTestId(testIds.learningPaths.myCoursesSection);
    const completed = screen.getByTestId(testIds.learningPaths.completedSection);

    // Not-started (0%), boundary (1%/99%), and mid-progress (50%) all stay in My
    // Courses so a first-time user's bundled onboarding paths never disappear.
    expect(myCourses).toHaveTextContent('New path');
    expect(myCourses).toHaveTextContent('Barely started');
    expect(myCourses).toHaveTextContent('Started path');
    expect(myCourses).toHaveTextContent('Almost done');
    expect(myCourses).not.toHaveTextContent('Done path');

    expect(completed).toHaveTextContent('Done path');
    expect(completed).toHaveTextContent('Done');
    expect(completed).not.toHaveTextContent('New path');
    expect(completed).not.toHaveTextContent('Almost done');

    // Everything shown in My Courses / Completed is suppressed from Discover
    // More, so a bundled path never double-lists.
    expect(mockDiscoverExcludeTitles).toEqual(
      new Set(['New path', 'Barely started', 'Started path', 'Almost done', 'Done path'])
    );
  });

  it('renders the stable My Learning section landmarks', () => {
    render(<MyLearningTab onOpenGuide={jest.fn()} />);

    expect(screen.getByTestId(testIds.learningPaths.myCoursesSection)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.learningPaths.badgesSection)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.learningPaths.discoverMoreSection)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.learningPaths.completedSection)).toBeInTheDocument();
  });

  it('labels Discover more path metadata as milestones', () => {
    mockDiscoverItems = [
      { id: 'pkg-1', title: 'Package one', contentUrl: 'https://cdn.example/pkg-1/content.json', milestoneCount: 1 },
      { id: 'pkg-2', title: 'Package two', contentUrl: 'https://cdn.example/pkg-2/content.json', milestoneCount: 2 },
    ];

    render(<MyLearningTab onOpenGuide={jest.fn()} />);

    const firstCard = screen.getByTestId(testIds.learningPaths.discoverMoreCard('pkg-1'));
    const secondCard = screen.getByTestId(testIds.learningPaths.discoverMoreCard('pkg-2'));
    expect(firstCard).toHaveTextContent('1 milestone');
    expect(secondCard).toHaveTextContent('2 milestones');
    expect(firstCard).not.toHaveTextContent('guide');
    expect(secondCard).not.toHaveTextContent('guide');
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
