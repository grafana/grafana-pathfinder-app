/**
 * Tripwire (Pattern J — contract-surface preservation)
 *
 * Pins the floating surface's pending-guide consumption:
 * HomePanel's occupied-sidebar launch path hands the
 * prepared guide off via `panelModeManager.setPendingGuide` + transient
 * floating mode, and `FloatingPanelInner` must consume it on mount or the
 * launch is silently dropped (the panel restores stale tabs, or the
 * empty-state fallback bounces straight back to sidebar mode).
 *
 * Why a tripwire (not a runtime mount test):
 *   `@grafana/scenes` + `@grafana/ui` require a theme provider that is
 *   not available in the Jest environment — the established shape for this
 *   surface (see `floating-panel.shared-tabstorage.test.ts`). The consume
 *   step's behavior is unit-tested in `pendingGuideRouter.test.ts`; this
 *   file pins only the wiring the mount test would otherwise cover.
 */

import * as fs from 'fs';
import * as path from 'path';

const src = fs.readFileSync(path.resolve(__dirname, 'FloatingPanelManager.tsx'), 'utf-8');

describe('FloatingPanelInner consumes the pending guide on mount', () => {
  it('calls the shared consume step (consume → in-flight → route)', () => {
    expect(src).toContain('consumePendingGuideOnMount(panel,');
  });

  it('consumes before the tab-restoration effect runs', () => {
    // Effects run in declaration order; consumption must be declared first
    // so the restoration gate sees the just-opened tab. Anchor on the call
    // site `(panel,` — a bare name match would hit the import statement and
    // pass regardless of effect order.
    expect(src.indexOf('consumePendingGuideOnMount(panel,')).toBeLessThan(src.indexOf('restoreTabsAsync'));
  });

  it('gates restoration on LIVE model tabs, not the render snapshot', () => {
    // The pending-guide open mutates panel.state.tabs synchronously in the
    // same commit; a closure'd snapshot would restore on top of it.
    expect(src).toMatch(/const liveTabs = panel\.state\.tabs/);
  });

  it('skips restore when the guide strip already has tabs', () => {
    expect(src).toContain('getGuideStripTabs(liveTabs).length === 0');
  });
});

describe('FloatingPanelInner consumes staged guides while already mounted', () => {
  // A same-mode transient launch fires no PANEL_MODE_CHANGE_EVENT, so the
  // mount effect never re-runs; HomePanel signals the mounted panel instead.
  it('listens for the request-floating-guide signal and routes through the shared consume step', () => {
    expect(src).toContain('addEventListener(REQUEST_FLOATING_GUIDE_EVENT');
    expect(src).toContain('removeEventListener(REQUEST_FLOATING_GUIDE_EVENT');
    const listenerEffect = src.slice(src.indexOf('handleRequestGuide'));
    expect(listenerEffect).toContain('consumePendingGuideOnMount(panel,');
  });
});

describe('outer FloatingPanelManager re-syncs a stale cached mode on a floating launch (#1448)', () => {
  // A quiet transient-Back exit clears the session without emitting
  // PANEL_MODE_CHANGE_EVENT, so the always-mounted outer manager can be cached
  // stale-'fullscreen' while getMode() has reverted to a persisted 'floating'.
  // The next floating launch's REQUEST_FLOATING_GUIDE_EVENT must remount the
  // inner (its only consumer) instead of firing into a void and stranding the
  // guide. The remount then consumes the pending guide via the mount path pinned
  // above. Anchor on the OUTER component (before FloatingPanelInner) so this
  // can't be satisfied by the inner's same-named listener.
  const outer = src.slice(0, src.indexOf('function FloatingPanelInner'));

  it('the outer manager listens for REQUEST_FLOATING_GUIDE_EVENT', () => {
    expect(outer).toContain('addEventListener(REQUEST_FLOATING_GUIDE_EVENT');
    expect(outer).toContain('removeEventListener(REQUEST_FLOATING_GUIDE_EVENT');
  });

  it('re-derives its rendered mode from the singleton (not the stale event cache)', () => {
    expect(outer).toContain('setMode(panelModeManager.getMode())');
  });
});
