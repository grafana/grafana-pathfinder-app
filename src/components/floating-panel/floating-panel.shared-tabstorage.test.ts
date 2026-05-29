/**
 * Tripwire (Pattern J — contract-surface preservation)
 *
 * Pins the "floating panel shares `tabStorage` with the sidebar" contract,
 * which fixes the milestone-reset-on-dock-back bug by removing the
 * snapshot/restore mechanism. If a future change reintroduces
 * `snapshotSidebarTabs` / `restoreSidebarTabSnapshot` on the floating
 * surface, the bug returns: the snapshot taken at pop-out time gets
 * written back to `tabStorage` at dock, clobbering whatever milestone
 * position the user advanced through in the floating panel.
 *
 * Why a tripwire (not a runtime mount test):
 *   `@grafana/scenes` + `@grafana/ui` require a theme provider that is
 *   not available in the Jest environment. Source-assertion tripwires
 *   are the established shape for the docs-panel + floating-panel
 *   surfaces in this repo (see `docs-panel.panel-mode.test.tsx`).
 */

import * as fs from 'fs';
import * as path from 'path';

function read(rel: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf-8');
}

const SNAPSHOT_METHODS = ['snapshotSidebarTabs', 'restoreSidebarTabSnapshot'];

describe('floating panel shares tabStorage with the sidebar', () => {
  it('panelModeManager no longer exposes the snapshot API', () => {
    const src = read('global-state/panel-mode.ts');
    for (const method of SNAPSHOT_METHODS) {
      expect(src).not.toContain(method);
    }
  });

  it('FloatingPanelManager does not snapshot or restore', () => {
    const src = read('components/floating-panel/FloatingPanelManager.tsx');
    for (const method of SNAPSHOT_METHODS) {
      expect(src).not.toContain(method);
    }
  });

  it('usePopOutHandoff awaits saveTabsToStorage before flipping the mode', () => {
    const src = read('components/docs-panel/hooks/usePopOutHandoff.ts');
    for (const method of SNAPSHOT_METHODS) {
      expect(src).not.toContain(method);
    }
    expect(src).toMatch(/await\s+model\.saveTabsToStorage\(\)/);
    expect(src).toContain("setMode('floating')");
  });

  it('full-screen-autodock does not snapshot or set a pending guide for the floating branch', () => {
    const src = read('components/full-screen/full-screen-autodock.ts');
    for (const method of SNAPSHOT_METHODS) {
      expect(src).not.toContain(method);
    }
    expect(src).not.toContain('setPendingGuide');
  });
});
