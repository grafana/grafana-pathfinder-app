/**
 * Tests for MyLearningTab:
 *  - the launch flow: the pending affordance while `prepareGuideLaunch` runs,
 *    and the unmount guard that stops a resolved launch from navigating the
 *    user after they've left the page;
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
  t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    vars ? fallback.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k])) : fallback,
}));

jest.mock('@grafana/ui', () => ({
  useStyles2: () => new Proxy({}, { get: () => 'style' }),
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

// Mutable so individual tests can shape the paths and URL resolution the
// component reads through the learning-paths hook.
let mockPaths: any[] = [];
let mockGuideMetadata: Record<string, any> = {};
const mockGetPathGuides = jest.fn();
const mockGetGuideUrlForPath = jest.fn();

jest.mock('../../learning-paths', () => ({
  BADGES: [],
  getPathsData: () => ({ guideMetadata: mockGuideMetadata }),
  useLearningPaths: () => ({
    paths: mockPaths,
    badgesWithStatus: [],
    progress: { completedGuides: [], earnedBadges: [], streakDays: 0 },
    getPathGuides: mockGetPathGuides,
    getPathProgress: () => 0,
    isPathCompleted: () => false,
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
  // Default: a single URL-based path, matching the launch-flow suite below.
  mockPaths = [
    {
      id: 'path-1',
      title: 'First path',
      guides: ['guide-1'],
      url: 'https://grafana.com/docs/learning-paths/path-1/',
    },
  ];
  mockGuideMetadata = {};
  mockGetPathGuides.mockReturnValue([{ id: 'guide-1', title: 'Guide one', completed: false, isCurrent: true }]);
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
