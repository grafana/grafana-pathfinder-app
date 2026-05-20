import { renderHook } from '@testing-library/react';
import { useScrollTracking } from './useScrollTracking';

jest.mock('../../../lib/analytics', () => ({
  setupScrollTracking: jest.fn(),
}));

import { setupScrollTracking } from '../../../lib/analytics';

const setupScrollTrackingMock = setupScrollTracking as jest.Mock;

function makeTab(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'tab-1',
    title: 'Tab',
    baseUrl: 'https://example.com/',
    currentUrl: 'https://example.com/',
    content: { type: 'docs', url: 'https://example.com/', metadata: {}, content: '' },
    isLoading: false,
    error: null,
    ...overrides,
  };
}

describe('useScrollTracking', () => {
  beforeEach(() => {
    setupScrollTrackingMock.mockReset();
    setupScrollTrackingMock.mockReturnValue(() => {});
    document.body.innerHTML = '<div id="inner-docs-content"></div>';
  });

  it('does nothing on the recommendations tab', () => {
    renderHook(() => useScrollTracking({ activeTab: makeTab(), isRecommendationsTab: true }));
    expect(setupScrollTrackingMock).not.toHaveBeenCalled();
  });

  it('does nothing when activeTab is null', () => {
    renderHook(() => useScrollTracking({ activeTab: null, isRecommendationsTab: false }));
    expect(setupScrollTrackingMock).not.toHaveBeenCalled();
  });

  it('does nothing when activeTab has no loaded content', () => {
    renderHook(() => useScrollTracking({ activeTab: makeTab({ content: null }), isRecommendationsTab: false }));
    expect(setupScrollTrackingMock).not.toHaveBeenCalled();
  });

  it('does nothing when the inner-docs-content element is absent', () => {
    document.body.innerHTML = '';
    renderHook(() => useScrollTracking({ activeTab: makeTab(), isRecommendationsTab: false }));
    expect(setupScrollTrackingMock).not.toHaveBeenCalled();
  });

  it('wires setupScrollTracking when content is loaded and the target element exists', () => {
    const tab = makeTab();
    renderHook(() => useScrollTracking({ activeTab: tab, isRecommendationsTab: false }));
    expect(setupScrollTrackingMock).toHaveBeenCalledTimes(1);
    expect(setupScrollTrackingMock).toHaveBeenCalledWith(expect.any(HTMLElement), tab, false);
  });

  it('invokes the cleanup function returned by setupScrollTracking on unmount', () => {
    const cleanup = jest.fn();
    setupScrollTrackingMock.mockReturnValue(cleanup);
    const { unmount } = renderHook(() => useScrollTracking({ activeTab: makeTab(), isRecommendationsTab: false }));
    unmount();
    expect(cleanup).toHaveBeenCalled();
  });
});
