import { renderHook } from '@testing-library/react';
import { useContentReset } from './useContentReset';
import {
  reportAppInteraction,
  UserInteraction,
  getContentTypeForAnalytics,
  enrichWithStepContext,
  AnalyticsContentType,
} from '../../../lib/analytics';
import { interactiveStepStorage, interactiveCompletionStorage } from '../../../lib/user-storage';
import type { LearningJourneyTab } from '../../../types/content-panel.types';

// Mock dependencies
jest.mock('../../../lib/analytics');
jest.mock('../../../lib/user-storage');
jest.mock('@grafana/runtime', () => {
  const mockPublish = jest.fn();
  return {
    getAppEvents: jest.fn(() => ({ publish: mockPublish })),
    __mockPublish: mockPublish,
  };
});

jest.mock('@grafana/i18n', () => ({
  t: jest.fn((_key: string, fallback: string) => fallback),
}));

const mockReportAppInteraction = reportAppInteraction as jest.MockedFunction<typeof reportAppInteraction>;
const mockEnrichWithStepContext = enrichWithStepContext as jest.MockedFunction<typeof enrichWithStepContext>;
const mockGetContentTypeForAnalytics = getContentTypeForAnalytics as jest.MockedFunction<
  typeof getContentTypeForAnalytics
>;
const mockInteractiveStepStorage = interactiveStepStorage as jest.Mocked<typeof interactiveStepStorage>;
const mockInteractiveCompletionStorage = interactiveCompletionStorage as jest.Mocked<
  typeof interactiveCompletionStorage
>;
const { __mockPublish: mockPublish } = jest.requireMock('@grafana/runtime');

describe('useContentReset', () => {
  let mockModel: any;
  let mockDispatchEvent: jest.SpyInstance;

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
    mockModel = {
      loadTab: jest.fn().mockResolvedValue(undefined),
      _recordAutoLaunchSource: jest.fn(),
    };
    mockDispatchEvent = jest.spyOn(window, 'dispatchEvent');

    // Setup mocks
    mockEnrichWithStepContext.mockReturnValue({ enriched: true } as any);
    mockGetContentTypeForAnalytics.mockReturnValue(AnalyticsContentType.InteractiveGuide);
    mockInteractiveStepStorage.clearAllForContent.mockResolvedValue(undefined);
    mockInteractiveCompletionStorage.clear.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockDispatchEvent.mockRestore();
  });

  it('performs all 4 steps in order for docs-like tab', async () => {
    const { result } = renderHook(() => useContentReset({ model: mockModel }));

    const tab = createMockTab({ type: 'interactive' });
    await result.current('progress-key-123', tab);

    // Step 1: Analytics
    expect(mockReportAppInteraction).toHaveBeenCalledWith(UserInteraction.ResetProgressClick, { enriched: true });
    expect(mockEnrichWithStepContext).toHaveBeenCalledWith({
      content_url: 'https://example.com/guide',
      content_type: AnalyticsContentType.InteractiveGuide,
      interaction_location: 'docs_content_meta_header',
    });

    // Step 2: Storage clearing
    expect(mockInteractiveStepStorage.clearAllForContent).toHaveBeenCalledWith('progress-key-123');
    expect(mockInteractiveCompletionStorage.clear).toHaveBeenCalledWith('progress-key-123');

    // Step 3: Event dispatch
    expect(mockDispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'interactive-progress-cleared',
        detail: { contentKey: 'progress-key-123' },
      })
    );

    // Step 4: Content reload via the unified loadTab dispatcher.
    expect(mockModel.loadTab).toHaveBeenCalledWith('test-tab', 'https://example.com/guide');
  });

  // Regression for the "spurious alignment prompt on reset" bug: the reset
  // path must tag the reload as `internal_reload` so the implied-0th-step
  // evaluator treats it as aligned-by-construction. Without this, a reset
  // performed while the user is on a non-matching path would surface an
  // alignment prompt on top of the freshly reloaded guide.
  it('records `internal_reload` before reloading the tab', async () => {
    const { result } = renderHook(() => useContentReset({ model: mockModel }));

    const tab = createMockTab({ type: 'interactive' });
    await result.current('progress-key-123', tab);

    expect(mockModel._recordAutoLaunchSource).toHaveBeenCalledWith('internal_reload');
    const recordCallOrder = mockModel._recordAutoLaunchSource.mock.invocationCallOrder[0];
    const loadCallOrder = mockModel.loadTab.mock.invocationCallOrder[0];
    expect(recordCallOrder).toBeLessThan(loadCallOrder);
  });

  it('reloads learning-journey tabs through the unified loadTab dispatcher', async () => {
    const { result } = renderHook(() => useContentReset({ model: mockModel }));

    const tab = createMockTab({ type: 'learning-journey' });
    await result.current('progress-key-123', tab);

    expect(mockModel.loadTab).toHaveBeenCalledWith('test-tab', 'https://example.com/guide');
    // `_recordAutoLaunchSource` is harmless on the learning-journey branch
    // (the value is never consumed) — but the unified path records it
    // unconditionally so we don't need a docs-vs-plain branch in the hook.
    expect(mockModel._recordAutoLaunchSource).toHaveBeenCalledWith('internal_reload');
  });

  it('uses baseUrl as fallback for analytics when content.url is missing', async () => {
    const { result } = renderHook(() => useContentReset({ model: mockModel }));

    const tab = createMockTab({
      content: undefined,
      baseUrl: 'https://example.com/fallback',
    });

    await result.current('progress-key-123', tab);

    expect(mockEnrichWithStepContext).toHaveBeenCalledWith(
      expect.objectContaining({
        content_url: 'https://example.com/fallback',
      })
    );
  });

  it('uses empty string as fallback when both content.url and baseUrl are missing', async () => {
    const { result } = renderHook(() => useContentReset({ model: mockModel }));

    const tab = createMockTab({
      content: undefined,
      baseUrl: undefined as any,
    });

    await result.current('progress-key-123', tab);

    expect(mockEnrichWithStepContext).toHaveBeenCalledWith(
      expect.objectContaining({
        content_url: '',
      })
    );
  });

  it('handles storage clearing errors', async () => {
    const { result } = renderHook(() => useContentReset({ model: mockModel }));

    const error = new Error('Storage error');
    mockInteractiveStepStorage.clearAllForContent.mockRejectedValue(error);

    const tab = createMockTab();
    await expect(result.current('progress-key-123', tab)).rejects.toThrow('Storage error');

    // Analytics should have been called before error
    expect(mockReportAppInteraction).toHaveBeenCalled();

    // Event should NOT have been dispatched after error
    expect(mockDispatchEvent).not.toHaveBeenCalled();

    // User-facing toast should be surfaced via the app events bus.
    expect(mockPublish).toHaveBeenCalledWith({
      type: 'alert-error',
      payload: ['Reset failed', "Couldn't reset guide progress. Please try again or reload the page."],
    });
  });

  it('handles content reload errors', async () => {
    const { result } = renderHook(() => useContentReset({ model: mockModel }));

    const error = new Error('Reload error');
    mockModel.loadTab.mockRejectedValue(error);

    const tab = createMockTab({ type: 'interactive' });
    await expect(result.current('progress-key-123', tab)).rejects.toThrow('Reload error');

    // All previous steps should have completed
    expect(mockReportAppInteraction).toHaveBeenCalled();
    expect(mockInteractiveStepStorage.clearAllForContent).toHaveBeenCalled();
    expect(mockDispatchEvent).toHaveBeenCalled();

    // User-facing toast should be surfaced via the app events bus.
    expect(mockPublish).toHaveBeenCalledWith({
      type: 'alert-error',
      payload: ['Reset failed', "Couldn't reset guide progress. Please try again or reload the page."],
    });
  });

  it('does not publish a toast on the happy path', async () => {
    const { result } = renderHook(() => useContentReset({ model: mockModel }));

    const tab = createMockTab({ type: 'interactive' });
    await result.current('progress-key-123', tab);

    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('returns stable function reference', () => {
    const { result, rerender } = renderHook(() => useContentReset({ model: mockModel }));

    const firstRef = result.current;
    rerender();
    const secondRef = result.current;

    expect(firstRef).toBe(secondRef);
  });
});
