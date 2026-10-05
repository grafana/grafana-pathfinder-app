/**
 * Tests for DocsPanelContentArea.
 *
 * Focused on the "Return to my learning" footer button, which must switch the
 * panel back to the recommendations tab in place (issue #1051) rather than
 * navigating away from the Grafana UI.
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { config } from '@grafana/runtime';
import { resetGuideVersionImpressions } from './GuideVersionNotice';
import { testIds } from '../../../constants/testIds';
import { DocsPanelContentArea, type DocsPanelContentAreaProps } from './DocsPanelContentArea';

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    vars ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(vars[name] ?? '')) : fallback,
}));

jest.mock('@grafana/data', () => ({
  ...jest.requireActual('@grafana/data'),
  usePluginContext: () => ({ meta: { jsonData: {} } }),
}));

jest.mock('../../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  getContentTypeForAnalytics: jest.fn(() => 'docs'),
  UserInteraction: {
    GuideVersionUnsupportedShown: 'guide_version_unsupported_shown',
    DocsPanelInteraction: 'docs_panel_interaction',
    OpenExtraResource: 'open_extra_resource',
  },
}));

jest.mock('../../../docs-retrieval', () => ({
  recordGuideCompletionForSurface: jest.fn(),
  journeyProgressFromMilestones: jest.fn(() => 0),
  // Pure logic, no `@grafana/runtime`/storage imports — see
  // `active-milestone-sequence.ts`'s own doc comment.
  resolveActiveMilestoneToolbarContext: jest.requireActual('../../../docs-retrieval/active-milestone-sequence')
    .resolveActiveMilestoneToolbarContext,
}));

// Heavy leaf children are irrelevant to these tests — stub them out so the
// branch renders without their dependency trees. ContentRenderer exposes a
// button that fires onGuideComplete so the completion-boundary tests can drive it.
jest.mock('../../content-renderer/content-renderer', () => ({
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
// Renders a real button wired to the received onOpenDocsPage so the
// devtools-cover-open explicitGuideId derivation (DocsPanelContentArea's own
// wrapper) can be exercised, not just rendered as a no-op.
jest.mock('../../SelectorDebugPanel', () => ({
  SelectorDebugPanel: ({
    onOpenDocsPage,
  }: {
    onOpenDocsPage: (url: string, title: string, packageInfo?: any) => void;
  }) => (
    <button
      data-testid="devtools-open-docs-page"
      onClick={() =>
        onOpenDocsPage('bundled:the-path/content.json', 'The Path', { packageManifest: { id: 'the-path' } })
      }
    >
      Open
    </button>
  ),
}));
jest.mock('./LearningJourneyMilestoneToolbar', () => ({ LearningJourneyMilestoneToolbar: () => null }));
jest.mock('./PanelModeActionButtons', () => ({ PanelModeActionButtons: () => null }));

const { reportAppInteraction } = jest.requireMock('../../../lib/analytics');
const { recordGuideCompletionForSurface, journeyProgressFromMilestones } = jest.requireMock('../../../docs-retrieval');

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
      canNavigateNext: jest.fn(() => false),
      navigateToNextMilestone: jest.fn(),
      setActiveTrackId: jest.fn(),
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
  it('uses the stable reset selector for docs-like guides', () => {
    const base = makeProps();
    render(
      <DocsPanelContentArea
        {...makeProps({
          activeTab: { ...base.activeTab, type: 'interactive' } as any,
          hasInteractiveProgress: true,
          progressKey: 'bundled:e2e-test',
        })}
      />
    );

    expect(screen.getByTestId(testIds.docsPanel.resetGuideButton)).toHaveAccessibleName('Reset guide');
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

  describe('active track tab restore across cover-page remounts', () => {
    // Role-style trackIds (`builder`, `seller`) are commonly reused across
    // unrelated paths, and every navigation remounts the cover's
    // LearningPathTableOfContents with no path identity of its own — so a
    // stored activeTrackId must only be restored when it was recorded for
    // THIS path's cover, never a different one that happens to declare a
    // same-named track.
    it("records the selecting cover page's own manifest id alongside the trackId", () => {
      const base = makeProps();
      const props = makeProps({
        stableContent: {
          url: base.activeTab!.baseUrl,
          type: 'learning-journey',
          content: '',
          metadata: { packageManifest: { id: 'path-a' }, learningJourney: { totalMilestones: 2 } },
        } as any,
      });

      render(<DocsPanelContentArea {...props} />);
      fireEvent.click(screen.getByRole('button', { name: 'Select builder track' }));

      expect(props.model.setActiveTrackId).toHaveBeenCalledWith(props.activeTab!.id, 'builder', [], 'path-a');
    });

    it('restores initialActiveTrackId when the stored selection matches the current cover manifest id', () => {
      const base = makeProps();
      const props = makeProps({
        activeTab: {
          ...base.activeTab,
          activeTrackId: 'builder',
          activeTrackPathId: 'path-a',
        } as any,
        stableContent: {
          url: base.activeTab!.baseUrl,
          type: 'learning-journey',
          content: '',
          metadata: { packageManifest: { id: 'path-a' }, learningJourney: { totalMilestones: 2 } },
        } as any,
      });

      render(<DocsPanelContentArea {...props} />);

      expect(screen.getByTestId('initial-active-track-id')).toHaveTextContent('builder');
    });

    it('withholds initialActiveTrackId when the stored selection was recorded for a different path', () => {
      const base = makeProps();
      const props = makeProps({
        activeTab: {
          ...base.activeTab,
          activeTrackId: 'builder',
          activeTrackPathId: 'path-a',
        } as any,
        stableContent: {
          url: base.activeTab!.baseUrl,
          type: 'learning-journey',
          content: '',
          // Path B, which happens to declare a same-named "builder" track.
          metadata: { packageManifest: { id: 'path-b' }, learningJourney: { totalMilestones: 2 } },
        } as any,
      });

      render(<DocsPanelContentArea {...props} />);

      expect(screen.getByTestId('initial-active-track-id')).toHaveTextContent('');
    });

    // learningJourney.baseUrl is a resolved fetch URL, not a stable path
    // identity — a raw/PR-tester cover URL and the resolver's canonical URL
    // for the same manifest id are legitimately different strings, and
    // returning via Previous fetches the canonical one. The restore must
    // survive that.
    it('restores initialActiveTrackId when the manifest id matches even though learningJourney.baseUrl differs (raw vs canonical cover URL)', () => {
      const base = makeProps();
      const props = makeProps({
        activeTab: {
          ...base.activeTab,
          activeTrackId: 'builder',
          activeTrackPathId: 'path-a',
        } as any,
        stableContent: {
          url: base.activeTab!.baseUrl,
          type: 'learning-journey',
          content: '',
          metadata: {
            packageManifest: { id: 'path-a' },
            // Same path, but reached this time via its canonical resolved
            // URL rather than the raw URL the original cover load used.
            learningJourney: { baseUrl: 'https://cdn.example.com/canonical/path-a/', totalMilestones: 2 },
          },
        } as any,
      });

      render(<DocsPanelContentArea {...props} />);

      expect(screen.getByTestId('initial-active-track-id')).toHaveTextContent('builder');
    });
  });

  describe('loading-state milestone bar', () => {
    // Decision 4 (docs/design/COMPLETION-MODEL.md): the bar shown while a
    // journey tab is loading must use the shared calculation — earned
    // progress, not currentMilestone/totalMilestones navigation position —
    // so a reader never sees two different numbers for the same journey on
    // adjacent screens.
    it('sizes the fill from the shared journeyProgressFromMilestones calculation', () => {
      journeyProgressFromMilestones.mockReturnValue(31);
      const base = makeProps();
      const lj = { baseUrl: 'backend-guide:path', totalMilestones: 4, currentMilestone: 2, milestones: [] };
      const props = makeProps({
        activeTab: {
          ...base.activeTab,
          type: 'learning-journey',
          isLoading: true,
          content: {
            url: base.activeTab!.baseUrl,
            type: 'learning-journey',
            content: '',
            metadata: { learningJourney: lj },
          },
        } as any,
      });

      const { container } = render(<DocsPanelContentArea {...props} />);

      expect(journeyProgressFromMilestones).toHaveBeenCalledWith(lj.baseUrl, lj.milestones);
      const fill = container.querySelector('.progressFill') as HTMLElement;
      expect(fill.style.width).toBe('31%');
    });

    // The bar reads storage during render, so it goes stale once mounted
    // unless the component re-renders on the completion store's own
    // announcement — the same revision seam useLearningPaths and the
    // milestone toolbar already subscribe to (round 5). Without that
    // subscription here, this test fails: the fill stays at 10%.
    it('follows new evidence without an unrelated prop change forcing the re-render', () => {
      journeyProgressFromMilestones.mockReturnValue(10);
      const base = makeProps();
      const lj = { baseUrl: 'backend-guide:path', totalMilestones: 4, currentMilestone: 2, milestones: [] };
      const props = makeProps({
        activeTab: {
          ...base.activeTab,
          type: 'learning-journey',
          isLoading: true,
          content: {
            url: base.activeTab!.baseUrl,
            type: 'learning-journey',
            content: '',
            metadata: { learningJourney: lj },
          },
        } as any,
      });

      const { container } = render(<DocsPanelContentArea {...props} />);
      const fill = container.querySelector('.progressFill') as HTMLElement;
      expect(fill.style.width).toBe('10%');

      journeyProgressFromMilestones.mockReturnValue(30);
      act(() => {
        window.dispatchEvent(
          new CustomEvent('pathfinder:progress', {
            detail: { kind: 'guide', contentKey: 'irrelevant', percentage: 30, hasProgress: true },
          })
        );
      });

      expect(fill.style.width).toBe('30%');
    });
  });

  // A track-only guide (present in a manifest `tracks[].guides` entry, not
  // in the path's base `milestones`) carries no `learningJourney` at all
  // (COMPLETION-MODEL.md decision 10). Both the legacy meta row and the
  // loading-state bar used to gate on that field alone, so a track-only
  // guide got the meta row AND (once LearningJourneyMilestoneToolbar's own
  // fix landed) the real toolbar at the same time, and no bar while
  // loading. Both gates now share `resolveActiveMilestoneToolbarContext`
  // with the toolbar so exactly one ever shows.
  describe('track-only and dual-membership guide chrome', () => {
    const trackMilestones = [
      { number: 1, title: 't1', url: 'https://example.com/track/t1', isActive: true },
      { number: 2, title: 't2', url: 'https://example.com/track/t2', isActive: false },
    ];

    it('suppresses the legacy meta row for a track-only guide (the toolbar takes over instead)', () => {
      const base = makeProps();
      const props = makeProps({
        activeTab: {
          ...base.activeTab,
          type: 'learning-journey',
          isLoading: false,
          activeTrackId: 'builder',
          activeTrackMilestones: trackMilestones,
          currentUrl: 'https://example.com/track/t1',
          content: {
            url: 'https://example.com/track/t1',
            type: 'learning-journey',
            content: '',
            metadata: { trackMemberBaseUrl: 'https://example.com/path' },
          },
        } as any,
      });

      render(<DocsPanelContentArea {...props} />);

      expect(screen.queryByText('Interactive journey')).not.toBeInTheDocument();
      expect(screen.queryByText(/\d+ milestones$/)).not.toBeInTheDocument();
    });

    it('shows the legacy meta row when a guide has neither learningJourney nor track membership', () => {
      const base = makeProps();
      const props = makeProps({
        activeTab: {
          ...base.activeTab,
          type: 'learning-journey',
          isLoading: false,
          content: { url: base.activeTab!.baseUrl, type: 'learning-journey', content: '', metadata: {} },
        } as any,
      });

      render(<DocsPanelContentArea {...props} />);

      expect(screen.getByText('Interactive journey')).toBeInTheDocument();
    });

    it('shows the loading bar scoped to the track for a track-only guide', () => {
      const base = makeProps();
      const props = makeProps({
        activeTab: {
          ...base.activeTab,
          type: 'learning-journey',
          isLoading: true,
          activeTrackId: 'builder',
          activeTrackMilestones: trackMilestones,
          currentUrl: 'https://example.com/track/t1',
          content: {
            url: 'https://example.com/track/t1',
            type: 'learning-journey',
            content: '',
            metadata: { trackMemberBaseUrl: 'https://example.com/path' },
          },
        } as any,
      });

      render(<DocsPanelContentArea {...props} />);

      expect(screen.getByText('Milestone 1 of 2')).toBeInTheDocument();
      expect(journeyProgressFromMilestones).toHaveBeenCalledWith(
        'https://example.com/path',
        expect.arrayContaining([expect.objectContaining({ number: 1 })])
      );
    });

    it('does not show the loading bar when a guide has neither learningJourney nor track membership', () => {
      const base = makeProps();
      const props = makeProps({
        activeTab: {
          ...base.activeTab,
          type: 'learning-journey',
          isLoading: true,
          content: { url: base.activeTab!.baseUrl, type: 'learning-journey', content: '', metadata: {} },
        } as any,
      });

      const { container } = render(<DocsPanelContentArea {...props} />);

      expect(container.querySelector('.progressFill')).not.toBeInTheDocument();
    });

    it('scopes the loading bar to the active track for a dual-membership guide, not the base sequence', () => {
      const base = makeProps();
      const lj = {
        baseUrl: 'https://example.com/path-canonical',
        totalMilestones: 5,
        currentMilestone: 1,
        milestones: [],
      };
      const props = makeProps({
        activeTab: {
          ...base.activeTab,
          type: 'learning-journey',
          isLoading: true,
          activeTrackId: 'builder',
          activeTrackMilestones: [
            { number: 1, title: 'b1', url: 'https://other.example.com/x', isActive: false },
            { number: 2, title: 'b2', url: 'https://example.com/guide-m1', isActive: true },
          ],
          currentUrl: 'https://example.com/guide-m1',
          content: {
            url: 'https://example.com/guide-m1',
            type: 'learning-journey',
            content: '',
            metadata: { learningJourney: lj },
          },
        } as any,
      });

      render(<DocsPanelContentArea {...props} />);

      // The base learningJourney says 1 of 5 — the active track (2 of 2) must win.
      expect(screen.getByText('Milestone 2 of 2')).toBeInTheDocument();
      expect(screen.queryByText('Milestone 1 of 5')).not.toBeInTheDocument();
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

    // PrTester/UrlTester's devtools cover-open wrapper derives
    // explicitGuideId from packageInfo.packageManifest.id so a raw PR URL
    // differing from the resolver's published one is never misread as
    // track membership. Pins that derivation at its actual call site, not
    // just inside fetchPackageContent's own unit tests.
    it("passes the package manifest's own id as explicitGuideId when opening a devtools cover", () => {
      const openDocsPage = jest.fn();
      render(
        <DocsPanelContentArea
          {...makeProps({
            activeTab: devToolsTab,
            stableContent: null,
            isDevMode: true,
            model: { openDocsPage } as any,
          })}
        />
      );

      fireEvent.click(screen.getByTestId('devtools-open-docs-page'));

      expect(openDocsPage).toHaveBeenCalledWith(
        'bundled:the-path/content.json',
        'The Path',
        expect.objectContaining({ explicitGuideId: 'the-path' })
      );
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

describe('DocsPanelContentArea — guide version notice', () => {
  // Assign onto the real config rather than mocking '@grafana/runtime': this
  // suite reaches the module transitively and a partial mock would blank the
  // rest of it.
  const originalVersion = config.buildInfo?.version;

  beforeEach(() => {
    config.buildInfo.version = '13.1.0';
    resetGuideVersionImpressions();
    jest.clearAllMocks();
  });

  afterAll(() => {
    config.buildInfo.version = originalVersion;
  });

  it('renders no notice for a guide with no manifest', () => {
    render(<DocsPanelContentArea {...makeProps()} />);

    expect(screen.queryByTestId(testIds.guideVersionNotice.container)).not.toBeInTheDocument();
  });

  it('renders the notice when the content manifest declares a floor above the running Grafana', () => {
    const props = makeProps();
    props.stableContent!.metadata.packageManifest = { minGrafanaVersion: '13.2.0' };

    render(<DocsPanelContentArea {...props} />);

    expect(screen.getByTestId(testIds.guideVersionNotice.container)).toBeInTheDocument();
  });
});

describe('guide warning impression lifecycle', () => {
  beforeEach(() => {
    config.buildInfo.version = '13.1.0';
    resetGuideVersionImpressions();
    jest.clearAllMocks();
  });

  it('deduplicates milestone navigation, reload and progress reset for the same guide', () => {
    const props = makeProps();
    props.stableContent!.metadata.packageManifest = { minGrafanaVersion: '13.2.0' };
    const view = render(<DocsPanelContentArea {...props} />);
    view.rerender(
      <DocsPanelContentArea
        {...props}
        activeTab={{ ...props.activeTab!, currentUrl: 'https://example.com/guide/step-2' }}
      />
    );
    view.rerender(<DocsPanelContentArea {...props} activeTab={{ ...props.activeTab!, isLoading: true }} />);
    view.rerender(<DocsPanelContentArea {...props} hasInteractiveProgress={false} />);
    expect(
      reportAppInteraction.mock.calls.filter(([event]: [string]) => event === 'guide_version_unsupported_shown')
    ).toHaveLength(1);
  });

  it('does not count a loaded guide while recommendations are active', () => {
    const props = makeProps();
    props.stableContent!.metadata.packageManifest = { minGrafanaVersion: '13.2.0' };
    const view = render(<DocsPanelContentArea {...props} isRecommendationsTab />);
    expect(reportAppInteraction).not.toHaveBeenCalled();
    view.rerender(<DocsPanelContentArea {...props} />);
    expect(reportAppInteraction).toHaveBeenCalledWith(
      'guide_version_unsupported_shown',
      expect.objectContaining({ guide_url: props.activeTab!.baseUrl })
    );
  });
});
