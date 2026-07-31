/**
 * Tests for the cover-page launch routing (issue #1467): a fresh URL-based path
 * lands on the cover page (base URL / milestone 0); an in-progress path resumes
 * the current module's resolved URL.
 */

import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MyLearningTab } from './MyLearningTab';
import { prepareGuideLaunch, type PrepareGuideLaunchResult } from '../docs-panel/utils/prepare-guide-launch';
import { testIds } from '../../constants/testIds';
import { reportAppInteraction } from '../../lib/analytics';

jest.mock('../docs-panel/utils/prepare-guide-launch', () => ({
  prepareGuideLaunch: jest.fn(),
}));

jest.mock('@grafana/runtime', () => ({ getAppEvents: () => ({ publish: jest.fn() }) }));
jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    vars ? fallback.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k])) : fallback,
}));
jest.mock('@grafana/ui', () => ({
  useStyles2: () => new Proxy({}, { get: () => 'style' }),
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

const pathBaseUrl = 'https://grafana.com/docs/learning-paths/path-1/';
const moduleUrl = 'https://grafana.com/docs/learning-paths/path-1/guide-1/';

// Mutable so each test picks the path's progress before rendering.
let pathProgress = 0;

jest.mock('../../learning-paths', () => ({
  BADGES: [],
  getPathsData: () => ({ guideMetadata: {} }),
  useLearningPaths: () => ({
    paths: [{ id: 'path-1', title: 'First path', guides: ['guide-1'], url: pathBaseUrl }],
    badgesWithStatus: [],
    progress: { completedGuides: [], earnedBadges: [], streakDays: 0 },
    getPathGuides: () => [{ id: 'guide-1', title: 'Guide one', completed: false, isCurrent: true }],
    getPathProgress: () => pathProgress,
    isPathCompleted: () => false,
    getGuideUrlForPath: () => moduleUrl,
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
const reportMock = reportAppInteraction as jest.MockedFunction<typeof reportAppInteraction>;

const okResult: PrepareGuideLaunchResult = {
  ok: true,
  launch: {
    url: pathBaseUrl,
    title: 'First path',
    type: 'learning-journey',
    source: 'home_page',
    preparedContent: {
      content: '{}',
      metadata: { title: 'First path' },
      type: 'learning-journey',
      url: pathBaseUrl,
      lastFetched: '2026-07-29T00:00:00.000Z',
    },
    requiresGrafanaUi: false,
  },
} as PrepareGuideLaunchResult;

describe('MyLearningTab cover-page launch routing', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lands a fresh path on the cover page (base URL) with the path title', async () => {
    pathProgress = 0;
    prepareMock.mockResolvedValue(okResult);

    render(<MyLearningTab onOpenGuide={jest.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId(testIds.learningPaths.continueButton('path-1')));
    });

    await waitFor(() => expect(prepareMock).toHaveBeenCalledTimes(1));
    expect(prepareMock).toHaveBeenCalledWith(pathBaseUrl, expect.objectContaining({ title: 'First path' }));
    expect(reportMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ launch_target: 'cover_page' })
    );
  });

  it('resumes an in-progress path on the resolved module URL', async () => {
    pathProgress = 40;
    prepareMock.mockResolvedValue(okResult);

    render(<MyLearningTab onOpenGuide={jest.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId(testIds.learningPaths.continueButton('path-1')));
    });

    await waitFor(() => expect(prepareMock).toHaveBeenCalledTimes(1));
    expect(prepareMock).toHaveBeenCalledWith(moduleUrl, expect.objectContaining({ title: 'Guide one' }));
    expect(reportMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ launch_target: 'milestone' }));
  });
});
