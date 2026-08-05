/**
 * Tripwire (Pattern J — contract-surface preservation)
 *
 * Pins which mode-change method each `panelModeManager` call site reaches for,
 * against the persistence classification recorded canonically in
 * docs/design/PANEL-MODE-PERSISTENCE.md (decisions 2 and 3): deliberate surface
 * ADOPTIONS use `setModePersisted`; automatic transitions and RETURN-to-base
 * gestures stay conditional `setMode`.
 *
 * The per-gesture SEMANTICS (persist vs suppress) are proven behaviourally in
 * `global-state/panel-mode.test.ts`; this file only pins which method each
 * call site reaches for, since the runtime surfaces can't mount under Jest.
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

  describe('the floating dock-to-sidebar pill is a deliberate adoption (decision 3)', () => {
    it('the pill persists (dockToSidebar(true)) while the programmatic dock request stays transient (dockToSidebar(false))', () => {
      // #1449: docking via the pill is a deliberate "adopt the sidebar" gesture,
      // so it must persist consistently — same outcome whether or not a guide was
      // auto-launched earlier in the session. The programmatic dock request
      // (guide `popout` action / generic toggle, via `pathfinder-request-dock`)
      // is NOT an adoption and must stay transient-safe. Both route through one
      // shared `dockToSidebar(persist)` body, so a whole-file check for
      // `setModePersisted('sidebar')` can't tell the two call sites apart —
      // scope each assertion to its call site to catch a "right method, wrong
      // call site" swap. The behavioural proof lives in panel-mode.test.ts.
      const floating = read('components/floating-panel/FloatingPanelManager.tsx');
      expect(floating).toMatch(
        /handleSwitchToSidebar = useCallback\(async \(\) => \{\s*await dockToSidebar\(true\);\s*\}/
      );
      expect(floating).toMatch(/handleDockRequest = \(\) => \{\s*void dockToSidebar\(false\);\s*\}/);
    });
  });

  describe('automatic and return-to-base sites stay conditional setMode', () => {
    it('full-screen auto-dock (sidebar OR floating) never persists', () => {
      const src = read('components/full-screen/full-screen-autodock.ts');
      expect(src).not.toContain('setModePersisted');
      expect(src).toContain("setMode('sidebar')");
      expect(src).toContain("setMode('floating')");
    });

    it('the fullscreen RETURN-to-sidebar exit stays conditional, never a forced sidebar adoption', () => {
      // The fullscreen back-arrow / notice is a RETURN, not an adoption
      // (decision 3): forcing setModePersisted('sidebar') here would overwrite a
      // prose reader's real preference when they leave a transient fullscreen
      // launch. Conditional setMode is correct — suppressed during a transient
      // session, persists when leaving a surface the user chose themselves.
      const fullScreen = read('components/full-screen/FullScreenPanel.tsx');
      expect(fullScreen).toContain("setMode('sidebar')");
      expect(fullScreen).not.toContain("setModePersisted('sidebar')");

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
