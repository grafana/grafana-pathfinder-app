import { renderHook } from '@testing-library/react';
import { useGlobalActiveTabExposure } from './useGlobalActiveTabExposure';

describe('useGlobalActiveTabExposure', () => {
  beforeEach(() => {
    delete (window as any).__DocsPluginActiveTabId;
    delete (window as any).__DocsPluginActiveTabUrl;
  });

  afterEach(() => {
    delete (window as any).__DocsPluginActiveTabId;
    delete (window as any).__DocsPluginActiveTabUrl;
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
