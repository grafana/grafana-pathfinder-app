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

import { openPendingGuide } from './pendingGuideRouter';
import type { CombinedLearningJourneyPanel } from './docs-panel';
import type { PendingGuide } from '../../global-state/panel-mode';

function makePanel() {
  return {
    openEditorTab: jest.fn(),
    openLearningJourney: jest.fn(),
    openDocsPage: jest.fn(),
  };
}

function asPanel(panel: ReturnType<typeof makePanel>): CombinedLearningJourneyPanel {
  // The real panel is a Scenes object with many other methods we don't
  // exercise here; cast the minimal shape so we can assert call arguments.
  return panel as unknown as CombinedLearningJourneyPanel;
}

describe('openPendingGuide', () => {
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
