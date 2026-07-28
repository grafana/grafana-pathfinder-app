/**
 * Tripwire (Pattern J — contract-surface preservation)
 *
 * Pins the floating surface's pending-guide consumption, added for PR #1446
 * review finding 3: HomePanel's occupied-sidebar launch path hands the
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
    // so the restoration gate sees the just-opened tab.
    expect(src.indexOf('consumePendingGuideOnMount')).toBeLessThan(src.indexOf('restoreTabsAsync'));
  });

  it('gates restoration on LIVE model tabs, not the render snapshot', () => {
    // The pending-guide open mutates panel.state.tabs synchronously in the
    // same commit; a closure'd snapshot would restore on top of it.
    expect(src).toMatch(/const liveTabs = panel\.state\.tabs/);
  });
});
