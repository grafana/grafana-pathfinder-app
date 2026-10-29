jest.mock('../../utils/openfeature', () => ({ useBooleanFlag: () => true }));
/**
 * Surface-level completion-emission test for FloatingPanelContent, the content
 * owner shared by BOTH the floating and full-screen surfaces (FloatingPanelManager
 * and FullScreenPanel each render through it without wiring emission themselves).
 * Completing a guide in either surface must route through the shared, surface-neutral
 * emitter — see `surface-emission-owner`.
 */

// Mock @grafana/runtime before imports that trigger user-storage.ts module loading
jest.mock('@grafana/runtime', () => ({
  usePluginUserStorage: jest.fn(),
  getAppEvents: jest.fn(() => ({ publish: jest.fn() })),
}));

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { DocsPanelModelOperations } from '../docs-panel/types';
import { FloatingPanelContent } from './FloatingPanelContent';

jest.mock('../../docs-retrieval', () => ({
  resolveActiveMilestoneSequence: jest.requireActual('../../docs-retrieval/active-milestone-sequence')
    .resolveActiveMilestoneSequence,
  isJourneyCoverPage: () => false,
}));

const mockRenderedCompletions: unknown[] = [];
const mockRenderedSequences: unknown[] = [];
const mockRenderedCompletionFlags: boolean[] = [];
let mockContinueToNextMilestone: (() => Promise<void> | void) | undefined;
jest.mock('../content-renderer/content-renderer', () => ({
  ContentRenderer: ({
    completion,
    onActiveTrackChange,
    initialActiveTrackId,
    completionSequence,
    completionPanelEnabled,
    onContinueToNextMilestone,
  }: {
    completion: unknown;
    completionSequence?: unknown;
    completionPanelEnabled?: boolean;
    onContinueToNextMilestone?: () => Promise<void> | void;
    onActiveTrackChange?: (trackId: string | null, milestones: unknown) => void;
    initialActiveTrackId?: string | null;
  }) => {
    mockRenderedCompletions.push(completion);
    mockRenderedSequences.push(completionSequence);
    mockRenderedCompletionFlags.push(completionPanelEnabled ?? false);
    mockContinueToNextMilestone = onContinueToNextMilestone;
    return (
      <>
        <div data-testid="initial-active-track-id">{initialActiveTrackId ?? ''}</div>
        <button onClick={() => onActiveTrackChange?.('builder', [])}>Select builder track</button>
      </>
    );
  },
}));

jest.mock('../../hooks', () => ({
  usePublishSurfaceContentKey: jest.fn(),
}));

jest.mock('../docs-panel/link-handler.hook', () => ({
  useLinkClickHandler: jest.fn(),
}));

jest.mock('../docs-panel/components', () => ({
  AlignmentPrompt: () => null,
  GuideVersionNotice: () => null,
  LearningJourneyMilestoneToolbar: jest.fn(() => null),
}));

jest.mock('../InteractiveLearningBanner', () => ({
  InteractiveLearningBanner: () => null,
}));

jest.mock('../../global-state/completion-store', () => ({
  peekGuidePercentage: () => 0,
  subscribeProgress: () => () => undefined,
}));

let mockGuideIndex: Record<string, any> | null = null;
let publicationListener: (() => void) | undefined;
let publicationRevision = 0;
jest.mock('../../global-state/active-guide-index', () => ({
  getGuideIndex: (_key: string) => mockGuideIndex,
  subscribeGuideIndexPublications: (listener: () => void) => {
    publicationListener = listener;
    return () => {
      publicationListener = undefined;
    };
  },
  getGuideIndexPublicationRevision: () => publicationRevision,
  subscribeGuideIndexEvictions: () => () => undefined,
  getGuideIndexEvictionRevision: () => 0,
}));

jest.mock('../../global-state/guide-content-key', () => ({
  resolveGuideContentKey: (url: string | undefined) => url ?? 'default',
}));

jest.mock('@grafana/ui', () => ({
  useStyles2: () => ({}),
  useTheme2: () => ({}),
}));

const { useLinkClickHandler } = jest.requireMock('../docs-panel/link-handler.hook');
const { LearningJourneyMilestoneToolbar } = jest.requireMock('../docs-panel/components');
const { usePublishSurfaceContentKey } = jest.requireMock('../../hooks');

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
  mockRenderedCompletions.length = 0;
  mockRenderedSequences.length = 0;
  mockRenderedCompletionFlags.length = 0;
  mockContinueToNextMilestone = undefined;
  useLinkClickHandler.mockClear();
  LearningJourneyMilestoneToolbar.mockClear();
  mockGuideIndex = null;
  publicationListener = undefined;
  publicationRevision = 0;
  usePublishSurfaceContentKey.mockClear();
});

describe('FloatingPanelContent content key publication', () => {
  it("publishes the active tab's currentUrl", () => {
    render(<FloatingPanelContent content={content()} activeTab={activeTab()} model={panelModel()} />);

    expect(usePublishSurfaceContentKey).toHaveBeenLastCalledWith('https://example.com/remote-guide/content.json');
  });

  it('falls back to baseUrl when the tab has no currentUrl', () => {
    render(<FloatingPanelContent content={content()} activeTab={activeTab({ currentUrl: '' })} model={panelModel()} />);

    expect(usePublishSurfaceContentKey).toHaveBeenLastCalledWith('https://example.com/remote-guide');
  });

  it('publishes nothing when no content is loaded', () => {
    render(<FloatingPanelContent content={null} activeTab={activeTab()} model={panelModel()} />);

    expect(usePublishSurfaceContentKey).toHaveBeenLastCalledWith(undefined);
  });
});

describe('FloatingPanelContent completion emission', () => {
  it('hands the renderer its view-level identity for the shared surface-neutral emitter', () => {
    render(<FloatingPanelContent content={content()} activeTab={activeTab()} model={panelModel()} />);

    expect(mockRenderedCompletions.at(-1)).toEqual({
      kind: 'tracked',
      input: {
        baseUrl: 'https://example.com/remote-guide',
        contentUrl: 'https://example.com/remote-guide/content.json',
        currentUrl: 'https://example.com/remote-guide/content.json',
        contentType: 'docs',
        metadata: content().metadata,
        guideTitle: 'My guide',
      },
      onComplete: undefined,
    });
  });

  it('passes its onGuideComplete callback to run after the completion is recorded', () => {
    const onGuideComplete = jest.fn();
    render(
      <FloatingPanelContent
        content={content()}
        activeTab={activeTab()}
        model={panelModel()}
        onGuideComplete={onGuideComplete}
      />
    );

    expect(mockRenderedCompletions.at(-1)).toEqual(
      expect.objectContaining({ kind: 'tracked', onComplete: onGuideComplete })
    );
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

describe('FloatingPanelContent completion navigation', () => {
  const milestones = [
    { number: 1, title: 'First track guide', url: 'https://example.com/track/first', isActive: true },
    { number: 2, title: 'Next track guide', url: 'https://example.com/track/next', isActive: false },
  ];

  function renderTrack(canNavigate = true, trackOnly = false) {
    const guide: any = {
      url: milestones[0]!.url,
      type: 'learning-journey',
      content: '',
      lastFetched: '',
      metadata: {
        trackMemberBaseUrl: 'app-platform:private-path',
        learningJourney: {
          baseUrl: 'app-platform:private-path',
          currentMilestone: 3,
          totalMilestones: 3,
          milestones: [{ number: 3, title: 'Base guide', url: milestones[0]!.url, isActive: true }],
        },
      },
    };
    if (trackOnly) {
      delete guide.metadata.learningJourney;
    }
    const tab: any = {
      id: 'tab-1',
      title: 'Track guide',
      type: 'learning-journey',
      baseUrl: guide.url,
      currentUrl: guide.url,
      content: guide,
      isLoading: false,
      activeTrackId: 'builder',
      activeTrackMilestones: milestones,
    };
    const model = panelModel();
    (model.canNavigateNext as jest.Mock).mockReturnValue(canNavigate);
    const navigation = Promise.resolve();
    (model.navigateToNextMilestone as jest.Mock).mockReturnValue(navigation);
    render(<FloatingPanelContent content={guide} activeTab={tab} model={model} />);
    return { model, navigation };
  }

  it('uses the active track rather than the base path and retains its private path identity', () => {
    renderTrack();
    expect(mockRenderedSequences.at(-1)).toEqual({
      currentMilestone: 1,
      milestones,
      baseUrl: 'app-platform:private-path',
    });
  });

  it('retains the owning path context for a track-only guide with no learning journey metadata', () => {
    renderTrack(true, true);
    expect(mockRenderedSequences.at(-1)).toEqual({
      currentMilestone: 1,
      milestones,
      baseUrl: 'app-platform:private-path',
    });
  });

  it('always enables the completion panel in the reader', () => {
    renderTrack();
    expect(mockRenderedCompletionFlags.at(-1)).toBe(true);
    expect(mockRenderedSequences.at(-1)).toBeDefined();
  });

  it('retains navigation promises and requests real load failures', () => {
    const { model, navigation } = renderTrack();
    expect(mockContinueToNextMilestone?.()).toBe(navigation);
    expect(model.navigateToNextMilestone).toHaveBeenCalledTimes(1);
    expect(jest.mocked(model.navigateToNextMilestone).mock.calls[0]).toEqual([{ rejectOnError: true }]);
  });

  it('does not offer continuation when the model cannot navigate', () => {
    const { model } = renderTrack(false);
    expect(mockContinueToNextMilestone).toBeUndefined();
    expect(model.navigateToNextMilestone).not.toHaveBeenCalled();
  });
});

/**
 * Regression test for PR #1973, Bug 2: floating and full-screen bars can stay absent.
 *
 * Before the fix, FloatingPanelContent decided whether to mount the bar by
 * synchronously reading getGuideIndex(getContentKey()), but the index is only
 * published by a later passive effect in ContentRenderer. On a cold floating
 * or full-screen open, the first render saw no index and omitted the bar, and
 * nothing re-rendered when the index published — so the bar stayed missing
 * until an unrelated render.
 *
 * The fix makes visibility reactive to index publication via useSyncExternalStore.
 */
describe('FloatingPanelContent progress bar visibility (cold open)', () => {
  it('shows the progress bar after index is published, even on first mount', async () => {
    // Initial render: no index published yet (cold open)
    mockGuideIndex = null;

    render(<FloatingPanelContent content={content()} activeTab={activeTab()} model={panelModel()} />);

    await act(async () => {});
    expect(screen.queryByTestId('guide-progress-bar')).not.toBeInTheDocument();

    // Simulate ContentRenderer publishing the index in its passive effect
    mockGuideIndex = { contentKey: 'guide-key', index: {}, denominatorSource: 'live-pre-inlining' };

    // Notify publication subscribers (triggers re-render)
    act(() => {
      publicationRevision += 1; // Increment first (mimic real notifyPublished)
      publicationListener?.();
    });

    // Bar should now appear because the index is published
    expect(screen.getByTestId('guide-progress-bar')).toBeInTheDocument();
    expect(screen.getByTestId('guide-progress-bar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('hides the progress bar when index is absent (no guide)', () => {
    // No index published
    mockGuideIndex = null;

    render(<FloatingPanelContent content={content()} activeTab={activeTab()} model={panelModel()} />);

    // Bar should be absent
    expect(screen.queryByTestId('guide-progress-bar')).not.toBeInTheDocument();
  });
});
