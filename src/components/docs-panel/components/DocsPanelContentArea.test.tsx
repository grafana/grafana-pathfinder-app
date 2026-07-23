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
  recordStandaloneGuideCompletion: jest.fn(),
  setJourneyCompletionPercentage: jest.fn(),
  setMilestoneCompletionPercentage: jest.fn(),
}));

jest.mock('../../content-renderer/content-renderer', () => ({
  ContentRenderer: ({ onGuideComplete }: { onGuideComplete?: () => void }) => (
    <button onClick={onGuideComplete}>Complete rendered guide</button>
  ),
}));
jest.mock('./LearningJourneyMilestoneToolbar', () => ({ LearningJourneyMilestoneToolbar: () => null }));
jest.mock('./PanelModeActionButtons', () => ({ PanelModeActionButtons: () => null }));

const { reportAppInteraction } = jest.requireMock('../../../lib/analytics');
const { getMilestoneSlug, markMilestoneDone, recordStandaloneGuideCompletion, setMilestoneCompletionPercentage } =
  jest.requireMock('../../../docs-retrieval');

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
    isWysiwygPreview: false,
    activeTabId: 'tab-1',
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

      expect(recordStandaloneGuideCompletion).toHaveBeenCalledWith({
        packageManifest: { id: 'remote-guide', repository: 'app-platform' },
        guideTitle: 'My guide',
      });
    });

    it('uses milestone-owned progress and fact paths for a learning journey', () => {
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
      getMilestoneSlug.mockReturnValue('select-platform');

      render(<DocsPanelContentArea {...props} />);
      fireEvent.click(screen.getByRole('button', { name: 'Complete rendered guide' }));

      expect(setMilestoneCompletionPercentage).toHaveBeenCalledWith('bundled:select-platform', 100);
      expect(markMilestoneDone).toHaveBeenCalledWith(
        'bundled:select-platform',
        'select-platform',
        3,
        expect.objectContaining({
          packageManifest: { id: 'linux-journey', repository: 'app-platform' },
        })
      );
      expect(recordStandaloneGuideCompletion).not.toHaveBeenCalled();
    });
  });
});
