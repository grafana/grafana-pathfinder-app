/**
 * Tripwire (Pattern J — contract-surface preservation)
 *
 * Pins the panel-mode persistence classification (locked decision 2 + the A2
 * mechanism): every `panelModeManager.setMode` call site must match the single
 * rule —
 *
 *   Use `setModePersisted` (persist + END the transient session) IFF the call
 *   is an explicit USER choice ADOPTING a NON-SIDEBAR surface (floating or
 *   fullscreen). Everything else (automatic teardown / auto-dock / self-heal /
 *   cold-load, and every return-to-base sidebar dock) stays plain `setMode`,
 *   which is non-persisting while an auto-launch round-trip is active and
 *   persists otherwise.
 *
 * Why source-assertion (not runtime mount):
 *   `@grafana/scenes` + `@grafana/ui` require a theme provider that is not
 *   available in the Jest environment, so these surfaces use tracked-file
 *   substring tripwires (see `docs-panel.panel-mode.test.tsx`).
 */

import * as fs from 'fs';
import * as path from 'path';

function read(rel: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf-8');
}

describe('panel-mode surface-toggle persistence classification', () => {
  describe('deliberate non-sidebar adoptions persist via setModePersisted', () => {
    it('FullScreenPanel switch-to-floating persists, never plain setMode', () => {
      const src = read('components/full-screen/FullScreenPanel.tsx');
      expect(src).toContain("setModePersisted('floating')");
      expect(src).not.toContain("setMode('floating')");
    });

    it('FloatingPanelManager switch-to-fullscreen persists, never plain setMode', () => {
      const src = read('components/floating-panel/FloatingPanelManager.tsx');
      expect(src).toContain("setModePersisted('fullscreen')");
      expect(src).not.toContain("setMode('fullscreen')");
    });

    it('the sidebar-owned pop-out / full-screen controls and deep link stay persisted', () => {
      expect(read('components/docs-panel/hooks/usePopOutHandoff.ts')).toContain("setModePersisted('floating')");
      const fullScreenHandoff = read('components/docs-panel/hooks/useFullScreenHandoff.ts');
      expect(fullScreenHandoff).toContain("setModePersisted('fullscreen')");
      expect(fullScreenHandoff).not.toContain("setMode('fullscreen')");
      const deepLink = read('utils/pathfinder-deep-link-handler.ts');
      expect(deepLink).toContain("setModePersisted('floating')");
      expect(deepLink).toContain("setModePersisted('fullscreen')");
    });
  });

  describe('automatic and return-to-base sites stay plain setMode', () => {
    it('full-screen auto-dock (sidebar OR floating) never persists', () => {
      const src = read('components/full-screen/full-screen-autodock.ts');
      expect(src).not.toContain('setModePersisted');
      expect(src).toContain("setMode('sidebar')");
      expect(src).toContain("setMode('floating')");
    });

    it('return-to-base sidebar docks and closes never adopt the base via setModePersisted', () => {
      // Base sidebar is never a deliberate non-sidebar adoption, so it must
      // never be forced-persisted; plain setMode gives the correct behavior
      // (suppressed during a transient round-trip, persists otherwise).
      const fullScreen = read('components/full-screen/FullScreenPanel.tsx');
      expect(fullScreen).toContain("setMode('sidebar')");
      expect(fullScreen).not.toContain("setModePersisted('sidebar')");

      const floating = read('components/floating-panel/FloatingPanelManager.tsx');
      expect(floating).toContain("setMode('sidebar')");
      expect(floating).not.toContain("setModePersisted('sidebar')");

      const notice = read('components/docs-panel/components/FullScreenModeNotice.tsx');
      expect(notice).toContain("setMode('sidebar')");
      expect(notice).not.toContain('setModePersisted');
    });

    it('self-heal and cold-load mode-sync stay plain setMode', () => {
      const contextPanel = read('components/App/ContextPanel.tsx');
      expect(contextPanel).toContain("setMode('sidebar')");
      expect(contextPanel).not.toContain('setModePersisted');

      const usePanelMode = read('components/docs-panel/hooks/usePanelMode.ts');
      expect(usePanelMode).toContain("setMode('sidebar')");
      expect(usePanelMode).not.toContain('setModePersisted');
    });

    it('FullScreenPanel cold-load route sync is transient, never a persisting write', () => {
      // The reconcile effect only fires when route and mode disagree — a cold
      // load / reload of /fullscreen after in-memory transient state was lost.
      // Aligning mode to the route is not a preference expression: a plain
      // setMode here persists 'fullscreen' over the user's stored preference
      // the moment they reload a transient full-screen launch.
      const src = read('components/full-screen/FullScreenPanel.tsx');
      expect(src).toContain("setModeTransient('fullscreen')");
      expect(src).not.toContain("setMode('fullscreen')");
    });
  });
});
