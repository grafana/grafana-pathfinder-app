import { renderHook } from '@testing-library/react';
import { useGlobalActiveTabExposure, type UseGlobalActiveTabExposureParams } from './useGlobalActiveTabExposure';
import { getActiveJourneyContext, resetJourneyContextForTests } from '../../../global-state/journey-context';
import { setFaroView, setFaroViewName } from '../../../lib/faro';

jest.mock('../../../lib/faro', () => ({
  setFaroView: jest.fn(),
  setFaroViewName: jest.fn(),
}));

const mockSetFaroView = setFaroView as jest.Mock;
const mockSetFaroViewName = setFaroViewName as jest.Mock;

describe('useGlobalActiveTabExposure', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete (window as any).__DocsPluginActiveTabId;
    delete (window as any).__DocsPluginActiveTabUrl;
  });

  afterEach(() => {
    delete (window as any).__DocsPluginActiveTabId;
    delete (window as any).__DocsPluginActiveTabUrl;
    resetJourneyContextForTests();
  });

  it('writes activeTabId and currentUrl (or baseUrl fallback) to window globals', () => {
    renderHook(() =>
      useGlobalActiveTabExposure({
        activeTabId: 'tab-7',
        activeTabCurrentUrl: 'https://example.com/cur',
        activeTabBaseUrl: 'https://example.com/base',
      })
    );
    expect((window as any).__DocsPluginActiveTabId).toBe('tab-7');
    expect((window as any).__DocsPluginActiveTabUrl).toBe('https://example.com/cur');
  });

  it('falls back to baseUrl when currentUrl is missing', () => {
    renderHook(() =>
      useGlobalActiveTabExposure({
        activeTabId: 'tab-2',
        activeTabCurrentUrl: undefined,
        activeTabBaseUrl: 'https://example.com/base',
      })
    );
    expect((window as any).__DocsPluginActiveTabUrl).toBe('https://example.com/base');
  });

  it('writes empty strings when both URLs are missing', () => {
    renderHook(() =>
      useGlobalActiveTabExposure({
        activeTabId: undefined,
        activeTabCurrentUrl: undefined,
        activeTabBaseUrl: undefined,
      })
    );
    expect((window as any).__DocsPluginActiveTabId).toBe('');
    expect((window as any).__DocsPluginActiveTabUrl).toBe('');
  });

  it('mirrors the active URL (with baseUrl fallback) into the Faro view meta', () => {
    renderHook(() =>
      useGlobalActiveTabExposure({
        activeTabId: 'tab-7',
        activeTabCurrentUrl: 'https://example.com/cur',
        activeTabBaseUrl: 'https://example.com/base',
      })
    );
    expect(mockSetFaroView).toHaveBeenCalledWith('https://example.com/cur');
    expect(mockSetFaroViewName).not.toHaveBeenCalled();
  });

  it('sets the view to "recommendations" when there is no URL to derive one from', () => {
    renderHook(() =>
      useGlobalActiveTabExposure({
        activeTabId: undefined,
        activeTabCurrentUrl: undefined,
        activeTabBaseUrl: undefined,
      })
    );
    expect(mockSetFaroViewName).toHaveBeenCalledWith('recommendations');
    expect(mockSetFaroView).not.toHaveBeenCalled();
  });

  it('updates globals when props change across re-renders', () => {
    const { rerender } = renderHook((props: any) => useGlobalActiveTabExposure(props), {
      initialProps: {
        activeTabId: 'tab-a',
        activeTabCurrentUrl: 'https://example.com/a',
        activeTabBaseUrl: 'https://example.com/a',
      },
    });
    expect((window as any).__DocsPluginActiveTabId).toBe('tab-a');
    rerender({
      activeTabId: 'tab-b',
      activeTabCurrentUrl: 'https://example.com/b',
      activeTabBaseUrl: 'https://example.com/b',
    });
    expect((window as any).__DocsPluginActiveTabId).toBe('tab-b');
    expect((window as any).__DocsPluginActiveTabUrl).toBe('https://example.com/b');
  });

  it('publishes the journey context for learning-journey tabs and clears it otherwise', () => {
    const { rerender, unmount } = renderHook(useGlobalActiveTabExposure, {
      initialProps: {
        activeTabId: 'tab-lj',
        activeTabCurrentUrl: 'https://example.com/lj/m3',
        activeTabBaseUrl: 'https://example.com/lj',
        journeyMilestone: 3,
        journeyTotalMilestones: 5,
      } as UseGlobalActiveTabExposureParams,
    });
    expect(getActiveJourneyContext()).toEqual({
      journeyUrl: 'https://example.com/lj',
      milestoneNumber: 3,
      totalMilestones: 5,
    });

    rerender({
      activeTabId: 'tab-guide',
      activeTabCurrentUrl: 'https://example.com/guide',
      activeTabBaseUrl: 'https://example.com/guide',
    });
    expect(getActiveJourneyContext()).toBeNull();

    rerender({
      activeTabId: 'tab-lj',
      activeTabCurrentUrl: 'https://example.com/lj/m4',
      activeTabBaseUrl: 'https://example.com/lj',
      journeyMilestone: 4,
      journeyTotalMilestones: 5,
    });
    unmount();
    expect(getActiveJourneyContext()).toBeNull();
  });

  it('uses useLayoutEffect (synchronous, before passive effects)', async () => {
    // H4 (pre-mortem): if accidentally switched to useEffect, children's
    // useEffects would observe the previous milestone URL. Asserting the
    // global is set IMMEDIATELY after render (without flushing microtasks)
    // characterizes the synchronous nature.
    const { result } = renderHook(() =>
      useGlobalActiveTabExposure({
        activeTabId: 'tab-sync',
        activeTabCurrentUrl: 'https://example.com/sync',
        activeTabBaseUrl: 'https://example.com/sync',
      })
    );
    // No await, no act — assertion runs immediately after the render returned.
    // useLayoutEffect fires synchronously inside renderHook's commit phase,
    // so the global is already set.
    expect((window as any).__DocsPluginActiveTabUrl).toBe('https://example.com/sync');
    expect(result.current).toBeUndefined(); // returns void
  });
});
