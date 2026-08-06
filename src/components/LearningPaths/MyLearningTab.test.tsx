/**
 * Tests for MyLearningTab:
 *  - the launch flow: the pending affordance while `prepareGuideLaunch` runs,
 *    and the unmount guard that stops a resolved launch from navigating the
 *    user after they've left the page;
 *  - the My Courses / Completed repartition and Discover More launching;
 *  - guide-open URL resolution — App Platform path members (RFC
 *    CUSTOM-GUIDE-PACKAGES.md §6.11) launch via their `backend-guide:` URL
 *    (resolved through getGuideUrlForPath), falling through to `bundled:<id>`
 *    only when nothing else resolves.
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

// Mutable so individual tests can shape the paths and URL resolution the
// component reads through the learning-paths hook.
let mockPaths: any[] = [];
let mockGuideMetadata: Record<string, any> = {};
let mockCompletedGuides: string[] = [];
const mockGetPathGuides = jest.fn();
const mockGetPathProgress = jest.fn();
const mockIsPathCompleted = jest.fn();
const mockGetGuideUrlForPath = jest.fn();
let mockDiscoverItems: Array<{ id: string; title: string; contentUrl: string; milestoneCount?: number }> = [];
let mockDiscoverExcludeTitles: Set<string> | undefined;

jest.mock('../../learning-paths', () => ({
  BADGES: [],
  getPathsData: () => ({ guideMetadata: mockGuideMetadata }),
  useDiscoverMore: ({ excludeTitles }: { excludeTitles?: Set<string> }) => {
    mockDiscoverExcludeTitles = excludeTitles;
    return { items: mockDiscoverItems, isLoading: false };
  },
  useLearningPaths: () => ({
    paths: mockPaths,
    badgesWithStatus: [],
    progress: { completedGuides: mockCompletedGuides, earnedBadges: [], streakDays: 0 },
    getPathGuides: mockGetPathGuides,
    getPathProgress: mockGetPathProgress,
    isPathCompleted: mockIsPathCompleted,
    getGuideUrlForPath: mockGetGuideUrlForPath,
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

beforeEach(() => {
  jest.clearAllMocks();
  // Default: the repartition fixture — one URL-based path in progress, two at
  // the 1%/99% boundaries, one untouched, one complete.
  mockPaths = [
    {
      id: 'path-1',
      title: 'Started path',
      guides: ['guide-1'],
      url: 'https://grafana.com/docs/learning-paths/path-1/',
    },
    { id: 'path-new', title: 'New path', guides: ['guide-new'] },
    { id: 'edge-low', title: 'Barely started', guides: ['guide-1'] },
    { id: 'edge-high', title: 'Almost done', guides: ['guide-1'] },
    { id: 'path-done', title: 'Done path', guides: ['guide-2'] },
  ];
  mockGuideMetadata = {};
  mockCompletedGuides = ['guide-2'];
  mockDiscoverItems = [];
  mockDiscoverExcludeTitles = undefined;
  mockGetPathGuides.mockImplementation((id: string) =>
    id === 'path-done'
      ? [{ id: 'guide-2', title: 'Guide two', completed: true, isCurrent: false }]
      : id === 'path-new'
        ? [{ id: 'guide-new', title: 'New guide', completed: false, isCurrent: true }]
        : [{ id: 'guide-1', title: 'Guide one', completed: false, isCurrent: true }]
  );
  mockGetPathProgress.mockImplementation((id: string) =>
    id === 'path-done' ? 100 : id === 'path-1' ? 50 : id === 'edge-low' ? 1 : id === 'edge-high' ? 99 : 0
  );
  mockIsPathCompleted.mockImplementation((id: string) => id === 'path-done');
  mockGetGuideUrlForPath.mockReturnValue('https://grafana.com/docs/learning-paths/path-1/guide-1/');
});

describe('MyLearningTab launch flow', () => {
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

describe('MyLearningTab — App Platform guide launch', () => {
  it('launches an App Platform path member via its resolved backend-guide: URL', async () => {
    mockPaths = [{ id: 'ap-path', title: 'Alerting enablement', guides: ['fe-alerting-01'] }];
    mockGetPathGuides.mockReturnValue([
      { id: 'fe-alerting-01', title: 'Alerting module 1', completed: false, isCurrent: true },
    ]);
    mockGetGuideUrlForPath.mockReturnValue('backend-guide:fe-alerting-01');
    prepareMock.mockResolvedValue(okResult);

    render(<MyLearningTab onOpenGuide={jest.fn()} />);
    fireEvent.click(screen.getByTestId(testIds.learningPaths.continueButton('ap-path')));

    await waitFor(() => expect(prepareMock).toHaveBeenCalled());
    expect(prepareMock).toHaveBeenCalledWith(
      'backend-guide:fe-alerting-01',
      expect.objectContaining({ source: 'home_page' })
    );
  });

  it('falls back to bundled:<id> when no App Platform or static URL resolves', async () => {
    mockPaths = [{ id: 'bundled-path', title: 'Bundled path', guides: ['bundled-guide'] }];
    mockGetPathGuides.mockReturnValue([
      { id: 'bundled-guide', title: 'Bundled guide', completed: false, isCurrent: true },
    ]);
    mockGetGuideUrlForPath.mockReturnValue(undefined);
    prepareMock.mockResolvedValue(okResult);

    render(<MyLearningTab onOpenGuide={jest.fn()} />);
    fireEvent.click(screen.getByTestId(testIds.learningPaths.continueButton('bundled-path')));

    await waitFor(() => expect(prepareMock).toHaveBeenCalled());
    expect(prepareMock).toHaveBeenCalledWith('bundled:bundled-guide', expect.objectContaining({ source: 'home_page' }));
  });
});
