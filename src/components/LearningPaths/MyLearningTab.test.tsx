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
import { pushFaroLog } from '../../lib/telemetry/bridge';
import { testIds } from '../../constants/testIds';
import { learningProgressStorage, milestoneCompletionStorage } from '../../lib/user-storage';
import { discardQueuedCompletionWrites } from '../../completion-records';

jest.mock('../docs-panel/utils/prepare-guide-launch', () => ({
  prepareGuideLaunch: jest.fn(),
}));

// The discard behaviour itself (queue and storage emptied, nothing left to
// drain) is covered in completion-write-hook.test.ts; here the contract is that
// reset reaches it at all.
jest.mock('../../completion-records', () => ({
  discardQueuedCompletionWrites: jest.fn(),
}));

// Not mocking `lib/logging`: the assertion below is about what the real
// logger-to-Faro bridge emits, so only the bridge sink is replaced.
jest.mock('../../lib/telemetry/bridge', () => ({
  pushFaroError: jest.fn(),
  pushFaroLog: jest.fn(),
  pushFaroUserAction: jest.fn(),
  registerTelemetryBridge: jest.fn(),
}));

const resolvePackageNavLinksMock = jest.fn();
jest.mock('../../docs-retrieval', () => ({
  resolvePackageNavLinks: (...args: unknown[]) => resolvePackageNavLinksMock(...args),
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
  manifest?: Record<string, unknown>;
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
const pushFaroLogMock = pushFaroLog as jest.Mock;

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
  resolvePackageNavLinksMock.mockResolvedValue([]);
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
    prepareMock.mockResolvedValue({ ok: false, error: 'Failed to load content', errorCode: 'fetch-failed' });
    const onOpenGuide = jest.fn();

    render(<MyLearningTab onOpenGuide={onOpenGuide} />);
    const continueButton = screen.getByTestId(testIds.learningPaths.continueButton('path-1'));
    fireEvent.click(continueButton);

    await waitFor(() => expect(publishMock).toHaveBeenCalledTimes(1));
    expect(publishMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'alert-error' }));
    expect(onOpenGuide).not.toHaveBeenCalled();
    // The alert replaces the pending pill: a dead click that only cleared the
    // pending state is the failure this path exists to rule out.
    expect(continueButton).not.toBeDisabled();
    expect(continueButton).not.toHaveTextContent('Opening…');
  });

  it('keeps launch-URL secrets and forwarded error text out of logger and Faro context', async () => {
    // The cover url (path-1's own .url, now what actually gets launched) is
    // where a secret would leak from, not the resolved-milestone url.
    mockPaths = mockPaths.map((path) =>
      path.id === 'path-1'
        ? { ...path, url: 'https://grafana.com/docs/learning-paths/path-1/?token=url-secret#fragment-secret' }
        : path
    );
    // Shaped like the fetch tier's forwarded Zod message (content-fetcher's
    // `Invalid guide: ${message}`), which interpolates the authored token.
    prepareMock.mockResolvedValue({
      ok: false,
      error:
        'Invalid guide: Unknown requirement "authored-token-secret". See https://grafana.com/docs/x?leak=free-text-secret',
      errorCode: 'fetch-failed',
    });
    const consoleError = jest.spyOn(console, 'error').mockImplementation();

    try {
      render(<MyLearningTab onOpenGuide={jest.fn()} />);
      fireEvent.click(screen.getByTestId(testIds.learningPaths.continueButton('path-1')));

      await waitFor(() => expect(publishMock).toHaveBeenCalledTimes(1));
      const expectedContext = {
        content_url: 'grafana.com/docs/learning-paths/path-1/',
        error_code: 'fetch-failed',
      };
      expect(consoleError).toHaveBeenCalledWith('[MyLearning] Guide launch preparation failed', expectedContext);
      expect(pushFaroLogMock).toHaveBeenCalledWith(
        'error',
        '[MyLearning] Guide launch preparation failed',
        expectedContext
      );
      const emittedContext = JSON.stringify({ console: consoleError.mock.calls, faro: pushFaroLogMock.mock.calls });
      expect(emittedContext).not.toContain('url-secret');
      expect(emittedContext).not.toContain('fragment-secret');
      expect(emittedContext).not.toContain('authored-token-secret');
      expect(emittedContext).not.toContain('free-text-secret');
    } finally {
      consoleError.mockRestore();
    }
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
      expect.objectContaining({ title: 'Package one', packageInfo: undefined })
    );
  });

  it('threads the inlined manifest through as packageInfo so the item resolves its milestone context', async () => {
    mockDiscoverItems = [
      {
        id: 'pkg-1',
        title: 'Package one',
        contentUrl: 'https://cdn.example/pkg-1/content.json',
        manifest: { type: 'path', milestones: ['m1', 'm2'] },
      },
    ];
    prepareMock.mockResolvedValue(okResult);

    render(<MyLearningTab onOpenGuide={jest.fn()} />);
    fireEvent.click(screen.getByTestId(testIds.learningPaths.discoverMoreStart('pkg-1')));

    await waitFor(() => expect(prepareMock).toHaveBeenCalledTimes(1));
    expect(prepareMock).toHaveBeenCalledWith(
      'https://cdn.example/pkg-1/content.json',
      expect.objectContaining({
        packageInfo: {
          packageId: 'pkg-1',
          packageManifest: { type: 'path', milestones: ['m1', 'm2'], id: 'pkg-1' },
        },
      })
    );
  });
});

describe('MyLearningTab — private paths split', () => {
  const privatePath = { id: 'ap-path', title: 'Alerting enablement', guides: ['fe-alerting-01'], isPrivate: true };

  it('omits the Private paths section entirely when the namespace has none', () => {
    render(<MyLearningTab onOpenGuide={jest.fn()} />);

    expect(screen.queryByTestId(testIds.learningPaths.privatePathsSection)).not.toBeInTheDocument();
  });

  it('routes an in-progress private path to Private paths and out of My paths', () => {
    mockPaths = [...mockPaths, privatePath];

    render(<MyLearningTab onOpenGuide={jest.fn()} />);

    const privateSection = screen.getByTestId(testIds.learningPaths.privatePathsSection);
    expect(privateSection).toHaveTextContent('Alerting enablement');
    expect(privateSection).toHaveTextContent('Paths published for your organization');

    const myCourses = screen.getByTestId(testIds.learningPaths.myCoursesSection);
    expect(myCourses).not.toHaveTextContent('Alerting enablement');
    expect(myCourses).toHaveTextContent('Started path');

    // Still suppressed from Discover more — the split must not reopen the
    // double-listing the exclude set exists to prevent.
    expect(mockDiscoverExcludeTitles).toContain('Alerting enablement');
  });

  it('moves a completed private path to Completed rather than keeping it in Private paths', () => {
    mockPaths = [...mockPaths, privatePath];
    mockGetPathProgress.mockImplementation((id: string) => (id === 'ap-path' || id === 'path-done' ? 100 : 0));
    mockIsPathCompleted.mockImplementation((id: string) => id === 'ap-path' || id === 'path-done');

    render(<MyLearningTab onOpenGuide={jest.fn()} />);

    expect(screen.queryByTestId(testIds.learningPaths.privatePathsSection)).not.toBeInTheDocument();
    expect(screen.getByTestId(testIds.learningPaths.completedSection)).toHaveTextContent('Alerting enablement');
  });
});

describe('MyLearningTab — online course package cover launch', () => {
  it('resolves and lands a fresh public/CDN package path on its own cover page', async () => {
    mockPaths = [
      {
        id: 'core-grafana-concepts-lj',
        title: 'Core Grafana concepts',
        guides: ['core-grafana-concepts-data-sources'],
        manifest: { type: 'path', milestones: ['core-grafana-concepts-data-sources'] },
      },
    ];
    mockGetPathProgress.mockReturnValue(0);
    resolvePackageNavLinksMock.mockResolvedValue([
      {
        packageId: 'core-grafana-concepts-lj',
        title: 'Core Grafana concepts',
        contentUrl: 'bundled:core-grafana-concepts-lj/content.json',
      },
    ]);
    prepareMock.mockResolvedValue(okResult);

    render(<MyLearningTab onOpenGuide={jest.fn()} />);
    fireEvent.click(screen.getByTestId(testIds.learningPaths.continueButton('core-grafana-concepts-lj')));

    await waitFor(() => expect(prepareMock).toHaveBeenCalled());
    expect(resolvePackageNavLinksMock).toHaveBeenCalledWith(['core-grafana-concepts-lj']);
    expect(prepareMock).toHaveBeenCalledWith('bundled:core-grafana-concepts-lj/content.json', {
      title: 'Core Grafana concepts',
      source: 'home_page',
      packageInfo: {
        packageId: 'core-grafana-concepts-lj',
        packageManifest: {
          type: 'path',
          milestones: ['core-grafana-concepts-data-sources'],
          id: 'core-grafana-concepts-lj',
        },
      },
    });
  });

  it('resuming an in-progress public/CDN package path also lands on its cover page', async () => {
    mockPaths = [
      {
        id: 'core-grafana-concepts-lj',
        title: 'Core Grafana concepts',
        guides: ['core-grafana-concepts-data-sources'],
        manifest: { type: 'path', milestones: ['core-grafana-concepts-data-sources'] },
      },
    ];
    mockGetPathProgress.mockReturnValue(40);
    resolvePackageNavLinksMock.mockResolvedValue([
      {
        packageId: 'core-grafana-concepts-lj',
        title: 'Core Grafana concepts',
        contentUrl: 'bundled:core-grafana-concepts-lj/content.json',
      },
    ]);
    prepareMock.mockResolvedValue(okResult);

    render(<MyLearningTab onOpenGuide={jest.fn()} />);
    fireEvent.click(screen.getByTestId(testIds.learningPaths.continueButton('core-grafana-concepts-lj')));

    await waitFor(() => expect(prepareMock).toHaveBeenCalled());
    expect(resolvePackageNavLinksMock).toHaveBeenCalledWith(['core-grafana-concepts-lj']);
    expect(prepareMock).toHaveBeenCalledWith('bundled:core-grafana-concepts-lj/content.json', {
      title: 'Core Grafana concepts',
      source: 'home_page',
      packageInfo: {
        packageId: 'core-grafana-concepts-lj',
        packageManifest: {
          type: 'path',
          milestones: ['core-grafana-concepts-data-sources'],
          id: 'core-grafana-concepts-lj',
        },
      },
    });
  });

  // Regression test (Cursor Bugbot, "Cover launch lock starts too late"): the
  // in-flight lock used to be acquired inside `launch`, which only runs after
  // resolvePackageNavLinks resolves — leaving the Continue button clickable
  // (launchingId stays null) for that whole window. A second click during
  // the resolve could start a second resolve/launch, potentially opening a
  // different path if the second click hit another path's Continue button.
  it('does not start a second resolve/launch when clicked again while resolvePackageNavLinks is still pending', async () => {
    mockPaths = [
      {
        id: 'core-grafana-concepts-lj',
        title: 'Core Grafana concepts',
        guides: ['core-grafana-concepts-data-sources'],
        manifest: { type: 'path', milestones: ['core-grafana-concepts-data-sources'] },
      },
    ];
    mockGetPathProgress.mockReturnValue(0);
    let resolveNavLinks!: (value: Array<{ packageId: string; title: string; contentUrl: string }>) => void;
    resolvePackageNavLinksMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveNavLinks = resolve;
      })
    );
    prepareMock.mockResolvedValue(okResult);

    render(<MyLearningTab onOpenGuide={jest.fn()} />);
    const continueButton = screen.getByTestId(testIds.learningPaths.continueButton('core-grafana-concepts-lj'));
    fireEvent.click(continueButton);
    await waitFor(() => expect(resolvePackageNavLinksMock).toHaveBeenCalledTimes(1));

    // Second click while the resolve is still pending — the lock must
    // already be held at this point, before resolvePackageNavLinks settles.
    fireEvent.click(continueButton);
    expect(resolvePackageNavLinksMock).toHaveBeenCalledTimes(1);

    resolveNavLinks([
      {
        packageId: 'core-grafana-concepts-lj',
        title: 'Core Grafana concepts',
        contentUrl: 'bundled:core-grafana-concepts-lj/content.json',
      },
    ]);

    await waitFor(() => expect(prepareMock).toHaveBeenCalledTimes(1));
  });

  // Regression test (Cursor Bugbot, "Empty cover URL still launches"):
  // openPathCover used to call launch unconditionally even when
  // resolvePackageNavLinks resolved with no contentUrl, sending an empty URL
  // through prepareGuideLaunch to fail with only a generic error toast.
  it('falls back to the first member guide when resolvePackageNavLinks resolves with no contentUrl', async () => {
    mockPaths = [
      {
        id: 'core-grafana-concepts-lj',
        title: 'Core Grafana concepts',
        guides: ['core-grafana-concepts-data-sources'],
        manifest: { type: 'path', milestones: ['core-grafana-concepts-data-sources'] },
      },
    ];
    mockGetPathProgress.mockReturnValue(0);
    resolvePackageNavLinksMock.mockResolvedValue([]);
    mockGetGuideUrlForPath.mockReturnValue('https://grafana.com/docs/core-grafana-concepts-data-sources/');
    prepareMock.mockResolvedValue(okResult);

    render(<MyLearningTab onOpenGuide={jest.fn()} />);
    fireEvent.click(screen.getByTestId(testIds.learningPaths.continueButton('core-grafana-concepts-lj')));

    await waitFor(() => expect(prepareMock).toHaveBeenCalled());
    expect(mockGetGuideUrlForPath).toHaveBeenCalledWith(
      'core-grafana-concepts-data-sources',
      'core-grafana-concepts-lj'
    );
    expect(prepareMock).toHaveBeenCalledWith(
      'https://grafana.com/docs/core-grafana-concepts-data-sources/',
      expect.objectContaining({ title: 'Core Grafana concepts' })
    );
  });
});

describe('MyLearningTab — App Platform guide launch', () => {
  it('lands a fresh App Platform path on its own cover page, same as any other package path', async () => {
    mockPaths = [
      {
        id: 'ap-path',
        title: 'Alerting enablement',
        guides: ['fe-alerting-01'],
        manifest: { type: 'path', repository: 'app-platform', milestones: ['fe-alerting-01', 'fe-alerting-02'] },
      },
    ];
    mockGetPathProgress.mockReturnValue(0);
    resolvePackageNavLinksMock.mockResolvedValue([
      { packageId: 'ap-path', title: 'Alerting enablement', contentUrl: 'backend-guide:ap-path' },
    ]);
    prepareMock.mockResolvedValue(okResult);

    render(<MyLearningTab onOpenGuide={jest.fn()} />);
    fireEvent.click(screen.getByTestId(testIds.learningPaths.continueButton('ap-path')));

    await waitFor(() => expect(prepareMock).toHaveBeenCalled());
    expect(resolvePackageNavLinksMock).toHaveBeenCalledWith(['ap-path']);
    expect(prepareMock).toHaveBeenCalledWith('backend-guide:ap-path', {
      title: 'Alerting enablement',
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

  it('resuming an in-progress App Platform path still lands on its cover page', async () => {
    mockPaths = [
      {
        id: 'ap-path',
        title: 'Alerting enablement',
        guides: ['fe-alerting-01'],
        manifest: { type: 'path', repository: 'app-platform', milestones: ['fe-alerting-01', 'fe-alerting-02'] },
      },
    ];
    mockGetPathProgress.mockReturnValue(40);
    resolvePackageNavLinksMock.mockResolvedValue([
      { packageId: 'ap-path', title: 'Alerting enablement', contentUrl: 'backend-guide:ap-path' },
    ]);
    prepareMock.mockResolvedValue(okResult);

    render(<MyLearningTab onOpenGuide={jest.fn()} />);
    fireEvent.click(screen.getByTestId(testIds.learningPaths.continueButton('ap-path')));

    await waitFor(() => expect(prepareMock).toHaveBeenCalled());
    // Same cover-launch outcome as the fresh case above — the cover's own CTA
    // (LearningPathTableOfContents) is what resolves the current milestone,
    // not this launch call.
    expect(resolvePackageNavLinksMock).toHaveBeenCalledWith(['ap-path']);
    expect(prepareMock).toHaveBeenCalledWith('backend-guide:ap-path', {
      title: 'Alerting enablement',
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

  it('discards queued completion writes, so the queue cannot mint records for the guides just cleared', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);

    render(<MyLearningTab onOpenGuide={jest.fn()} />);
    fireEvent.click(screen.getByTestId(testIds.learningPaths.resetProgressButton));

    await waitFor(() => expect(discardQueuedCompletionWrites).toHaveBeenCalledTimes(1));
    confirmSpy.mockRestore();
  });

  it('discards before the first awaited clear, so a drain cannot fire mid-reset', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);

    render(<MyLearningTab onOpenGuide={jest.fn()} />);
    fireEvent.click(screen.getByTestId(testIds.learningPaths.resetProgressButton));

    await waitFor(() => expect(learningProgressStorage.clear).toHaveBeenCalledTimes(1));
    const discardOrder = (discardQueuedCompletionWrites as jest.Mock).mock.invocationCallOrder[0]!;
    const firstClearOrder = (learningProgressStorage.clear as jest.Mock).mock.invocationCallOrder[0]!;
    expect(discardOrder).toBeLessThan(firstClearOrder);
    confirmSpy.mockRestore();
  });

  it('keeps queued completion writes when the confirmation is declined', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);

    render(<MyLearningTab onOpenGuide={jest.fn()} />);
    fireEvent.click(screen.getByTestId(testIds.learningPaths.resetProgressButton));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(discardQueuedCompletionWrites).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
