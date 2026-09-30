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
  ContentRenderer: ({
    onGuideComplete,
    onActiveTrackChange,
    initialActiveTrackId,
  }: {
    onGuideComplete?: () => void;
    onActiveTrackChange?: (trackId: string | null, milestones: unknown) => void;
    initialActiveTrackId?: string | null;
  }) => (
    <>
      <button onClick={onGuideComplete}>Complete rendered guide</button>
      <div data-testid="initial-active-track-id">{initialActiveTrackId ?? ''}</div>
      <button onClick={() => onActiveTrackChange?.('builder', [])}>Select builder track</button>
    </>
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
    setActiveTrackId: jest.fn(),
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

// This ContentRenderer also remounts on every content URL change (its own
// `key={content.url}`), so it needs the same initialActiveTrackId restore
// path the sidebar surface has, gated on the same activeTrackPathId match
// (see the sibling test group in DocsPanelContentArea.test.tsx for the
// leftover-across-paths rationale).
describe('FloatingPanelContent active track tab restore', () => {
  it("records the selecting cover page's own manifest id alongside the trackId", () => {
    const model = panelModel();
    render(
      <FloatingPanelContent
        content={content({ type: 'learning-journey', metadata: { packageManifest: { id: 'path-a' } } })}
        activeTab={activeTab()}
        model={model}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select builder track' }));

    expect(model.setActiveTrackId).toHaveBeenCalledWith('tab-1', 'builder', [], 'path-a');
  });

  it('restores initialActiveTrackId when the stored selection matches the current cover manifest id', () => {
    render(
      <FloatingPanelContent
        content={content({ type: 'learning-journey', metadata: { packageManifest: { id: 'path-a' } } })}
        activeTab={activeTab({ activeTrackId: 'builder', activeTrackPathId: 'path-a' })}
        model={panelModel()}
      />
    );

    expect(screen.getByTestId('initial-active-track-id')).toHaveTextContent('builder');
  });

  it('withholds initialActiveTrackId when the stored selection was recorded for a different path', () => {
    render(
      <FloatingPanelContent
        // Path B, which happens to declare a same-named "builder" track.
        content={content({ type: 'learning-journey', metadata: { packageManifest: { id: 'path-b' } } })}
        activeTab={activeTab({ activeTrackId: 'builder', activeTrackPathId: 'path-a' })}
        model={panelModel()}
      />
    );

    expect(screen.getByTestId('initial-active-track-id')).toHaveTextContent('');
  });

  // learningJourney.baseUrl is a resolved fetch URL, not a stable path
  // identity — a raw/PR-tester cover URL and the resolver's canonical URL
  // for the SAME manifest id are legitimately different strings, and
  // returning via Previous fetches the canonical one. The restore must
  // survive that.
  it('restores initialActiveTrackId when the manifest id matches even though learningJourney.baseUrl differs (raw vs canonical cover URL)', () => {
    render(
      <FloatingPanelContent
        content={content({
          type: 'learning-journey',
          metadata: {
            packageManifest: { id: 'path-a' },
            learningJourney: { baseUrl: 'https://cdn.example.com/canonical/path-a/' },
          },
        })}
        activeTab={activeTab({ activeTrackId: 'builder', activeTrackPathId: 'path-a' })}
        model={panelModel()}
      />
    );

    expect(screen.getByTestId('initial-active-track-id')).toHaveTextContent('builder');
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
  });
});
