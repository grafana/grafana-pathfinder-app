import React from 'react';
import { render, renderHook, screen, fireEvent, act } from '@testing-library/react';
import { GuideReaderOverlay } from './GuideReaderOverlay';
import { testIds } from '../../constants/testIds';
import { fetchUnifiedContent } from '../../docs-retrieval';
import { recordGuideRender } from '../../lib/telemetry/facade';
import { getActiveTabUrl } from '../../global-state/content-key';
import { findDocPage } from '../../utils/find-doc-page';
import { useGlobalActiveTabExposure } from '../docs-panel/hooks/useGlobalActiveTabExposure';
import type { ContentFetchResult, RawContent } from '../../types/content.types';

jest.mock('../../lib/telemetry/facade', () => ({
  ...jest.requireActual('../../lib/telemetry/facade'),
  recordGuideRender: jest.fn(),
}));

jest.mock('../../lib/faro', () => ({
  setFaroView: jest.fn(),
  setFaroViewName: jest.fn(),
}));

jest.mock('../../docs-retrieval', () => ({
  fetchUnifiedContent: jest.fn(),
}));

// Feature provider needs no real OpenFeature client for this test.
jest.mock('../OpenFeatureProvider', () => ({
  PathfinderFeatureProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Stand in for the real renderer so the test asserts the overlay's own
// responsibilities (fetch → render, close, error) rather than ContentRenderer
// internals (covered by its own suite).
const mockRenderedCompletions: unknown[] = [];
jest.mock('../content-renderer/content-renderer', () => ({
  ContentRenderer: ({ content, completion }: { content: RawContent; completion: unknown }) => {
    const { useInteractiveMode } = require('../../global-state/interactive-mode-context');
    mockRenderedCompletions.push(completion);
    return (
      <div data-testid="mock-content" data-load-id={content.loadContext?.loadId}>
        mode:{useInteractiveMode()}
      </div>
    );
  },
}));

const mockFetchContent = fetchUnifiedContent as jest.MockedFunction<typeof fetchUnifiedContent>;

describe('GuideReaderOverlay', () => {
  let closeSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRenderedCompletions.length = 0;
    closeSpy = jest.spyOn(window, 'close').mockImplementation(() => {});
  });

  afterEach(() => {
    closeSpy.mockRestore();
  });

  it('fetches the guide and renders it inside the overlay portal', async () => {
    mockFetchContent.mockResolvedValue({ content: { url: 'backend-guide:x', type: 'interactive' } } as any);

    render(<GuideReaderOverlay doc="backend-guide:x" />);

    expect(mockFetchContent).toHaveBeenCalledWith('backend-guide:x', { loadContext: expect.any(Object) });
    expect(screen.getByTestId(testIds.guideReader.overlay)).toBeInTheDocument();
    expect(await screen.findByTestId('mock-content')).toHaveAttribute(
      'data-load-id',
      mockFetchContent.mock.calls[0]?.[1]?.loadContext?.loadId
    );
    expect(recordGuideRender).not.toHaveBeenCalled();
  });

  it('publishes the rendered guide key (the sidebar tab spelling) and releases it on unmount', async () => {
    window.__DocsPluginActiveTabUrl = 'https://grafana.com/docs/stale/';
    mockFetchContent.mockResolvedValue({ content: { url: 'bundled:intro', type: 'interactive' } } as any);

    const { unmount } = render(<GuideReaderOverlay doc="bundled:intro" />);
    await screen.findByTestId('mock-content');

    expect(window.__DocsPluginActiveTabUrl).toBe('bundled:intro');
    unmount();
    window.__DocsPluginActiveTabUrl = 'https://grafana.com/docs/sidebar/';
    expect(getActiveTabUrl()).toBe('https://grafana.com/docs/sidebar/');
  });

  describe('content key parity with the sidebar tab for the same launch', () => {
    const sidebarKey = (doc: string, fetchedUrl: string | undefined) => {
      window.__DocsPluginActiveTabUrl = '';
      const { unmount } = renderHook(() =>
        useGlobalActiveTabExposure({
          activeTabId: 'tab-1',
          activeTabBaseUrl: findDocPage(doc)?.url ?? doc,
          activeTabCurrentUrl: fetchedUrl || doc,
        })
      );
      const key = window.__DocsPluginActiveTabUrl;
      unmount();
      return key;
    };

    const readerKey = async (doc: string, fetchedUrl: string | undefined) => {
      window.__DocsPluginActiveTabUrl = '';
      mockFetchContent.mockResolvedValue({ content: { url: fetchedUrl, type: 'interactive' } } as any);
      const { unmount } = render(<GuideReaderOverlay doc={doc} />);
      await screen.findByTestId('mock-content');
      const key = window.__DocsPluginActiveTabUrl;
      unmount();
      return key;
    };

    it.each([
      ['a bundled launch', 'bundled:welcome-to-grafana', 'bundled:welcome-to-grafana'],
      ['a bundled launch whose content has no url', 'bundled:welcome-to-grafana', undefined],
      ['an https launch', 'https://grafana.com/docs/grafana/latest/', 'https://grafana.com/docs/grafana/latest/'],
    ])('publishes the sidebar key for %s', async (_name, doc, fetchedUrl) => {
      const fromSidebar = await sidebarKey(doc, fetchedUrl);
      expect(fromSidebar).toBeTruthy();
      expect(await readerKey(doc, fetchedUrl)).toBe(fromSidebar);
    });

    it('keeps bundled:<id> and bundled:<id>/content.json distinct', async () => {
      const bare = 'bundled:welcome-to-grafana';
      const withFile = `${bare}/content.json`;
      expect(await readerKey(bare, bare)).toBe(await sidebarKey(bare, bare));
      expect(await readerKey(withFile, withFile)).toBe(await sidebarKey(withFile, withFile));
      expect(await readerKey(bare, bare)).not.toBe(await readerKey(withFile, withFile));
    });
  });

  it('provides controller mode to the rendered content', async () => {
    mockFetchContent.mockResolvedValue({ content: { url: 'backend-guide:x', type: 'interactive' } } as any);

    render(<GuideReaderOverlay doc="backend-guide:x" mode="controller" />);

    const content = await screen.findByTestId('mock-content');
    expect(content).toHaveTextContent('mode:controller');
  });

  it('shows the pairing code in controller mode', async () => {
    mockFetchContent.mockResolvedValue({ content: { url: 'backend-guide:x', type: 'interactive' } } as any);

    render(
      <GuideReaderOverlay
        doc="backend-guide:x"
        mode="controller"
        controllerPairing={{ pairingId: 'pairing-1', pairingSecret: 'secret-1', pairingCode: '123456' }}
      />
    );

    expect(await screen.findByTestId(testIds.guideReader.controllerStatus)).toHaveTextContent('Code: 123456');
  });

  it('defaults to interactive mode (not the privileged controller) when none is passed', async () => {
    mockFetchContent.mockResolvedValue({ content: { url: 'backend-guide:x', type: 'interactive' } } as any);

    render(<GuideReaderOverlay doc="backend-guide:x" />);

    const content = await screen.findByTestId('mock-content');
    expect(content).toHaveTextContent('mode:interactive');
  });

  it('closes the tab when the close button is clicked', async () => {
    mockFetchContent.mockResolvedValue({ content: { url: 'backend-guide:x', type: 'interactive' } } as any);

    render(<GuideReaderOverlay doc="backend-guide:x" />);

    fireEvent.click(screen.getByTestId(testIds.guideReader.closeButton));
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('closes the tab when Escape is pressed', async () => {
    mockFetchContent.mockResolvedValue({ content: { url: 'backend-guide:x', type: 'interactive' } } as any);

    render(<GuideReaderOverlay doc="backend-guide:x" />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('shows a close hint when window.close() is a no-op (bookmarked tab)', async () => {
    jest.useFakeTimers();
    try {
      mockFetchContent.mockResolvedValue({ content: { url: 'backend-guide:x', type: 'interactive' } } as any);

      render(<GuideReaderOverlay doc="backend-guide:x" />);

      fireEvent.click(screen.getByTestId(testIds.guideReader.closeButton));
      expect(screen.queryByTestId(testIds.guideReader.closeHint)).not.toBeInTheDocument();

      act(() => {
        jest.advanceTimersByTime(100);
      });
      expect(screen.getByTestId(testIds.guideReader.closeHint)).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it('hands the renderer its view-level identity for the shared surface-neutral emitter', async () => {
    mockFetchContent.mockResolvedValue({
      content: {
        url: 'https://example.com/remote-guide/content.json',
        type: 'interactive',
        metadata: { title: 'Remote guide', packageManifest: { id: 'remote-guide', repository: 'app-platform' } },
      },
    } as any);

    render(<GuideReaderOverlay doc="https://example.com/remote-guide/content.json" />);

    await screen.findByTestId('mock-content');

    expect(mockRenderedCompletions.at(-1)).toEqual({
      kind: 'tracked',
      input: expect.objectContaining({
        contentUrl: 'https://example.com/remote-guide/content.json',
        contentType: 'interactive',
        metadata: { title: 'Remote guide', packageManifest: { id: 'remote-guide', repository: 'app-platform' } },
        guideTitle: 'Remote guide',
      }),
    });
  });

  it('surfaces an error when the guide cannot be loaded', async () => {
    mockFetchContent.mockResolvedValue({ content: null, error: 'boom', errorType: 'other' } as any);

    render(<GuideReaderOverlay doc="backend-guide:x" />);

    expect(await screen.findByTestId(testIds.guideReader.error)).toHaveTextContent('boom');
  });

  it('reports the typed private-guide failure without its response message', async () => {
    mockFetchContent.mockResolvedValue({
      content: null,
      error: 'Private response body',
      diagnostic: { source: 'app-platform', stage: 'fetch', reason: 'http-error', statusCode: 404 },
    });
    render(<GuideReaderOverlay doc="backend-guide:private-name" />);
    await screen.findByTestId(testIds.guideReader.error);
    expect(recordGuideRender).toHaveBeenCalledWith(
      mockFetchContent.mock.calls[0]?.[1]?.loadContext,
      'error',
      expect.any(Number),
      { source: 'app-platform', stage: 'fetch', reason: 'http-error', statusCode: 404 }
    );
    const payload = JSON.stringify((recordGuideRender as jest.Mock).mock.calls);
    expect(payload).not.toContain('private-name');
    expect(payload).not.toContain('Private response body');
  });

  it('classifies a rejected request without forwarding exception text', async () => {
    mockFetchContent.mockRejectedValue(new TypeError('Private failure details'));
    render(<GuideReaderOverlay doc="backend-guide:x" />);
    await screen.findByTestId(testIds.guideReader.error);
    expect(recordGuideRender).toHaveBeenCalledWith(
      mockFetchContent.mock.calls[0]?.[1]?.loadContext,
      'error',
      expect.any(Number),
      { source: 'app-platform', stage: 'fetch', reason: 'network-error' }
    );
  });

  it('cancels an unmounted load and ignores its late result without timing out', async () => {
    jest.useFakeTimers();
    try {
      let resolve!: (result: ContentFetchResult) => void;
      mockFetchContent.mockReturnValue(
        new Promise((done) => {
          resolve = done;
        })
      );
      const view = render(<GuideReaderOverlay doc="backend-guide:x" />);
      const loadContext = mockFetchContent.mock.calls[0]?.[1]?.loadContext;
      view.unmount();
      await act(async () => {
        resolve({ content: null, error: 'Late error' });
      });
      act(() => jest.advanceTimersByTime(60_001));
      expect(recordGuideRender).toHaveBeenCalledTimes(1);
      expect(recordGuideRender).toHaveBeenCalledWith(loadContext, 'cancelled', expect.any(Number), undefined);
    } finally {
      jest.useRealTimers();
    }
  });
});
