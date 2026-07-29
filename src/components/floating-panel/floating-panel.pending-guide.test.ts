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
