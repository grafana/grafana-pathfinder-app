/**
 * A track-only guide carries no `learningJourney` (COMPLETION-MODEL.md
 * decision 10) — without a trackMemberBaseUrl fallback, milestoneSlug never
 * resolves, and resetGuideProgress falls through to the manifest-preferring
 * identity, which for a track-only guide's retained PARENT-path manifest
 * invalidates the PARENT's completion guard instead of this guide's own.
 * `useContentReset.ts` mirrors `recordGuideCompletionForSurface`'s (the
 * writer's) exact same trackMemberBaseUrl fallback — this file pins the
 * `milestoneSlug` it passes to `resetGuideProgress` in isolation, since the
 * sibling `useContentReset.test.ts` exercises `resetGuideProgress` for real
 * and mocking it there would break those tests' storage-clearing assertions.
 */
import { renderHook } from '@testing-library/react';
import { useContentReset } from './useContentReset';
import type { LearningJourneyTab } from '../../../types/content-panel.types';

jest.mock('../../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: { ResetProgressClick: 'reset_progress_click' },
  getContentTypeForAnalytics: jest.fn(() => 'interactive-guide'),
  tabTypeToContentType: jest.fn(() => 'interactive-guide'),
  enrichWithStepContext: jest.fn((props) => props),
}));

jest.mock('@grafana/runtime', () => ({
  getAppEvents: jest.fn(() => ({ publish: jest.fn() })),
}));

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string) => fallback,
}));

const mockResetGuideProgress = jest.fn().mockResolvedValue(undefined);
jest.mock('./resetGuideProgress', () => ({
  resetGuideProgress: (...args: unknown[]) => mockResetGuideProgress(...args),
}));

describe('useContentReset — track-only guide (trackMemberBaseUrl fallback)', () => {
  const mockModel: any = { loadTab: jest.fn().mockResolvedValue(undefined) };

  const createMockTab = (overrides?: Partial<LearningJourneyTab>): LearningJourneyTab => ({
    id: 'test-tab',
    title: 'Test Guide',
    baseUrl: 'https://example.com/guide',
    currentUrl: 'https://example.com/guide',
    type: 'interactive',
    isLoading: false,
    error: null,
    content: {
      type: 'interactive',
      url: 'https://example.com/guide',
      content: '{"type": "guide"}',
      metadata: { title: 'Test Guide' },
      lastFetched: new Date().toISOString(),
    },
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockResetGuideProgress.mockResolvedValue(undefined);
  });

  it('resolves milestoneSlug via trackMemberBaseUrl when learningJourney is absent', async () => {
    const { result } = renderHook(() => useContentReset({ model: mockModel }));

    const tab = createMockTab({
      currentUrl: 'bundled:t-only/content.json',
      content: {
        type: 'interactive',
        url: 'bundled:t-only/content.json',
        content: '{"type": "guide"}',
        metadata: {
          title: 'Track-only guide',
          packageManifest: { id: 'the-path', type: 'path' },
          trackMemberBaseUrl: 'bundled:the-path/content.json',
        },
        lastFetched: new Date().toISOString(),
      },
    });

    await result.current('progress-key-123', tab);

    expect(mockResetGuideProgress).toHaveBeenCalledWith(
      'progress-key-123',
      expect.objectContaining({ milestoneSlug: 'bundled:t-only' })
    );
  });

  it('never resolves a milestoneSlug for an ordinary standalone guide (no learningJourney, no trackMemberBaseUrl)', async () => {
    const { result } = renderHook(() => useContentReset({ model: mockModel }));

    const tab = createMockTab({ type: 'interactive' });
    await result.current('progress-key-123', tab);

    expect(mockResetGuideProgress).toHaveBeenCalledWith(
      'progress-key-123',
      expect.objectContaining({ milestoneSlug: undefined })
    );
  });

  it('prefers learningJourney.baseUrl over trackMemberBaseUrl when both are somehow present', async () => {
    const { result } = renderHook(() => useContentReset({ model: mockModel }));

    const tab = createMockTab({
      currentUrl: 'bundled:milestone-two/content.json',
      content: {
        type: 'learning-journey',
        url: 'bundled:milestone-two/content.json',
        content: '{"type": "guide"}',
        metadata: {
          title: 'Milestone',
          learningJourney: {
            baseUrl: 'bundled:the-path/content.json',
            currentMilestone: 2,
            totalMilestones: 3,
            milestones: [],
          },
          trackMemberBaseUrl: 'bundled:should-not-be-used/content.json',
        },
        lastFetched: new Date().toISOString(),
      },
    });

    await result.current('progress-key-123', tab);

    expect(mockResetGuideProgress).toHaveBeenCalledWith(
      'progress-key-123',
      expect.objectContaining({ milestoneSlug: 'bundled:milestone-two' })
    );
  });
});
