/**
 * Focused test for MyLearningTab's guide-open URL resolution — specifically
 * that App Platform path members (RFC CUSTOM-GUIDE-PACKAGES.md §6.11) open
 * via their `backend-guide:` URL (resolved through getGuideUrlForPath),
 * matching the existing CDN dynamic-path behavior rather than falling
 * through to the `bundled:<id>` default.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MyLearningTab } from './MyLearningTab';

jest.mock('@grafana/i18n', () => ({
  t: (key: string, fallback: string, vars?: Record<string, unknown>) => {
    if (!vars) {
      return fallback;
    }
    return Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{{${k}}}`, String(v)), fallback);
  },
}));

jest.mock('./LearningPathCard', () => ({
  LearningPathCard: ({ path, onContinue }: any) => (
    <button data-testid={`continue-${path.id}`} onClick={() => onContinue(path.guides[0], path.id)}>
      Continue {path.title}
    </button>
  ),
}));

jest.mock('./BadgeIcon', () => ({ BadgeIcon: () => null }));
jest.mock('../SkeletonLoader', () => ({ SkeletonLoader: () => null }));
jest.mock('../FeedbackButton/FeedbackButton', () => ({ FeedbackButton: () => null }));

const mockGetGuideUrlForPath = jest.fn();
const mockGetPathGuides = jest.fn();
let mockPaths: any[] = [];

jest.mock('../../learning-paths', () => ({
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
  BADGES: [],
  getPathsData: () => ({ paths: [], guideMetadata: {} }),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('MyLearningTab — App Platform guide launch', () => {
  it('opens an App Platform path member via its resolved backend-guide: URL', () => {
    mockPaths = [
      {
        id: 'fe-alerting-path',
        title: 'Alerting enablement',
        description: '',
        guides: ['fe-alerting-01'],
        badgeId: '',
      },
    ];
    mockGetGuideUrlForPath.mockReturnValue('backend-guide:fe-alerting-01');
    mockGetPathGuides.mockReturnValue([
      {
        id: 'fe-alerting-01',
        title: 'Alerting module 1',
        completed: false,
        isCurrent: true,
        url: 'backend-guide:fe-alerting-01',
      },
    ]);

    const onOpenGuide = jest.fn();
    render(<MyLearningTab onOpenGuide={onOpenGuide} />);

    fireEvent.click(screen.getByTestId('continue-fe-alerting-path'));

    expect(mockGetGuideUrlForPath).toHaveBeenCalledWith('fe-alerting-01', 'fe-alerting-path');
    expect(onOpenGuide).toHaveBeenCalledWith('backend-guide:fe-alerting-01', 'Alerting module 1');
  });

  it('falls back to bundled:<id> when getGuideUrlForPath resolves nothing (pure bundled guide)', () => {
    mockPaths = [
      { id: 'bundled-path', title: 'Bundled path', description: '', guides: ['bundled-guide'], badgeId: '' },
    ];
    mockGetGuideUrlForPath.mockReturnValue(undefined);
    mockGetPathGuides.mockReturnValue([
      { id: 'bundled-guide', title: 'Bundled guide', completed: false, isCurrent: true, url: undefined },
    ]);

    const onOpenGuide = jest.fn();
    render(<MyLearningTab onOpenGuide={onOpenGuide} />);

    fireEvent.click(screen.getByTestId('continue-bundled-path'));

    expect(onOpenGuide).toHaveBeenCalledWith('bundled:bundled-guide', 'Bundled guide');
  });
});
