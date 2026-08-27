/**
 * Tests for the pending-guide routing helper that the floating and
 * fullscreen surfaces share.
 *
 * The branch order is load-bearing — see `openPendingGuide`'s docstring —
 * so each branch is exercised against a mock panel to make sure the right
 * open method is called with the right args. Drift in this routing has
 * produced real bugs (e.g. one consumer used to forget to forward
 * `packageInfo`, breaking the milestone toolbar for synthetic PR-tester
 * journeys whose URL is a raw GitHub URL).
 */

import { consumePendingGuideOnMount, initializePanelTabsOnMount, openPendingGuide } from './pendingGuideRouter';
import type { CombinedLearningJourneyPanel } from './docs-panel';
import { panelModeManager, type PendingGuide } from '../../global-state/panel-mode';
import type { RawContent } from '../../types/content.types';

function makePanel(state: { tabs: Array<{ id: string }>; activeTabId: string } = { tabs: [], activeTabId: '' }) {
  return {
    state,
    setActiveTab: jest.fn(),
    openEditorTab: jest.fn(),
    openLearningJourney: jest.fn(),
    openDocsPage: jest.fn(),
    restoreTabsAsync: jest.fn().mockResolvedValue(undefined),
  };
}

function asPanel(panel: ReturnType<typeof makePanel>): CombinedLearningJourneyPanel {
  // The real panel is a Scenes object with many other methods we don't
  // exercise here; cast the minimal shape so we can assert call arguments.
  return panel as unknown as CombinedLearningJourneyPanel;
}

describe('openPendingGuide', () => {
  // The receiving surface restores the whole strip before applying the
  // handoff, so the guide being handed off is already a tab. Every open
  // method below mints a fresh id and appends, so without the tabId guard a
  // sidebar → fullscreen switch shows the guide twice and persists the
  // duplicate back into the shared workspace.
  it('focuses the restored tab named by tabId instead of opening a duplicate', () => {
    const panel = makePanel({ tabs: [{ id: 'recommendations' }, { id: 'tab-a' }], activeTabId: 'recommendations' });
    const pending: PendingGuide = {
      url: 'https://grafana.com/docs/learning-journeys/foo/milestone-2',
      title: 'Foo',
      type: 'learning-journey',
      tabId: 'tab-a',
    };

    openPendingGuide(asPanel(panel), pending, 'fullscreen_handoff');

    expect(panel.setActiveTab).toHaveBeenCalledWith('tab-a');
    expect(panel.openLearningJourney).not.toHaveBeenCalled();
    expect(panel.openDocsPage).not.toHaveBeenCalled();
  });

  it('leaves an already-active restored tab alone so its in-flight load is not duplicated', () => {
    const panel = makePanel({ tabs: [{ id: 'tab-a' }], activeTabId: 'tab-a' });
    const pending: PendingGuide = { url: 'bundled:foo', title: 'Foo', type: 'docs', tabId: 'tab-a' };

    openPendingGuide(asPanel(panel), pending, 'fullscreen_handoff');

    expect(panel.setActiveTab).not.toHaveBeenCalled();
    expect(panel.openDocsPage).not.toHaveBeenCalled();
  });

  it('opens normally when tabId names a tab this surface does not have', () => {
    // Mounted-surface swaps (the fullscreen `pathfinder-request-full-screen`
    // handler) route without restoring, so the handoff target can be absent.
    const panel = makePanel({ tabs: [{ id: 'recommendations' }], activeTabId: 'recommendations' });
    const pending: PendingGuide = { url: 'bundled:foo', title: 'Foo', type: 'docs', tabId: 'tab-gone' };

    openPendingGuide(asPanel(panel), pending, 'fullscreen_handoff');

    expect(panel.setActiveTab).not.toHaveBeenCalled();
    expect(panel.openDocsPage).toHaveBeenCalledWith(
      'bundled:foo',
      'Foo',
      expect.objectContaining({ source: 'fullscreen_handoff' })
    );
  });

  it('routes editor handoffs to openEditorTab and ignores any URL/packageInfo', () => {
    const panel = makePanel();
    const pending: PendingGuide = { type: 'editor', title: 'Guide editor' };

    openPendingGuide(asPanel(panel), pending, 'fullscreen_handoff');

    expect(panel.openEditorTab).toHaveBeenCalledTimes(1);
    expect(panel.openLearningJourney).not.toHaveBeenCalled();
    expect(panel.openDocsPage).not.toHaveBeenCalled();
  });

  it('does nothing when the pending guide has no URL and is not an editor handoff', () => {
    const panel = makePanel();
    const pending: PendingGuide = { title: 'Untitled', type: 'learning-journey' };

    openPendingGuide(asPanel(panel), pending, 'fullscreen_handoff');

    expect(panel.openEditorTab).not.toHaveBeenCalled();
    expect(panel.openLearningJourney).not.toHaveBeenCalled();
    expect(panel.openDocsPage).not.toHaveBeenCalled();
  });

  it('routes through openDocsPage WITH packageInfo when synthetic packageInfo is present (PR-tester journeys)', () => {
    const panel = makePanel();
    const packageInfo = {
      packageId: 'my-path',
      packageManifest: { id: 'my-path', type: 'path' as const, milestones: ['m1'] },
      resolvedMilestones: [],
    };
    const pending: PendingGuide = {
      url: 'https://raw.githubusercontent.com/x/y/z/m1/content.json',
      title: 'PR journey',
      type: 'learning-journey',
      packageInfo,
    };

    openPendingGuide(asPanel(panel), pending, 'floating_panel_dock');

    // packageInfo branch wins over the learning-journey branch — that's how
    // the receiving surface rebuilds the milestone toolbar from the manifest.
    expect(panel.openDocsPage).toHaveBeenCalledWith(pending.url, pending.title, {
      source: 'floating_panel_dock',
      packageInfo,
    });
    expect(panel.openLearningJourney).not.toHaveBeenCalled();
  });

  it('routes through openLearningJourney for recognised journey URLs without packageInfo', () => {
    const panel = makePanel();
    const pending: PendingGuide = {
      url: 'https://grafana.com/docs/learning-journeys/foo',
      title: 'Foo',
      type: 'learning-journey',
    };

    openPendingGuide(asPanel(panel), pending, 'fullscreen_handoff');

    expect(panel.openLearningJourney).toHaveBeenCalledWith(pending.url, pending.title, {
      source: 'fullscreen_handoff',
    });
    expect(panel.openDocsPage).not.toHaveBeenCalled();
  });

  it('falls through to openDocsPage for plain docs / interactive tabs', () => {
    const panel = makePanel();
    const pending: PendingGuide = { url: 'bundled:foo', title: 'Bundled', type: 'docs' };

    openPendingGuide(asPanel(panel), pending, 'fullscreen_handoff');

    expect(panel.openDocsPage).toHaveBeenCalledWith(pending.url, pending.title, {
      source: 'fullscreen_handoff',
    });
    expect(panel.openLearningJourney).not.toHaveBeenCalled();
  });

  it('forwards the caller-supplied source so analytics stays correct (handoff vs dock)', () => {
    const panel = makePanel();
    const pending: PendingGuide = { url: 'bundled:foo', title: 'Foo', type: 'docs' };

    openPendingGuide(asPanel(panel), pending, 'floating_panel_dock');
    expect(panel.openDocsPage).toHaveBeenLastCalledWith(
      pending.url,
      pending.title,
      expect.objectContaining({ source: 'floating_panel_dock' })
    );

    openPendingGuide(asPanel(panel), pending, 'fullscreen_handoff');
    expect(panel.openDocsPage).toHaveBeenLastCalledWith(
      pending.url,
      pending.title,
      expect.objectContaining({ source: 'fullscreen_handoff' })
    );
  });
});

describe('initializePanelTabsOnMount', () => {
  afterEach(() => {
    panelModeManager.consumePendingGuide();
  });

  it('restores the full strip before opening the pending guide', async () => {
    // Reversing this order is what erased sibling tabs: the handoff tab made
    // the strip non-empty, restore was skipped, and the surface's next
    // `saveTabsToStorage()` persisted its one-tab model over the workspace.
    const order: string[] = [];
    const panel = makePanel();
    panel.restoreTabsAsync.mockImplementation(async () => {
      order.push('restore');
    });
    panel.openDocsPage.mockImplementation(() => order.push('open'));
    panelModeManager.setPendingGuide({ url: 'bundled:b', title: 'B', type: 'docs' });

    await expect(
      initializePanelTabsOnMount(asPanel(panel), 'fullscreen_handoff', () => order.push('in-flight'))
    ).resolves.toBe(true);

    expect(order).toEqual(['in-flight', 'restore', 'open']);
  });

  it('does not duplicate a handoff guide that restore just brought back', async () => {
    const panel = makePanel({ tabs: [{ id: 'recommendations' }], activeTabId: 'recommendations' });
    panel.restoreTabsAsync.mockImplementation(async () => {
      panel.state.tabs = [{ id: 'recommendations' }, { id: 'tab-a' }, { id: 'tab-b' }];
      panel.state.activeTabId = 'tab-a';
    });
    panelModeManager.setPendingGuide({ url: 'bundled:a', title: 'A', type: 'docs', tabId: 'tab-a' });

    await initializePanelTabsOnMount(asPanel(panel), 'fullscreen_handoff', jest.fn());

    expect(panel.openDocsPage).not.toHaveBeenCalled();
    expect(panel.state.tabs).toHaveLength(3);
  });

  it('restores without marking an open in-flight when nothing was handed off', async () => {
    const panel = makePanel();
    const markInFlight = jest.fn();

    await expect(initializePanelTabsOnMount(asPanel(panel), 'fullscreen_handoff', markInFlight)).resolves.toBe(false);

    expect(panel.restoreTabsAsync).toHaveBeenCalledTimes(1);
    expect(markInFlight).not.toHaveBeenCalled();
    expect(panel.openDocsPage).not.toHaveBeenCalled();
  });
});

describe('consumePendingGuideOnMount', () => {
  // State-level test of the occupied-sidebar launch: HomePanel sets a
  // prepared pending guide and flips to transient floating; the floating
  // surface must consume it on mount or the launch is silently dropped
  // (stale restored tabs, or the empty-state fallback bouncing back to
  // sidebar mode). Mounting FloatingPanelInner itself is not feasible in
  // Jest (Scenes + theme provider), so this exercises the shared consume
  // step against the real panelModeManager singleton.
  const preparedContent: RawContent = {
    content: '{"id":"g","title":"g","blocks":[]}',
    metadata: { title: 'g' },
    type: 'interactive',
    url: 'bundled:first-dashboard',
    lastFetched: '2026-07-28T00:00:00.000Z',
  };

  afterEach(() => {
    // Drain any pending guide a test left behind (consume-once slot).
    panelModeManager.consumePendingGuide();
  });

  it('consumes the prepared guide exactly once, marking in-flight BEFORE routing', () => {
    const order: string[] = [];
    const panel = makePanel();
    panel.openDocsPage.mockImplementation(() => order.push('open'));
    const markInFlight = jest.fn(() => order.push('in-flight'));

    panelModeManager.setPendingGuide({
      url: 'bundled:first-dashboard',
      title: 'Create your first dashboard',
      type: 'docs',
      preparedContent,
      source: 'home_page',
    });

    expect(consumePendingGuideOnMount(asPanel(panel), 'floating_panel_dock', markInFlight)).toBe(true);

    // The original launch source wins over the surface's fallback so the
    // starting-location alignment check behaves the same as it would have
    // in the sidebar; the prepared content survives so no second fetch runs.
    expect(panel.openDocsPage).toHaveBeenCalledWith(
      'bundled:first-dashboard',
      'Create your first dashboard',
      expect.objectContaining({ source: 'home_page', preparedContent })
    );
    // In-flight must be marked before the open so the empty-state fallback
    // and restoration gates can never observe "nothing happening".
    expect(order).toEqual(['in-flight', 'open']);

    // Consume-once: a second mount (or another surface) gets nothing.
    expect(consumePendingGuideOnMount(asPanel(panel), 'floating_panel_dock', markInFlight)).toBe(false);
    expect(panel.openDocsPage).toHaveBeenCalledTimes(1);
  });

  it('falls back to the surface handoff source when the pending guide carries none', () => {
    const panel = makePanel();
    panelModeManager.setPendingGuide({ url: 'bundled:foo', title: 'Foo', type: 'docs' });

    consumePendingGuideOnMount(asPanel(panel), 'floating_panel_dock', jest.fn());

    expect(panel.openDocsPage).toHaveBeenCalledWith(
      'bundled:foo',
      'Foo',
      expect.objectContaining({ source: 'floating_panel_dock' })
    );
  });

  it('is a no-op when no guide is pending', () => {
    const panel = makePanel();
    const markInFlight = jest.fn();

    expect(consumePendingGuideOnMount(asPanel(panel), 'floating_panel_dock', markInFlight)).toBe(false);

    expect(markInFlight).not.toHaveBeenCalled();
    expect(panel.openDocsPage).not.toHaveBeenCalled();
    expect(panel.openLearningJourney).not.toHaveBeenCalled();
    expect(panel.openEditorTab).not.toHaveBeenCalled();
  });
});
