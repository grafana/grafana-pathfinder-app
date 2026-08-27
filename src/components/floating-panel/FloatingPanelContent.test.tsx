/**
 * Surface-level completion-emission test for FloatingPanelContent, the content
 * owner shared by BOTH the floating and full-screen surfaces (FloatingPanelManager
 * and FullScreenPanel each render through it without wiring emission themselves).
 * Completing a guide in either surface must route through the shared, surface-neutral
 * emitter — see `surface-emission-owner`.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DocsPanelModelOperations } from '../docs-panel/types';
import { FloatingPanelContent } from './FloatingPanelContent';

jest.mock('../content-renderer/content-renderer', () => ({
  ContentRenderer: ({ onGuideComplete }: { onGuideComplete?: () => void }) => (
    <button onClick={onGuideComplete}>Complete rendered guide</button>
  ),
}));

jest.mock('../../docs-retrieval', () => ({
  recordGuideCompletionForSurface: jest.fn(),
}));

jest.mock('../docs-panel/link-handler.hook', () => ({
  useLinkClickHandler: jest.fn(),
}));

jest.mock('../docs-panel/components', () => ({
  AlignmentPrompt: () => null,
  LearningJourneyMilestoneToolbar: jest.fn(() => null),
}));

jest.mock('../InteractiveLearningBanner', () => ({
  InteractiveLearningBanner: () => null,
}));

jest.mock('@grafana/ui', () => ({
  useStyles2: () => ({}),
  useTheme2: () => ({}),
}));

const { recordGuideCompletionForSurface } = jest.requireMock('../../docs-retrieval');
const { useLinkClickHandler } = jest.requireMock('../docs-panel/link-handler.hook');
const { LearningJourneyMilestoneToolbar } = jest.requireMock('../docs-panel/components');

function content(overrides: Record<string, unknown> = {}): any {
  return {
    url: 'https://example.com/remote-guide/content.json',
    type: 'docs',
    content: '',
    metadata: { title: 'Remote guide', packageManifest: { id: 'remote-guide', repository: 'app-platform' } },
    lastFetched: '',
    ...overrides,
  };
}

function activeTab(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'tab-1',
    title: 'My guide',
    type: 'docs',
    baseUrl: 'https://example.com/remote-guide',
    currentUrl: 'https://example.com/remote-guide/content.json',
    ...overrides,
  };
}

function panelModel(): DocsPanelModelOperations {
  return {
    openLearningJourney: jest.fn(),
    openDocsPage: jest.fn(),
    loadTab: jest.fn(),
    closeTab: jest.fn(),
    setActiveTab: jest.fn(),
    navigateToNextMilestone: jest.fn(),
    navigateToPreviousMilestone: jest.fn(),
    canNavigateNext: jest.fn(),
    canNavigatePrevious: jest.fn(),
    openDevToolsTab: jest.fn(),
    openEditorTab: jest.fn(),
    updateEditorTabTitle: jest.fn(),
    getActiveTab: jest.fn(),
    confirmAlignment: jest.fn(),
    dismissAlignment: jest.fn(),
    _recordAutoLaunchSource: jest.fn(),
  };
}

beforeEach(() => {
  recordGuideCompletionForSurface.mockClear();
  useLinkClickHandler.mockClear();
  LearningJourneyMilestoneToolbar.mockClear();
});

describe('FloatingPanelContent completion emission', () => {
  it('routes a completed guide through the shared surface-neutral emitter', () => {
    render(<FloatingPanelContent content={content()} activeTab={activeTab()} model={panelModel()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Complete rendered guide' }));

    expect(recordGuideCompletionForSurface).toHaveBeenCalledWith({
      baseUrl: 'https://example.com/remote-guide',
      contentUrl: 'https://example.com/remote-guide/content.json',
      currentUrl: 'https://example.com/remote-guide/content.json',
      contentType: 'docs',
      metadata: content().metadata,
      guideTitle: 'My guide',
    });
  });
});

describe('FloatingPanelContent model forwarding', () => {
  it('forwards the model, active tab, surface, and content ref unchanged', () => {
    const model = panelModel();
    const tab = activeTab();

    render(
      <FloatingPanelContent
        content={content()}
        activeTab={tab}
        model={model}
        progressKey="guide-progress"
        onResetGuide={jest.fn()}
        surface="fullscreen"
      />
    );

    const linkHandlerInput = useLinkClickHandler.mock.calls[0][0];
    const toolbarProps = LearningJourneyMilestoneToolbar.mock.calls[0][0];

    expect(linkHandlerInput).toEqual(expect.objectContaining({ model, activeTab: tab }));
    expect(toolbarProps).toEqual(expect.objectContaining({ panel: model, activeTab: tab, surface: 'fullscreen' }));
    expect(toolbarProps.contentRoot).toBe(linkHandlerInput.contentRef);
  });
});
