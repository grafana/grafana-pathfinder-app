import { renderHook } from '@testing-library/react';
import { useContentReset } from './useContentReset';
import {
  reportAppInteraction,
  UserInteraction,
  getContentTypeForAnalytics,
  enrichWithStepContext,
} from '../../../lib/analytics';
import { interactiveStepStorage, interactiveCompletionStorage } from '../../../lib/user-storage';
import type { LearningJourneyTab } from '../../../types/content-panel.types';

// Mock dependencies
jest.mock('../../../lib/analytics');
jest.mock('../../../lib/user-storage');

const mockReportAppInteraction = reportAppInteraction as jest.MockedFunction<typeof reportAppInteraction>;
const mockEnrichWithStepContext = enrichWithStepContext as jest.MockedFunction<typeof enrichWithStepContext>;
const mockGetContentTypeForAnalytics = getContentTypeForAnalytics as jest.MockedFunction<
  typeof getContentTypeForAnalytics
>;
const mockInteractiveStepStorage = interactiveStepStorage as jest.Mocked<typeof interactiveStepStorage>;
const mockInteractiveCompletionStorage = interactiveCompletionStorage as jest.Mocked<
  typeof interactiveCompletionStorage
>;

describe('useContentReset', () => {
  let mockModel: any;
  let mockSetHasInteractiveProgress: jest.Mock;
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
      loadDocsTabContent: jest.fn().mockResolvedValue(undefined),
      loadTabContent: jest.fn().mockResolvedValue(undefined),
    };
    mockSetHasInteractiveProgress = jest.fn();
    mockDispatchEvent = jest.spyOn(window, 'dispatchEvent');

    // Setup mocks
    mockEnrichWithStepContext.mockReturnValue({ enriched: true } as any);
    mockGetContentTypeForAnalytics.mockReturnValue('interactive');
    mockInteractiveStepStorage.clearAllForContent.mockResolvedValue(undefined);
    mockInteractiveCompletionStorage.clear.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockDispatchEvent.mockRestore();
  });

  it('performs all 5 steps in order for docs-like tab', async () => {
    const { result } = renderHook(() =>
      useContentReset({ model: mockModel, setHasInteractiveProgress: mockSetHasInteractiveProgress })
    );

    const tab = createMockTab({ type: 'interactive' });
    await result.current('progress-key-123', tab);

    // Step 1: Analytics
    expect(mockReportAppInteraction).toHaveBeenCalledWith(UserInteraction.ResetProgressClick, { enriched: true });
    expect(mockEnrichWithStepContext).toHaveBeenCalledWith({
      content_url: 'https://example.com/guide',
      content_type: 'interactive',
      interaction_location: 'docs_content_meta_header',
    });

    // Step 2: Storage clearing
    expect(mockInteractiveStepStorage.clearAllForContent).toHaveBeenCalledWith('progress-key-123');
    expect(mockInteractiveCompletionStorage.clear).toHaveBeenCalledWith('progress-key-123');

    // Step 3: State update
    expect(mockSetHasInteractiveProgress).toHaveBeenCalledWith(false);

    // Step 4: Event dispatch
    expect(mockDispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'interactive-progress-cleared',
        detail: { contentKey: 'progress-key-123' },
      })
    );

    // Step 5: Content reload (docs-like uses loadDocsTabContent)
    expect(mockModel.loadDocsTabContent).toHaveBeenCalledWith('test-tab', 'https://example.com/guide');
    expect(mockModel.loadTabContent).not.toHaveBeenCalled();
  });

  it('uses loadTabContent for learning-journey type', async () => {
    const { result } = renderHook(() =>
      useContentReset({ model: mockModel, setHasInteractiveProgress: mockSetHasInteractiveProgress })
    );

    const tab = createMockTab({ type: 'learning-journey' });
    await result.current('progress-key-123', tab);

    expect(mockModel.loadTabContent).toHaveBeenCalledWith('test-tab', 'https://example.com/guide');
    expect(mockModel.loadDocsTabContent).not.toHaveBeenCalled();
  });

  it('uses baseUrl as fallback for analytics when content.url is missing', async () => {
    const { result } = renderHook(() =>
      useContentReset({ model: mockModel, setHasInteractiveProgress: mockSetHasInteractiveProgress })
    );

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
    const { result } = renderHook(() =>
      useContentReset({ model: mockModel, setHasInteractiveProgress: mockSetHasInteractiveProgress })
    );

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
    const { result } = renderHook(() =>
      useContentReset({ model: mockModel, setHasInteractiveProgress: mockSetHasInteractiveProgress })
    );

    const error = new Error('Storage error');
    mockInteractiveStepStorage.clearAllForContent.mockRejectedValue(error);

    const tab = createMockTab();
    await expect(result.current('progress-key-123', tab)).rejects.toThrow('Storage error');

    // Analytics should have been called before error
    expect(mockReportAppInteraction).toHaveBeenCalled();

    // State update should NOT have been called after error
    expect(mockSetHasInteractiveProgress).not.toHaveBeenCalled();
  });

  it('handles content reload errors', async () => {
    const { result } = renderHook(() =>
      useContentReset({ model: mockModel, setHasInteractiveProgress: mockSetHasInteractiveProgress })
    );

    const error = new Error('Reload error');
    mockModel.loadDocsTabContent.mockRejectedValue(error);

    const tab = createMockTab({ type: 'interactive' });
    await expect(result.current('progress-key-123', tab)).rejects.toThrow('Reload error');

    // All previous steps should have completed
    expect(mockReportAppInteraction).toHaveBeenCalled();
    expect(mockInteractiveStepStorage.clearAllForContent).toHaveBeenCalled();
    expect(mockSetHasInteractiveProgress).toHaveBeenCalled();
    expect(mockDispatchEvent).toHaveBeenCalled();
  });

  it('returns stable function reference', () => {
    const { result, rerender } = renderHook(() =>
      useContentReset({ model: mockModel, setHasInteractiveProgress: mockSetHasInteractiveProgress })
    );

    const firstRef = result.current;
    rerender();
    const secondRef = result.current;

    expect(firstRef).toBe(secondRef);
  });
});
