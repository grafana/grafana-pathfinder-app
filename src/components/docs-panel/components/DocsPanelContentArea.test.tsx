/**
 * Tests for DocsPanelContentArea.
 *
 * Focused on the "Return to my learning" footer button, which must switch the
 * panel back to the recommendations tab in place (issue #1051) rather than
 * navigating away from the Grafana UI.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DocsPanelContentArea, type DocsPanelContentAreaProps } from './DocsPanelContentArea';

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string) => fallback,
}));

jest.mock('@grafana/data', () => ({
  ...jest.requireActual('@grafana/data'),
  usePluginContext: () => ({ meta: { jsonData: {} } }),
}));

jest.mock('../../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  getContentTypeForAnalytics: jest.fn(() => 'docs'),
  UserInteraction: {
    DocsPanelInteraction: 'docs_panel_interaction',
    OpenExtraResource: 'open_extra_resource',
  },
}));

jest.mock('../../../docs-retrieval', () => ({
  recordGuideCompletionForSurface: jest.fn(),
}));

// Heavy leaf children are irrelevant to these tests — stub them out so the
// branch renders without their dependency trees. ContentRenderer exposes a
// button that fires onGuideComplete so the completion-boundary tests can drive it.
jest.mock('../../content-renderer/content-renderer', () => ({
  ContentRenderer: ({ onGuideComplete }: { onGuideComplete?: () => void }) => (
    <button onClick={onGuideComplete}>Complete rendered guide</button>
  ),
}));
jest.mock('../../SelectorDebugPanel', () => ({ SelectorDebugPanel: () => null }));
jest.mock('./LearningJourneyMilestoneToolbar', () => ({ LearningJourneyMilestoneToolbar: () => null }));
jest.mock('./PanelModeActionButtons', () => ({ PanelModeActionButtons: () => null }));

const { reportAppInteraction } = jest.requireMock('../../../lib/analytics');
const { recordGuideCompletionForSurface } = jest.requireMock('../../../docs-retrieval');

function makeProps(overrides: Partial<DocsPanelContentAreaProps> = {}): DocsPanelContentAreaProps {
  const activeTab: any = {
    id: 'tab-1',
    title: 'My guide',
    type: 'learning-journey',
    baseUrl: 'https://example.com/guide',
    currentUrl: 'https://example.com/guide',
    content: { url: 'https://example.com/guide', type: 'docs', metadata: {}, content: '' },
    isLoading: false,
    error: null,
  };

  // Proxy returns each requested style key as its own class name — every
  // `styles.foo` access yields a truthy string without hand-maintaining a map.
  const styles = new Proxy({}, { get: (_target, prop) => String(prop) }) as any;

  return {
    styles,
    journeyStyles: 'journeyStyles',
    docsStyles: 'docsStyles',
    interactiveStyles: 'interactiveStyles',
    prismStyles: 'prismStyles',
    model: {
      setActiveTab: jest.fn(),
      openEditorTab: jest.fn(),
      confirmAlignment: jest.fn(),
      dismissAlignment: jest.fn(),
    } as any,
    contextPanel: { Component: () => null } as any,
    isFullScreenActive: false,
    isRecommendationsTab: false,
    isEditorUser: false,
    isDevMode: false,
    isWysiwygPreview: false,
    activeTab,
    stableContent: activeTab.content,
    hasInteractiveProgress: false,
    progressKey: null,
    alignmentPendingValue: { isPending: false, startingLocation: null },
    contentRef: React.createRef<HTMLDivElement>(),
    handleResetGuide: jest.fn(),
    reloadActiveTab: jest.fn(),
    restoreScrollPosition: jest.fn(),
    ...overrides,
  };
}

describe('DocsPanelContentArea', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Return to my learning footer button', () => {
    it('switches to the recommendations tab in place instead of navigating away', () => {
      const props = makeProps();
      render(<DocsPanelContentArea {...props} />);

      fireEvent.click(screen.getByRole('button', { name: 'Return to my learning' }));

      expect(props.model.setActiveTab).toHaveBeenCalledWith('recommendations');
    });

    it('reports the return-to-recommendations interaction', () => {
      render(<DocsPanelContentArea {...makeProps()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Return to my learning' }));

      expect(reportAppInteraction).toHaveBeenCalledWith('docs_panel_interaction', {
        action: 'navigate_to_recommendations',
        source: 'content_footer',
      });
    });
  });

  describe('completion boundary', () => {
    it('records an ordinary remote interactive guide from its manifest', () => {
      const base = makeProps();
      const props = makeProps({
        activeTab: {
          ...base.activeTab,
          type: 'docs',
          baseUrl: 'https://example.com/remote-guide',
          currentUrl: 'https://example.com/remote-guide/content.json',
        } as any,
        stableContent: {
          url: 'https://example.com/remote-guide/content.json',
          type: 'docs',
          content: '',
          metadata: { packageManifest: { id: 'remote-guide', repository: 'app-platform' } },
        } as any,
      });

      render(<DocsPanelContentArea {...props} />);
      fireEvent.click(screen.getByRole('button', { name: 'Complete rendered guide' }));

      // The sidebar forwards its view-level identity to the shared, surface-neutral
      // emitter; the bundled-vs-remote / milestone decision is owned and tested there.
      expect(recordGuideCompletionForSurface).toHaveBeenCalledWith({
        baseUrl: 'https://example.com/remote-guide',
        contentUrl: 'https://example.com/remote-guide/content.json',
        currentUrl: 'https://example.com/remote-guide/content.json',
        contentType: 'docs',
        metadata: { packageManifest: { id: 'remote-guide', repository: 'app-platform' } },
        guideTitle: 'My guide',
      });
    });

    it('forwards learning-journey identity (base, current milestone, manifest) to the shared emitter', () => {
      const base = makeProps();
      const props = makeProps({
        activeTab: {
          ...base.activeTab,
          baseUrl: 'bundled:select-platform',
          currentUrl: 'https://example.com/select-platform/content.json',
        } as any,
        stableContent: {
          url: 'bundled:select-platform',
          type: 'learning-journey',
          content: '',
          metadata: {
            packageManifest: { id: 'linux-journey', repository: 'app-platform' },
            learningJourney: { totalMilestones: 3 },
          },
        } as any,
      });

      render(<DocsPanelContentArea {...props} />);
      fireEvent.click(screen.getByRole('button', { name: 'Complete rendered guide' }));

      expect(recordGuideCompletionForSurface).toHaveBeenCalledWith({
        baseUrl: 'bundled:select-platform',
        contentUrl: 'bundled:select-platform',
        currentUrl: 'https://example.com/select-platform/content.json',
        contentType: 'learning-journey',
        metadata: {
          packageManifest: { id: 'linux-journey', repository: 'app-platform' },
          learningJourney: { totalMilestones: 3 },
        },
        guideTitle: 'My guide',
      });
    });
  });

  describe('Dev Tools render gate', () => {
    const devToolsTab = {
      id: 'devtools',
      type: 'devtools' as const,
      title: 'Dev Tools',
      baseUrl: '',
      currentUrl: '',
      content: null,
      isLoading: false,
      error: null,
    };

    it('renders Dev Tools when the tab type and dev-mode gate both allow it', () => {
      render(<DocsPanelContentArea {...makeProps({ activeTab: devToolsTab, stableContent: null, isDevMode: true })} />);

      expect(screen.getByTestId('devtools-tab-content')).toBeInTheDocument();
    });

    it('does not dispatch to Dev Tools from the reserved ID alone', () => {
      render(
        <DocsPanelContentArea
          {...makeProps({
            activeTab: { ...devToolsTab, type: 'docs' },
            stableContent: null,
            isDevMode: true,
          })}
        />
      );

      expect(screen.queryByTestId('devtools-tab-content')).not.toBeInTheDocument();
    });
  });

  describe('Unauthorized gated chrome', () => {
    // Pruning removes these tabs from state, but the render pass that observes
    // the revoked gate must land somewhere coherent rather than falling into the
    // content branches, which assume a tab with a URL to fetch.
    const home = { Component: () => <div data-testid="home-content" /> } as any;

    it('renders home for a Dev Tools tab when dev mode is off', () => {
      render(
        <DocsPanelContentArea
          {...makeProps({
            activeTab: {
              id: 'devtools',
              type: 'devtools',
              title: 'Dev Tools',
              baseUrl: '',
              currentUrl: '',
              content: null,
              isLoading: false,
              error: null,
            } as any,
            stableContent: null,
            isDevMode: false,
            contextPanel: home,
          })}
        />
      );

      expect(screen.getByTestId('home-content')).toBeInTheDocument();
      expect(screen.queryByTestId('devtools-tab-content')).not.toBeInTheDocument();
    });

    it('renders home for an editor tab when the user is not an editor', () => {
      render(
        <DocsPanelContentArea
          {...makeProps({
            activeTab: {
              id: 'editor',
              type: 'editor',
              title: 'New Guide',
              baseUrl: '',
              currentUrl: '',
              content: null,
              isLoading: false,
              error: null,
            } as any,
            stableContent: null,
            isEditorUser: false,
            contextPanel: home,
          })}
        />
      );

      expect(screen.getByTestId('home-content')).toBeInTheDocument();
      expect(screen.queryByTestId('editor-tab-content')).not.toBeInTheDocument();
    });
  });
});
