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

// Style keys come back as their own names so tests can assert on composition.
jest.mock('@grafana/ui', () => ({
  useStyles2: () => new Proxy({}, { get: (_target, prop) => String(prop) }),
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

let mockDiscoverItems: Array<{
  id: string;
  title: string;
  contentUrl: string;
  milestoneCount?: number;
  description?: string;
}> = [];
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

  it('lists every course and badge inline instead of behind a view-all toggle', () => {
    render(<MyLearningTab onOpenGuide={jest.fn()} />);

    // Four in-progress paths, all rendered: the sections scroll rather than
    // truncate, so a fifth path can never hide behind an expand affordance.
    const myCourses = screen.getByTestId(testIds.learningPaths.myCoursesSection);
    expect(myCourses.querySelectorAll('[data-testid^="learning-path-card-"]')).toHaveLength(4);
    expect(screen.queryByText('View all (4)')).not.toBeInTheDocument();
    expect(screen.queryByText('Show less')).not.toBeInTheDocument();
  });

  it('describes what Discover more offers under its title', () => {
    render(<MyLearningTab onOpenGuide={jest.fn()} />);

    expect(screen.getByTestId(testIds.learningPaths.discoverMoreSection)).toHaveTextContent(
      'Structured paths to help you master Grafana step by step'
    );
  });

  it('discloses a Discover more description behind an expand toggle', () => {
    mockDiscoverItems = [
      {
        id: 'pkg-described',
        title: 'Package one',
        contentUrl: 'https://cdn.example/pkg-1/content.json',
        description: 'Ship your first dashboard',
      },
      { id: 'pkg-bare', title: 'Package two', contentUrl: 'https://cdn.example/pkg-2/content.json' },
    ];

    render(<MyLearningTab onOpenGuide={jest.fn()} />);

    const expand = screen.getByTestId(testIds.learningPaths.discoverMoreExpand('pkg-described'));
    expect(expand).toHaveAttribute('aria-label', 'Expand');
    fireEvent.click(expand);
    expect(expand).toHaveAttribute('aria-label', 'Collapse');
    expect(screen.getByTestId(testIds.learningPaths.discoverMoreCard('pkg-described'))).toHaveTextContent(
      'Ship your first dashboard'
    );

    // Nothing to reveal without a description, so no dead disclosure control.
    expect(screen.queryByTestId(testIds.learningPaths.discoverMoreExpand('pkg-bare'))).not.toBeInTheDocument();
  });

  it('keeps the badge overlay outside the container-query context', () => {
    const { container } = render(<MyLearningTab onOpenGuide={jest.fn()} />);

    // `container-type` implies layout containment, which makes the element a
    // containing block for `position: fixed` descendants. The badge detail
    // overlay must not sit inside it, or it is trapped in the panel instead of
    // covering the viewport.
    const queryContext = container.querySelector('.columnsContainer');
    expect(queryContext).not.toBeNull();
    expect(queryContext).toContainElement(screen.getByTestId(testIds.learningPaths.badgesSection));
    expect(queryContext).not.toContainElement(screen.getByTestId(testIds.learningPaths.discoverMoreSection));
  });

  it('toggles a My paths card from the keyboard without firing its actions', () => {
    render(<MyLearningTab onOpenGuide={jest.fn()} />);

    // 'path-new' is collapsed by default (only the first in-progress path auto-expands).
    const header = screen.getByTestId(testIds.learningPaths.card('path-new')).firstElementChild!;
    const chevron = screen.getByTestId(testIds.learningPaths.expandButton('path-new'));
    expect(header).toHaveAttribute('aria-expanded', 'false');

    // Enter on the chevron used to toggle twice — once from the keydown bubbling
    // to the header, once from the button's activation click — cancelling out.
    fireEvent.keyDown(chevron, { key: 'Enter' });
    fireEvent.click(chevron);
    expect(header).toHaveAttribute('aria-expanded', 'true');

    // Enter on Continue must launch only, never also collapse the card.
    fireEvent.keyDown(screen.getByTestId(testIds.learningPaths.continueButton('path-new')), { key: 'Enter' });
    expect(header).toHaveAttribute('aria-expanded', 'true');
  });

  it('expands a My paths card on Enter and Space from the header itself', () => {
    render(<MyLearningTab onOpenGuide={jest.fn()} />);

    const header = screen.getByTestId(testIds.learningPaths.card('path-new')).firstElementChild!;

    fireEvent.keyDown(header, { key: 'Enter' });
    expect(header).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(header, { key: ' ' });
    expect(header).toHaveAttribute('aria-expanded', 'false');
  });

  it('toggles a Discover more card from the keyboard', () => {
    mockDiscoverItems = [
      {
        id: 'pkg-1',
        title: 'Package one',
        contentUrl: 'https://cdn.example/pkg-1/content.json',
        description: 'Ship your first dashboard',
      },
    ];

    render(<MyLearningTab onOpenGuide={jest.fn()} />);
    const expand = screen.getByTestId(testIds.learningPaths.discoverMoreExpand('pkg-1'));

    // Enter on the chevron used to toggle twice — once from the keydown bubbling
    // to the header, once from the button's activation click — cancelling out.
    fireEvent.keyDown(expand, { key: 'Enter' });
    fireEvent.click(expand);

    expect(expand).toHaveAttribute('aria-label', 'Collapse');
  });

  it('expanding a Discover more card does not launch it', () => {
    mockDiscoverItems = [
      {
        id: 'pkg-1',
        title: 'Package one',
        contentUrl: 'https://cdn.example/pkg-1/content.json',
        description: 'Ship your first dashboard',
      },
    ];

    render(<MyLearningTab onOpenGuide={jest.fn()} />);
    fireEvent.click(screen.getByTestId(testIds.learningPaths.discoverMoreExpand('pkg-1')));

    expect(prepareMock).not.toHaveBeenCalled();
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
