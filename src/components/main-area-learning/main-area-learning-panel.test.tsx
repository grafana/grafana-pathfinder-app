/**
 * Tests for MainAreaLearningPanelRenderer.
 *
 * Validates content loading, format restriction, error states, landing page
 * fallback, URL cleanup, and analytics instrumentation.
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MainAreaLearningPanelRenderer } from './main-area-learning-panel';
import { findDocPage } from '../../utils/find-doc-page';
import { fetchUnifiedContent as fetchContent } from '../../docs-retrieval';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { sidebarState } from '../../global-state/sidebar';
import { testIds } from '../../constants/testIds';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockLocationPush = jest.fn();

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
  reportInteraction: jest.fn(),
  getAppEvents: jest.fn(() => ({ publish: jest.fn() })),
  config: { bootData: { user: { id: 1 } } },
  locationService: {
    push: (...args: any[]) => mockLocationPush(...args),
    getHistory: jest.fn(() => ({ listen: jest.fn(() => jest.fn()) })),
  },
}));

jest.mock('@grafana/scenes', () => ({
  SceneObjectBase: class SceneObjectBase {},
}));

jest.mock('@grafana/ui', () => ({
  useStyles2: (fn: any) => fn(mockTheme),
  Alert: ({ children, title, severity, ...rest }: any) => (
    <div data-testid={rest['data-testid']} data-severity={severity}>
      <span>{title}</span>
      {children}
    </div>
  ),
  Button: ({ children, onClick, ...rest }: any) => (
    <button data-testid={rest['data-testid']} onClick={onClick}>
      {children}
    </button>
  ),
}));

jest.mock('@grafana/i18n', () => ({
  t: jest.fn((_: string, def: string) => def),
}));

const mockTheme = {
  isDark: false,
  spacing: (n: number) => `${n * 8}px`,
  shape: { radius: { default: '4px', pill: '9999px' } },
  colors: {
    text: { primary: '#000', secondary: '#666', disabled: '#aaa' },
    background: { primary: '#fff', secondary: '#f5f5f5' },
    border: { weak: '#ddd' },
    action: { hover: '#eee' },
    primary: { shade: '#333' },
    error: { text: '#f00' },
    success: { main: '#0f0' },
  },
  typography: {
    h3: { fontSize: '24px' },
    h5: { fontSize: '16px' },
    body: { fontSize: '14px' },
    bodySmall: { fontSize: '12px' },
    fontWeightMedium: 500,
  },
  zIndex: { modal: 1000 },
};

jest.mock('../../utils/find-doc-page');
jest.mock('../../docs-retrieval', () => ({
  fetchUnifiedContent: jest.fn(),
  ContentRenderer: React.memo(function MockContentRenderer({ content }: any) {
    return <div data-testid="content-renderer">{content.url}</div>;
  }),
}));

jest.mock('../SkeletonLoader', () => ({
  SkeletonLoader: () => <div data-testid="skeleton-loader">Loading...</div>,
}));

let capturedOnOpenGuide: ((url: string, title: string) => void) | undefined;

jest.mock('../LearningPaths', () => ({
  MyLearningTab: ({ onOpenGuide }: { onOpenGuide: (url: string, title: string) => void }) => {
    capturedOnOpenGuide = onOpenGuide;
    return <div data-testid="my-learning-tab">MyLearningTab</div>;
  },
}));

jest.mock('../docs-panel/components', () => ({
  MyLearningErrorBoundary: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('../../global-state/sidebar', () => ({
  sidebarState: {
    getIsSidebarMounted: jest.fn(),
  },
}));

jest.mock('../../utils/guide-safety', () => ({
  isMainAreaSafe: jest.fn(() => ({ safe: true, unsafeActionTypes: [] })),
}));

jest.mock('../../utils/chrome-control', () => ({
  isNavVisible: jest.fn(() => false),
  collapseNav: jest.fn(),
  expandNav: jest.fn(),
  closeExtensionSidebar: jest.fn(),
  restoreSidebar: jest.fn(),
}));

jest.mock('../../global-state/main-area-learning-state', () => ({
  mainAreaLearningState: { getIsActive: jest.fn(() => false), setIsActive: jest.fn() },
}));

jest.mock('../../lib/user-storage', () => ({
  interactiveCompletionStorage: {
    get: jest.fn().mockResolvedValue(0),
    set: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
    getAll: jest.fn().mockResolvedValue({}),
    cleanup: jest.fn().mockResolvedValue(undefined),
    clearAll: jest.fn().mockResolvedValue(undefined),
  },
}));
const { interactiveCompletionStorage: mockCompletionStorage } = jest.requireMock('../../lib/user-storage');
// Import after mock setup for assertions
const { mainAreaLearningState: mockMainAreaState } = jest.requireMock('../../global-state/main-area-learning-state');
const { isMainAreaSafe: mockIsMainAreaSafe } = jest.requireMock('../../utils/guide-safety');
const {
  isNavVisible: mockIsNavVisible,
  collapseNav: mockCollapseNav,
  expandNav: mockExpandNav,
  closeExtensionSidebar: mockCloseExtensionSidebar,
  restoreSidebar: mockRestoreSidebar,
} = jest.requireMock('../../utils/chrome-control');

jest.mock('../../styles/content-html.styles', () => ({
  journeyContentHtml: () => 'journey-style',
  docsContentHtml: () => 'docs-style',
}));

jest.mock('../../styles/interactive.styles', () => ({
  getInteractiveStyles: () => 'interactive-style',
}));

jest.mock('../../styles/prism.styles', () => ({
  getPrismStyles: () => 'prism-style',
}));

jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: {
    MainAreaPageView: 'main_area_page_view',
    MainAreaGuideLoaded: 'main_area_guide_loaded',
    MainAreaGuideLoadFailed: 'main_area_guide_load_failed',
    MainAreaSafetyGateBlocked: 'main_area_safety_gate_blocked',
  },
}));

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

let replaceStateSpy: jest.SpyInstance;

function setUrlSearch(search: string) {
  const url = `http://localhost/a/grafana-pathfinder-app/learning${search}`;
  window.history.pushState({}, '', url);
}

function makeRawContent(url: string): any {
  return {
    content: '{}',
    metadata: { title: 'Test Guide' },
    type: 'interactive',
    url,
    lastFetched: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  capturedOnOpenGuide = undefined;
  setUrlSearch('');
  replaceStateSpy = jest.spyOn(window.history, 'replaceState').mockImplementation(() => {});
});

afterEach(() => {
  replaceStateSpy?.mockRestore();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MainAreaLearningPanelRenderer', () => {
  // --- Landing page fallback -----------------------------------------------

  describe('landing page', () => {
    it('renders MyLearningTab when no ?doc= param', () => {
      setUrlSearch('');
      render(<MainAreaLearningPanelRenderer />);
      expect(screen.getByTestId('my-learning-tab')).toBeInTheDocument();
      expect(screen.getByTestId(testIds.mainAreaLearning.landingPage)).toBeInTheDocument();
      // onOpenGuide callback is wired up to MyLearningTab
      expect(capturedOnOpenGuide).toBeDefined();
    });

    it('renders MyLearningTab when findDocPage returns null', async () => {
      setUrlSearch('?doc=unknown-thing');
      (findDocPage as jest.Mock).mockReturnValue(null);

      render(<MainAreaLearningPanelRenderer />);

      expect(screen.getByTestId('my-learning-tab')).toBeInTheDocument();
    });
  });

  // --- Loading state -------------------------------------------------------

  describe('loading state', () => {
    it('shows SkeletonLoader while fetchContent is in flight', async () => {
      setUrlSearch('?doc=bundled:test-guide');
      (findDocPage as jest.Mock).mockReturnValue({
        type: 'docs-page',
        url: 'bundled:test-guide',
        title: 'Test Guide',
      });
      // Never resolve — keeps loading
      (fetchContent as jest.Mock).mockReturnValue(new Promise(() => {}));

      render(<MainAreaLearningPanelRenderer />);

      expect(screen.getByTestId(testIds.mainAreaLearning.loadingState)).toBeInTheDocument();
      expect(screen.getByTestId('skeleton-loader')).toBeInTheDocument();
    });
  });

  // --- Content rendering ---------------------------------------------------

  describe('content rendering', () => {
    it('renders ContentRenderer with fetched RawContent', async () => {
      setUrlSearch('?doc=bundled:test-guide');
      const rawContent = makeRawContent('bundled:test-guide');
      (findDocPage as jest.Mock).mockReturnValue({
        type: 'docs-page',
        url: 'bundled:test-guide',
        title: 'Test Guide',
      });
      (fetchContent as jest.Mock).mockResolvedValue({ content: rawContent });

      render(<MainAreaLearningPanelRenderer />);

      await waitFor(() => {
        expect(screen.getByTestId('content-renderer')).toBeInTheDocument();
      });
    });

    it('content container has id="main-area-docs-content"', async () => {
      setUrlSearch('?doc=bundled:test-guide');
      const rawContent = makeRawContent('bundled:test-guide');
      (findDocPage as jest.Mock).mockReturnValue({
        type: 'docs-page',
        url: 'bundled:test-guide',
        title: 'Test Guide',
      });
      (fetchContent as jest.Mock).mockResolvedValue({ content: rawContent });

      render(<MainAreaLearningPanelRenderer />);

      await waitFor(() => {
        expect(screen.getByTestId(testIds.mainAreaLearning.contentContainer)).toBeInTheDocument();
      });

      const container = screen.getByTestId(testIds.mainAreaLearning.contentContainer);
      expect(container.id).toBe('main-area-docs-content');
    });
  });

  // --- Error state ---------------------------------------------------------

  describe('error state', () => {
    it('shows error Alert with "Try again" on fetch failure', async () => {
      setUrlSearch('?doc=bundled:broken');
      (findDocPage as jest.Mock).mockReturnValue({
        type: 'docs-page',
        url: 'bundled:broken',
        title: 'Broken Guide',
      });
      (fetchContent as jest.Mock).mockResolvedValue({
        content: null,
        error: 'Network error',
        errorType: 'network',
      });

      render(<MainAreaLearningPanelRenderer />);

      await waitFor(() => {
        expect(screen.getByTestId(testIds.mainAreaLearning.errorState)).toBeInTheDocument();
      });
      expect(screen.getByTestId(testIds.mainAreaLearning.retryButton)).toBeInTheDocument();
    });

    it('"Try again" re-triggers fetchContent', async () => {
      setUrlSearch('?doc=bundled:broken');
      (findDocPage as jest.Mock).mockReturnValue({
        type: 'docs-page',
        url: 'bundled:broken',
        title: 'Broken Guide',
      });
      (fetchContent as jest.Mock).mockResolvedValue({
        content: null,
        error: 'Network error',
        errorType: 'network',
      });

      render(<MainAreaLearningPanelRenderer />);

      await waitFor(() => {
        expect(screen.getByTestId(testIds.mainAreaLearning.retryButton)).toBeInTheDocument();
      });

      // Reset mock and make it succeed on retry
      const rawContent = makeRawContent('bundled:broken');
      (fetchContent as jest.Mock).mockResolvedValue({ content: rawContent });

      await act(async () => {
        screen.getByTestId(testIds.mainAreaLearning.retryButton).click();
      });

      await waitFor(() => {
        expect(fetchContent).toHaveBeenCalledTimes(2);
      });
    });
  });

  // --- URL cleanup ---------------------------------------------------------

  describe('URL cleanup', () => {
    it('preserves ?doc= param but strips chrome-control params', () => {
      setUrlSearch('?doc=bundled:test-guide&source=test&nav=false&sidebar=false&fullscreen=true');
      (findDocPage as jest.Mock).mockReturnValue({
        type: 'docs-page',
        url: 'bundled:test-guide',
        title: 'Test Guide',
      });
      (fetchContent as jest.Mock).mockReturnValue(new Promise(() => {}));

      render(<MainAreaLearningPanelRenderer />);

      expect(replaceStateSpy).toHaveBeenCalled();
      const calledUrl = replaceStateSpy.mock.calls[0][2] as string;
      expect(calledUrl).toContain('doc=bundled');
      expect(calledUrl).not.toContain('source=');
      expect(calledUrl).not.toContain('nav=');
      expect(calledUrl).not.toContain('sidebar=');
      expect(calledUrl).not.toContain('fullscreen=');
    });
  });

  // --- Content format restriction ------------------------------------------

  describe('content format restriction', () => {
    it('rejects /docs/ paths with unsupported format error', () => {
      setUrlSearch('?doc=/docs/grafana/latest/getting-started/');

      render(<MainAreaLearningPanelRenderer />);

      expect(screen.getByTestId(testIds.mainAreaLearning.unsupportedFormatError)).toBeInTheDocument();
      expect(findDocPage).not.toHaveBeenCalled();
    });

    it('rejects grafana.com URLs with unsupported format error', () => {
      setUrlSearch('?doc=https://grafana.com/docs/grafana/latest/');

      render(<MainAreaLearningPanelRenderer />);

      expect(screen.getByTestId(testIds.mainAreaLearning.unsupportedFormatError)).toBeInTheDocument();
      expect(findDocPage).not.toHaveBeenCalled();
    });

    it('rejects docs.grafana.com URLs with unsupported format error', () => {
      setUrlSearch('?doc=https://docs.grafana.com/docs/grafana/latest/');

      render(<MainAreaLearningPanelRenderer />);

      expect(screen.getByTestId(testIds.mainAreaLearning.unsupportedFormatError)).toBeInTheDocument();
    });

    it('accepts bundled: URLs', async () => {
      setUrlSearch('?doc=bundled:test-guide');
      const rawContent = makeRawContent('bundled:test-guide');
      (findDocPage as jest.Mock).mockReturnValue({
        type: 'docs-page',
        url: 'bundled:test-guide',
        title: 'Test Guide',
      });
      (fetchContent as jest.Mock).mockResolvedValue({ content: rawContent });

      render(<MainAreaLearningPanelRenderer />);

      await waitFor(() => {
        expect(screen.getByTestId('content-renderer')).toBeInTheDocument();
      });
    });

    it('accepts api: URLs', async () => {
      setUrlSearch('?doc=api:my-custom-guide');
      const rawContent = makeRawContent('backend-guide:my-custom-guide');
      (findDocPage as jest.Mock).mockReturnValue({
        type: 'docs-page',
        url: 'backend-guide:my-custom-guide',
        title: 'my-custom-guide',
      });
      (fetchContent as jest.Mock).mockResolvedValue({ content: rawContent });

      render(<MainAreaLearningPanelRenderer />);

      await waitFor(() => {
        expect(screen.getByTestId('content-renderer')).toBeInTheDocument();
      });
    });
  });

  // --- Analytics -----------------------------------------------------------

  describe('analytics', () => {
    it('fires MainAreaPageView on mount', () => {
      setUrlSearch('');
      render(<MainAreaLearningPanelRenderer />);

      expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.MainAreaPageView, {
        has_doc_param: false,
      });
    });

    it('fires MainAreaPageView with has_doc_param=true when param present', () => {
      setUrlSearch('?doc=bundled:test');
      (findDocPage as jest.Mock).mockReturnValue({
        type: 'docs-page',
        url: 'bundled:test',
        title: 'Test',
      });
      (fetchContent as jest.Mock).mockReturnValue(new Promise(() => {}));

      render(<MainAreaLearningPanelRenderer />);

      expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.MainAreaPageView, {
        has_doc_param: true,
      });
    });

    it('fires MainAreaGuideLoaded on successful fetch', async () => {
      setUrlSearch('?doc=bundled:test-guide');
      const rawContent = makeRawContent('bundled:test-guide');
      (findDocPage as jest.Mock).mockReturnValue({
        type: 'docs-page',
        url: 'bundled:test-guide',
        title: 'Test Guide',
      });
      (fetchContent as jest.Mock).mockResolvedValue({ content: rawContent });

      render(<MainAreaLearningPanelRenderer />);

      await waitFor(() => {
        expect(reportAppInteraction).toHaveBeenCalledWith(
          UserInteraction.MainAreaGuideLoaded,
          expect.objectContaining({
            guide_url: 'bundled:test-guide',
            guide_title: 'Test Guide',
          })
        );
      });
    });

    it('fires MainAreaGuideLoadFailed on fetch error', async () => {
      setUrlSearch('?doc=bundled:broken');
      (findDocPage as jest.Mock).mockReturnValue({
        type: 'docs-page',
        url: 'bundled:broken',
        title: 'Broken',
      });
      (fetchContent as jest.Mock).mockResolvedValue({
        content: null,
        error: 'Not found',
        errorType: 'not-found',
      });

      render(<MainAreaLearningPanelRenderer />);

      await waitFor(() => {
        expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.MainAreaGuideLoadFailed, {
          guide_url: 'bundled:broken',
          error_message: 'Not found',
        });
      });
    });
  });

  // --- Phase 2: Active state ------------------------------------------------

  describe('active state', () => {
    it('sets mainAreaLearningState active on mount', () => {
      setUrlSearch('');
      render(<MainAreaLearningPanelRenderer />);
      expect(mockMainAreaState.setIsActive).toHaveBeenCalledWith(true);
    });

    it('sets mainAreaLearningState inactive on unmount', () => {
      setUrlSearch('');
      const { unmount } = render(<MainAreaLearningPanelRenderer />);
      unmount();
      expect(mockMainAreaState.setIsActive).toHaveBeenCalledWith(false);
    });
  });

  // --- Phase 2: In-place navigation -----------------------------------------

  describe('in-place navigation', () => {
    it('handleOpenGuideInMainArea loads content without page reload', async () => {
      setUrlSearch('');
      const rawContent = makeRawContent('bundled:second-guide');
      (findDocPage as jest.Mock).mockReturnValue({
        type: 'docs-page',
        url: 'bundled:second-guide',
        title: 'Second Guide',
      });
      (fetchContent as jest.Mock).mockResolvedValue({ content: rawContent });

      render(<MainAreaLearningPanelRenderer />);

      // Landing page is shown initially
      expect(screen.getByTestId('my-learning-tab')).toBeInTheDocument();
      expect(capturedOnOpenGuide).toBeDefined();

      // Trigger in-place navigation via the onOpenGuide callback
      await act(async () => {
        capturedOnOpenGuide!('bundled:second-guide', 'Second Guide');
      });

      await waitFor(() => {
        expect(screen.getByTestId('content-renderer')).toBeInTheDocument();
      });

      // Landing page should be gone
      expect(screen.queryByTestId('my-learning-tab')).not.toBeInTheDocument();
    });

    it('pathfinder-open-in-main-area event loads content in-place', async () => {
      setUrlSearch('');
      const rawContent = makeRawContent('bundled:event-guide');
      (findDocPage as jest.Mock).mockReturnValue({
        type: 'docs-page',
        url: 'bundled:event-guide',
        title: 'Event Guide',
      });
      (fetchContent as jest.Mock).mockResolvedValue({ content: rawContent });

      render(<MainAreaLearningPanelRenderer />);

      // Dispatch the custom event
      await act(async () => {
        document.dispatchEvent(
          new CustomEvent('pathfinder-open-in-main-area', {
            detail: { url: 'bundled:event-guide', title: 'Event Guide' },
          })
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId('content-renderer')).toBeInTheDocument();
      });
    });

    it('ignores unsupported URLs in handleOpenGuideInMainArea', () => {
      setUrlSearch('');
      render(<MainAreaLearningPanelRenderer />);

      expect(capturedOnOpenGuide).toBeDefined();

      // Call with an unsupported URL — should not trigger fetchContent
      act(() => {
        capturedOnOpenGuide!('/docs/grafana/latest/', 'Docs');
      });

      expect(fetchContent).not.toHaveBeenCalled();
      // Landing page should still be shown
      expect(screen.getByTestId('my-learning-tab')).toBeInTheDocument();
    });
  });

  // --- Phase 3: Layout and styling -------------------------------------------

  describe('layout and styling', () => {
    it('content container has contentBody class with max-width constraint', async () => {
      setUrlSearch('?doc=bundled:test-guide');
      const rawContent = makeRawContent('bundled:test-guide');
      (findDocPage as jest.Mock).mockReturnValue({
        type: 'docs-page',
        url: 'bundled:test-guide',
        title: 'Test Guide',
      });
      (fetchContent as jest.Mock).mockResolvedValue({ content: rawContent });

      render(<MainAreaLearningPanelRenderer />);

      await waitFor(() => {
        expect(screen.getByTestId(testIds.mainAreaLearning.contentContainer)).toBeInTheDocument();
      });

      const container = screen.getByTestId(testIds.mainAreaLearning.contentContainer);
      // The contentBody class is applied (Emotion generates a className)
      expect(container.className).toBeTruthy();
      expect(container.className.length).toBeGreaterThan(0);
    });

    it('renders GuideProgressHeader when content is loaded', async () => {
      setUrlSearch('?doc=bundled:test-guide');
      const rawContent = makeRawContent('bundled:test-guide');
      (findDocPage as jest.Mock).mockReturnValue({
        type: 'docs-page',
        url: 'bundled:test-guide',
        title: 'Test Guide',
      });
      (fetchContent as jest.Mock).mockResolvedValue({ content: rawContent });

      render(<MainAreaLearningPanelRenderer />);

      await waitFor(() => {
        expect(screen.getByTestId(testIds.mainAreaLearning.progressHeader)).toBeInTheDocument();
      });

      expect(screen.getByText('Test Guide')).toBeInTheDocument();
    });

    it('progress header shows completion percentage from storage', async () => {
      setUrlSearch('?doc=bundled:test-guide');
      const rawContent = makeRawContent('bundled:test-guide');
      (findDocPage as jest.Mock).mockReturnValue({
        type: 'docs-page',
        url: 'bundled:test-guide',
        title: 'Test Guide',
      });
      (fetchContent as jest.Mock).mockResolvedValue({ content: rawContent });
      mockCompletionStorage.get.mockResolvedValue(42);

      render(<MainAreaLearningPanelRenderer />);

      await waitFor(() => {
        expect(screen.getByText('42% complete')).toBeInTheDocument();
      });
    });

    it('progress header updates on interactive-progress-saved event', async () => {
      setUrlSearch('?doc=bundled:test-guide');
      const rawContent = makeRawContent('bundled:test-guide');
      (findDocPage as jest.Mock).mockReturnValue({
        type: 'docs-page',
        url: 'bundled:test-guide',
        title: 'Test Guide',
      });
      (fetchContent as jest.Mock).mockResolvedValue({ content: rawContent });
      mockCompletionStorage.get.mockResolvedValue(0);

      render(<MainAreaLearningPanelRenderer />);

      await waitFor(() => {
        expect(screen.getByTestId(testIds.mainAreaLearning.progressHeader)).toBeInTheDocument();
      });

      // Dispatch progress event
      act(() => {
        window.dispatchEvent(
          new CustomEvent('interactive-progress-saved', {
            detail: { contentKey: 'bundled:test-guide', completionPercentage: 75, hasProgress: true },
          })
        );
      });

      await waitFor(() => {
        expect(screen.getByText('75% complete')).toBeInTheDocument();
      });
    });

    it('does not show progress header on landing page', () => {
      setUrlSearch('');
      render(<MainAreaLearningPanelRenderer />);

      expect(screen.queryByTestId(testIds.mainAreaLearning.progressHeader)).not.toBeInTheDocument();
    });
  });

  // --- Phase 4: Content safety gate ------------------------------------------

  describe('content safety gate', () => {
    it('shows safety gate warning for unsafe guides', async () => {
      setUrlSearch('?doc=bundled:unsafe-guide');
      (findDocPage as jest.Mock).mockReturnValue({
        type: 'docs-page',
        url: 'bundled:unsafe-guide',
        title: 'Unsafe Guide',
      });
      const rawContent = makeRawContent('bundled:unsafe-guide');
      (fetchContent as jest.Mock).mockResolvedValue({ content: rawContent });
      mockIsMainAreaSafe.mockReturnValue({ safe: false, unsafeActionTypes: ['highlight', 'button'] });

      render(<MainAreaLearningPanelRenderer />);

      await waitFor(() => {
        expect(screen.getByTestId(testIds.mainAreaLearning.safetyGateWarning)).toBeInTheDocument();
      });

      // Content should NOT be rendered
      expect(screen.queryByTestId('content-renderer')).not.toBeInTheDocument();
      expect(screen.queryByTestId(testIds.mainAreaLearning.progressHeader)).not.toBeInTheDocument();
    });

    it('fires MainAreaSafetyGateBlocked analytics for unsafe guides', async () => {
      setUrlSearch('?doc=bundled:unsafe-guide');
      (findDocPage as jest.Mock).mockReturnValue({
        type: 'docs-page',
        url: 'bundled:unsafe-guide',
        title: 'Unsafe Guide',
      });
      const rawContent = makeRawContent('bundled:unsafe-guide');
      (fetchContent as jest.Mock).mockResolvedValue({ content: rawContent });
      mockIsMainAreaSafe.mockReturnValue({ safe: false, unsafeActionTypes: ['highlight'] });

      render(<MainAreaLearningPanelRenderer />);

      await waitFor(() => {
        expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.MainAreaSafetyGateBlocked, {
          guide_url: 'bundled:unsafe-guide',
          unsafe_action_types: 'highlight',
        });
      });
    });

    it('renders content normally for safe guides', async () => {
      setUrlSearch('?doc=bundled:safe-guide');
      (findDocPage as jest.Mock).mockReturnValue({
        type: 'docs-page',
        url: 'bundled:safe-guide',
        title: 'Safe Guide',
      });
      const rawContent = makeRawContent('bundled:safe-guide');
      (fetchContent as jest.Mock).mockResolvedValue({ content: rawContent });
      mockIsMainAreaSafe.mockReturnValue({ safe: true, unsafeActionTypes: [] });

      render(<MainAreaLearningPanelRenderer />);

      await waitFor(() => {
        expect(screen.getByTestId('content-renderer')).toBeInTheDocument();
      });

      expect(screen.queryByTestId(testIds.mainAreaLearning.safetyGateWarning)).not.toBeInTheDocument();
    });

    it('safety gate resets when navigating to a new guide in-place', async () => {
      setUrlSearch('');
      mockIsMainAreaSafe.mockReturnValue({ safe: false, unsafeActionTypes: ['highlight'] });

      const rawContent = makeRawContent('bundled:unsafe-guide');
      (findDocPage as jest.Mock).mockReturnValue({
        type: 'docs-page',
        url: 'bundled:unsafe-guide',
        title: 'Unsafe Guide',
      });
      (fetchContent as jest.Mock).mockResolvedValue({ content: rawContent });

      render(<MainAreaLearningPanelRenderer />);

      // Navigate to an unsafe guide via onOpenGuide
      await act(async () => {
        capturedOnOpenGuide!('bundled:unsafe-guide', 'Unsafe Guide');
      });

      await waitFor(() => {
        expect(screen.getByTestId(testIds.mainAreaLearning.safetyGateWarning)).toBeInTheDocument();
      });

      // Now navigate to a safe guide
      const safeContent = makeRawContent('bundled:safe-guide');
      mockIsMainAreaSafe.mockReturnValue({ safe: true, unsafeActionTypes: [] });
      (findDocPage as jest.Mock).mockReturnValue({
        type: 'docs-page',
        url: 'bundled:safe-guide',
        title: 'Safe Guide',
      });
      (fetchContent as jest.Mock).mockResolvedValue({ content: safeContent });

      await act(async () => {
        capturedOnOpenGuide!('bundled:safe-guide', 'Safe Guide');
      });

      await waitFor(() => {
        expect(screen.getByTestId('content-renderer')).toBeInTheDocument();
      });

      expect(screen.queryByTestId(testIds.mainAreaLearning.safetyGateWarning)).not.toBeInTheDocument();
    });
  });

  // --- Phase 5: Chrome controls -----------------------------------------------

  describe('chrome controls', () => {
    it('does not touch nav or sidebar when no chrome params', () => {
      setUrlSearch('');
      render(<MainAreaLearningPanelRenderer />);

      expect(mockCollapseNav).not.toHaveBeenCalled();
      expect(mockCloseExtensionSidebar).not.toHaveBeenCalled();
    });

    it('collapses nav when nav=false and nav is visible', () => {
      setUrlSearch('?nav=false');
      mockIsNavVisible.mockReturnValue(true);

      render(<MainAreaLearningPanelRenderer />);

      expect(mockCollapseNav).toHaveBeenCalledTimes(1);
    });

    it('does not collapse nav when nav=false but nav is already hidden', () => {
      setUrlSearch('?nav=false');
      mockIsNavVisible.mockReturnValue(false);

      render(<MainAreaLearningPanelRenderer />);

      expect(mockCollapseNav).not.toHaveBeenCalled();
    });

    it('closes sidebar when sidebar=false and sidebar is mounted', () => {
      setUrlSearch('?sidebar=false');
      (sidebarState.getIsSidebarMounted as jest.Mock).mockReturnValue(true);

      render(<MainAreaLearningPanelRenderer />);

      expect(mockCloseExtensionSidebar).toHaveBeenCalledTimes(1);
    });

    it('does not close sidebar when sidebar=false but sidebar is not mounted', () => {
      setUrlSearch('?sidebar=false');
      (sidebarState.getIsSidebarMounted as jest.Mock).mockReturnValue(false);

      render(<MainAreaLearningPanelRenderer />);

      // Initial close not called (sidebar wasn't mounted)
      expect(mockCloseExtensionSidebar).not.toHaveBeenCalled();
    });

    it('fullscreen=true collapses nav and closes sidebar', () => {
      setUrlSearch('?fullscreen=true');
      mockIsNavVisible.mockReturnValue(true);
      (sidebarState.getIsSidebarMounted as jest.Mock).mockReturnValue(true);

      render(<MainAreaLearningPanelRenderer />);

      expect(mockCollapseNav).toHaveBeenCalledTimes(1);
      expect(mockCloseExtensionSidebar).toHaveBeenCalledTimes(1);
    });

    it('restores nav on unmount when we collapsed it', () => {
      setUrlSearch('?nav=false');
      mockIsNavVisible.mockReturnValue(true);

      const { unmount } = render(<MainAreaLearningPanelRenderer />);

      // On unmount cleanup, isNavVisible returns false (nav is still collapsed)
      mockIsNavVisible.mockReturnValue(false);
      unmount();

      expect(mockExpandNav).toHaveBeenCalledTimes(1);
    });

    it('restores sidebar on unmount when we closed it', () => {
      setUrlSearch('?sidebar=false');
      (sidebarState.getIsSidebarMounted as jest.Mock).mockReturnValue(true);

      const { unmount } = render(<MainAreaLearningPanelRenderer />);

      // On unmount cleanup, sidebar is still not mounted (we closed it)
      (sidebarState.getIsSidebarMounted as jest.Mock).mockReturnValue(false);
      unmount();

      expect(mockRestoreSidebar).toHaveBeenCalledTimes(1);
    });

    it('does not restore nav if user manually re-expanded it', () => {
      setUrlSearch('?nav=false');
      mockIsNavVisible.mockReturnValue(true);

      const { unmount } = render(<MainAreaLearningPanelRenderer />);

      // User re-expanded nav — isNavVisible returns true on cleanup
      mockIsNavVisible.mockReturnValue(true);
      unmount();

      expect(mockExpandNav).not.toHaveBeenCalled();
    });

    it('does not restore sidebar if user manually reopened it', () => {
      setUrlSearch('?sidebar=false');
      (sidebarState.getIsSidebarMounted as jest.Mock).mockReturnValue(true);

      const { unmount } = render(<MainAreaLearningPanelRenderer />);

      // User reopened sidebar — getIsSidebarMounted returns true on cleanup
      (sidebarState.getIsSidebarMounted as jest.Mock).mockReturnValue(true);
      unmount();

      expect(mockRestoreSidebar).not.toHaveBeenCalled();
    });

    it('suppresses sidebar that mounts late via pathfinder-sidebar-mounted listener', () => {
      setUrlSearch('?sidebar=false');
      (sidebarState.getIsSidebarMounted as jest.Mock).mockReturnValue(false);

      render(<MainAreaLearningPanelRenderer />);

      // Sidebar wasn't mounted initially, so closeExtensionSidebar not called yet
      expect(mockCloseExtensionSidebar).not.toHaveBeenCalled();

      // Sidebar mounts late (e.g., experiment auto-open)
      act(() => {
        window.dispatchEvent(new CustomEvent('pathfinder-sidebar-mounted'));
      });

      expect(mockCloseExtensionSidebar).toHaveBeenCalledTimes(1);
    });

    it('removes pathfinder-sidebar-mounted listener on unmount', () => {
      setUrlSearch('?sidebar=false');
      (sidebarState.getIsSidebarMounted as jest.Mock).mockReturnValue(false);

      const { unmount } = render(<MainAreaLearningPanelRenderer />);
      unmount();

      // Dispatch after unmount — should NOT trigger closeExtensionSidebar
      mockCloseExtensionSidebar.mockClear();
      act(() => {
        window.dispatchEvent(new CustomEvent('pathfinder-sidebar-mounted'));
      });

      expect(mockCloseExtensionSidebar).not.toHaveBeenCalled();
    });

    it('strips chrome params from URL after processing', () => {
      setUrlSearch('?nav=false&sidebar=false&fullscreen=true');
      (fetchContent as jest.Mock).mockReturnValue(new Promise(() => {}));

      render(<MainAreaLearningPanelRenderer />);

      expect(replaceStateSpy).toHaveBeenCalled();
      const calledUrl = replaceStateSpy.mock.calls[0][2] as string;
      expect(calledUrl).not.toContain('nav=');
      expect(calledUrl).not.toContain('sidebar=');
      expect(calledUrl).not.toContain('fullscreen=');
    });
  });

  // --- Layout width ----------------------------------------------------------

  describe('layout width', () => {
    it('applies default width for guides without layout field', async () => {
      setUrlSearch('?doc=bundled:test-guide');
      const rawContent = makeRawContent('bundled:test-guide');
      rawContent.content = JSON.stringify({ id: 'test', title: 'Test', blocks: [] });
      (findDocPage as jest.Mock).mockReturnValue({
        type: 'docs-page',
        url: 'bundled:test-guide',
        title: 'Test Guide',
      });
      (fetchContent as jest.Mock).mockResolvedValue({ content: rawContent });

      render(<MainAreaLearningPanelRenderer />);

      await waitFor(() => {
        const container = screen.getByTestId(testIds.mainAreaLearning.contentContainer);
        expect(container.className).toBeTruthy();
      });
    });

    it('applies different className for guides with layout: "wide"', async () => {
      setUrlSearch('?doc=bundled:wide-guide');
      const rawContent = makeRawContent('bundled:wide-guide');
      rawContent.content = JSON.stringify({ id: 'wide', title: 'Wide', layout: 'wide', blocks: [] });
      (findDocPage as jest.Mock).mockReturnValue({
        type: 'docs-page',
        url: 'bundled:wide-guide',
        title: 'Wide Guide',
      });
      (fetchContent as jest.Mock).mockResolvedValue({ content: rawContent });

      render(<MainAreaLearningPanelRenderer />);

      await waitFor(() => {
        const container = screen.getByTestId(testIds.mainAreaLearning.contentContainer);
        expect(container.className).toBeTruthy();
      });
    });

    it('applies different className for guides with layout: "full"', async () => {
      setUrlSearch('?doc=bundled:full-guide');
      const rawContent = makeRawContent('bundled:full-guide');
      rawContent.content = JSON.stringify({ id: 'full', title: 'Full', layout: 'full', blocks: [] });
      (findDocPage as jest.Mock).mockReturnValue({
        type: 'docs-page',
        url: 'bundled:full-guide',
        title: 'Full Guide',
      });
      (fetchContent as jest.Mock).mockResolvedValue({ content: rawContent });

      render(<MainAreaLearningPanelRenderer />);

      await waitFor(() => {
        const container = screen.getByTestId(testIds.mainAreaLearning.contentContainer);
        expect(container.className).toBeTruthy();
      });
    });
  });

  // --- Remote URL support ----------------------------------------------------

  describe('remote URL support', () => {
    it('loads remote GitHub content when doc=remote:...', async () => {
      const remoteUrl = 'https://raw.githubusercontent.com/grafana/repo/main/guide.json';
      setUrlSearch(`?doc=remote:${remoteUrl}`);
      (findDocPage as jest.Mock).mockReturnValue({
        type: 'interactive',
        url: remoteUrl,
        title: 'Guide',
      });
      const rawContent = makeRawContent(remoteUrl);
      (fetchContent as jest.Mock).mockResolvedValue({ content: rawContent });

      render(<MainAreaLearningPanelRenderer />);

      await waitFor(() => {
        expect(screen.getByTestId(testIds.mainAreaLearning.contentContainer)).toBeInTheDocument();
      });

      expect(fetchContent).toHaveBeenCalledWith(remoteUrl);
    });

    it('preserves remote doc param in URL after cleanup', () => {
      const remoteUrl = 'https://raw.githubusercontent.com/grafana/repo/main/guide.json';
      setUrlSearch(`?doc=remote:${remoteUrl}&nav=false`);
      (findDocPage as jest.Mock).mockReturnValue({
        type: 'interactive',
        url: remoteUrl,
        title: 'Guide',
      });
      (fetchContent as jest.Mock).mockReturnValue(new Promise(() => {}));

      render(<MainAreaLearningPanelRenderer />);

      expect(replaceStateSpy).toHaveBeenCalled();
      const calledUrl = replaceStateSpy.mock.calls[0][2] as string;
      expect(calledUrl).toContain('doc=remote');
      expect(calledUrl).not.toContain('nav=');
    });
  });
});
