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
  getMilestoneSlug: jest.fn(),
  markMilestoneDone: jest.fn(),
  setJourneyCompletionPercentage: jest.fn(),
}));

// Heavy leaf children are irrelevant to the footer button — stub them out so
// the branch renders without their dependency trees.
jest.mock('../../content-renderer/content-renderer', () => ({ ContentRenderer: () => null }));
jest.mock('../../SelectorDebugPanel', () => ({ SelectorDebugPanel: () => null }));
jest.mock('./LearningJourneyMilestoneToolbar', () => ({ LearningJourneyMilestoneToolbar: () => null }));
jest.mock('./PanelModeActionButtons', () => ({ PanelModeActionButtons: () => null }));

const { reportAppInteraction } = jest.requireMock('../../../lib/analytics');

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
