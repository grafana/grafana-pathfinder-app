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
import { milestoneCompletionStorage } from '../../lib/user-storage';

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

// Mutable so individual tests can shape the paths and URL resolution the
// component reads through the learning-paths hook.
let mockPaths: any[] = [];
let mockGuideMetadata: Record<string, any> = {};
let mockCompletedGuides: string[] = [];
let mockBadges: any[] = [];
const mockGetPathGuides = jest.fn();
const mockGetPathProgress = jest.fn();
const mockIsPathCompleted = jest.fn();
const mockGetGuideUrlForPath = jest.fn();
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
  getPathsData: () => ({ guideMetadata: mockGuideMetadata }),
  useDiscoverMore: ({ excludeTitles }: { excludeTitles?: Set<string> }) => {
    mockDiscoverExcludeTitles = excludeTitles;
    return { items: mockDiscoverItems, isLoading: false };
  },
  useLearningPaths: () => ({
    paths: mockPaths,
    badgesWithStatus: mockBadges,
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
  milestoneCompletionStorage: { clearAll: jest.fn() },
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
  mockBadges = [];
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
    mockBadges = [
      {
        id: 'first-steps',
        title: 'First steps',
        description: 'Complete a guide',
        earnedAt: 1,
        trigger: { type: 'guide-completed' },
      },
    ];

    const { container } = render(<MyLearningTab onOpenGuide={jest.fn()} />);
    const queryContext = container.querySelector('.columnsContainer');
    expect(queryContext).not.toBeNull();
    expect(queryContext).toContainElement(screen.getByTestId(testIds.learningPaths.badgesSection));

    // Open the real overlay rather than asserting on layout alone: `container-type`
    // implies layout containment, which makes the element a containing block for
    // `position: fixed` descendants, so an overlay nested inside would be trapped
    // in the panel instead of covering the viewport.
    fireEvent.click(screen.getByTestId(testIds.learningPaths.badgeItem('first-steps')));

    const overlay = container.querySelector('.overlay');
    expect(overlay).not.toBeNull();
    expect(overlay).toHaveTextContent('First steps');
    expect(queryContext).not.toContainElement(overlay as HTMLElement);
  });

  it('toggles a My paths card from the keyboard without firing its actions', () => {
    render(<MyLearningTab onOpenGuide={jest.fn()} />);

    // 'path-new' is collapsed by default (only the first in-progress path auto-expands).
    const chevron = screen.getByTestId(testIds.learningPaths.expandButton('path-new'));
    expect(chevron).toHaveAttribute('aria-expanded', 'false');

    // Enter on the chevron used to toggle twice — once from the keydown bubbling
    // to the header, once from the button's activation click — cancelling out.
    fireEvent.keyDown(chevron, { key: 'Enter' });
    fireEvent.click(chevron);
    expect(chevron).toHaveAttribute('aria-expanded', 'true');

    // Enter on Continue must launch only, never also collapse the card.
    fireEvent.keyDown(screen.getByTestId(testIds.learningPaths.continueButton('path-new')), { key: 'Enter' });
    expect(chevron).toHaveAttribute('aria-expanded', 'true');
  });

  it('exposes the My paths card actions to assistive tech', () => {
    render(<MyLearningTab onOpenGuide={jest.fn()} />);
    const card = screen.getByTestId(testIds.learningPaths.card('path-new'));

    // `role="button"` on the header would be Children Presentational, hiding the
    // nested Continue and chevron controls.
    expect(card.querySelector('[role="button"]')).toBeNull();

    const chevron = screen.getByTestId(testIds.learningPaths.expandButton('path-new'));
    const region = card.querySelector(`#${CSS.escape(chevron.getAttribute('aria-controls')!)}`);
    expect(region).toHaveAttribute('aria-hidden', 'true');

    fireEvent.click(chevron);
    expect(region).toHaveAttribute('aria-hidden', 'false');
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

    // The chevron is a real button, so Enter reaches it as an activation click.
    fireEvent.keyDown(expand, { key: 'Enter' });
    fireEvent.click(expand);

    expect(expand).toHaveAttribute('aria-label', 'Collapse');
    expect(expand).toHaveAttribute('aria-expanded', 'true');
  });

  it('exposes the Discover more Start button to assistive tech', () => {
    mockDiscoverItems = [
      {
        id: 'pkg-1',
        title: 'Package one',
        contentUrl: 'https://cdn.example/pkg-1/content.json',
        description: 'Ship your first dashboard',
      },
    ];

    render(<MyLearningTab onOpenGuide={jest.fn()} />);
    const card = screen.getByTestId(testIds.learningPaths.discoverMoreCard('pkg-1'));

    // `role="button"` on the header would be Children Presentational, hiding the
    // nested Start and chevron and leaving the card expandable but unlaunchable.
    expect(card.querySelector('[role="button"]')).toBeNull();

    // The disclosure state belongs to the chevron, and the collapsed region is
    // hidden from the accessibility tree to match it.
    const expand = screen.getByTestId(testIds.learningPaths.discoverMoreExpand('pkg-1'));
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    const region = card.querySelector(`#${CSS.escape(expand.getAttribute('aria-controls')!)}`);
    expect(region).toHaveAttribute('aria-hidden', 'true');
    expect(region).toHaveTextContent('Ship your first dashboard');
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

describe('MyLearningTab — App Platform guide launch', () => {
  it('launches an App Platform path member with the path manifest as packageInfo (milestone chrome)', async () => {
    mockPaths = [
      {
        id: 'ap-path',
        title: 'Alerting enablement',
        guides: ['fe-alerting-01'],
        manifest: { type: 'path', repository: 'app-platform', milestones: ['fe-alerting-01', 'fe-alerting-02'] },
      },
    ];
    mockGetPathGuides.mockReturnValue([
      { id: 'fe-alerting-01', title: 'Alerting module 1', completed: false, isCurrent: true },
    ]);
    mockGetGuideUrlForPath.mockReturnValue('backend-guide:fe-alerting-01');
    prepareMock.mockResolvedValue(okResult);

    render(<MyLearningTab onOpenGuide={jest.fn()} />);
    fireEvent.click(screen.getByTestId(testIds.learningPaths.continueButton('ap-path')));

    await waitFor(() => expect(prepareMock).toHaveBeenCalled());
    // Without packageInfo the loader falls through to a standalone guide with no
    // milestone toolbar; the PATH manifest (with id merged) is what renders chrome.
    expect(prepareMock).toHaveBeenCalledWith('backend-guide:fe-alerting-01', {
      title: expect.any(String),
      source: 'home_page',
      packageInfo: {
        packageId: 'ap-path',
        packageManifest: {
          type: 'path',
          repository: 'app-platform',
          milestones: ['fe-alerting-01', 'fe-alerting-02'],
          id: 'ap-path',
        },
      },
    });
  });

  it('falls back to bundled:<id> with no packageInfo when no manifest/URL resolves', async () => {
    mockPaths = [{ id: 'bundled-path', title: 'Bundled path', guides: ['bundled-guide'] }];
    mockGetPathGuides.mockReturnValue([
      { id: 'bundled-guide', title: 'Bundled guide', completed: false, isCurrent: true },
    ]);
    mockGetGuideUrlForPath.mockReturnValue(undefined);
    prepareMock.mockResolvedValue(okResult);

    render(<MyLearningTab onOpenGuide={jest.fn()} />);
    fireEvent.click(screen.getByTestId(testIds.learningPaths.continueButton('bundled-path')));

    await waitFor(() => expect(prepareMock).toHaveBeenCalled());
    expect(prepareMock).toHaveBeenCalledWith('bundled:bundled-guide', {
      title: expect.any(String),
      source: 'home_page',
      packageInfo: undefined,
    });
  });
});

describe('MyLearningTab — reset all learning progress', () => {
  it('drops milestone checklists so a single later completion cannot re-complete a course', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);

    render(<MyLearningTab onOpenGuide={jest.fn()} />);
    fireEvent.click(screen.getByTestId(testIds.learningPaths.resetProgressButton));

    await waitFor(() => expect(milestoneCompletionStorage.clearAll).toHaveBeenCalledTimes(1));
    confirmSpy.mockRestore();
  });

  it('leaves milestone checklists alone when the confirmation is declined', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);

    render(<MyLearningTab onOpenGuide={jest.fn()} />);
    fireEvent.click(screen.getByTestId(testIds.learningPaths.resetProgressButton));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(milestoneCompletionStorage.clearAll).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
