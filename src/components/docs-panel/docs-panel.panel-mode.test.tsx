/**
 * Phase 0 tripwire (Pattern J — contract-surface preservation)
 *
 * Pins the `pathfinder-panel-mode-change` CustomEvent contract that docs-panel
 * owns the *consumer* side of:
 *   1. A listener for the event is registered somewhere in the docs-panel tree.
 *   2. Receiving a mode-change updates an internal `panelMode` React state
 *      (so renderer branches like FullScreenModeNotice react correctly).
 *   3. The fullscreen self-heal effect resets stale `'fullscreen'` mode to
 *      `'sidebar'` when the current pathname is not the full-screen route —
 *      a load-bearing behavior documented in the renderer at the original
 *      site (see comments around the self-heal effect for full rationale).
 *
 * Why source-assertion (not runtime mount):
 *   `@grafana/scenes` + `@grafana/ui` require a theme provider that is not
 *   available in the Jest environment. Tracked-file substring assertions
 *   are the established tripwire shape for the docs-panel surface.
 *
 * Refactor maintenance:
 *   When the listener + self-heal move to a hook (Phase 1 — `usePanelMode`),
 *   add that hook's path to TRACKED_FILES.
 *
 * @see High-Risk Refactor Guidelines — Pattern J: Contract-Surface Extraction
 *      https://github.com/grafana/grafana-pathfinder-app/wiki/High-Risk-Refactor-Guidelines
 */

import * as fs from 'fs';
import * as path from 'path';
import { PANEL_MODE_CHANGE_EVENT } from '../../lib/event-names';

const PANEL_ROOT = path.join(__dirname);

/**
 * Files allowed to own the listener + self-heal for the
 * `pathfinder-panel-mode-change` contract.
 */
const TRACKED_FILES = ['docs-panel.tsx', 'hooks/usePanelMode.ts'];

const REQUIRED_REFERENCES = {
  listenerRegistration: 'addEventListener(PANEL_MODE_CHANGE_EVENT',
  listenerCleanup: 'removeEventListener(PANEL_MODE_CHANGE_EVENT',
  // The setter name is React-state implementation detail, but the symbol is
  // stable enough to act as a "we propagate the event into React state" pin.
  stateUpdate: 'setPanelMode(',
  selfHealResetToSidebar: "panelModeManager.setMode('sidebar')",
  fullScreenRouteCheck: 'ROUTES.FullScreen',
};

function loadTrackedSources(): Array<{ file: string; src: string | null }> {
  return TRACKED_FILES.map((file) => {
    const fullPath = path.join(PANEL_ROOT, file);
    return {
      file,
      src: fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf-8') : null,
    };
  });
}

describe('Phase 0 tripwire: pathfinder-panel-mode-change CustomEvent contract', () => {
  it('event name on the wire stays pathfinder-panel-mode-change', () => {
    expect(PANEL_MODE_CHANGE_EVENT).toBe('pathfinder-panel-mode-change');
  });

  it('listener registration exists in exactly one tracked file', () => {
    const matches = loadTrackedSources().filter(
      ({ src }) => src && src.includes(REQUIRED_REFERENCES.listenerRegistration)
    );
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.length).toBeLessThanOrEqual(1);
  });

  it('listener cleanup pairs with registration in the same tracked file', () => {
    const owner = loadTrackedSources().find(({ src }) => src && src.includes(REQUIRED_REFERENCES.listenerRegistration));
    expect(owner?.src).toBeDefined();
    expect(owner!.src).toContain(REQUIRED_REFERENCES.listenerCleanup);
  });

  it('mode-change event propagates into React state via setPanelMode', () => {
    const owner = loadTrackedSources().find(({ src }) => src && src.includes(REQUIRED_REFERENCES.listenerRegistration));
    expect(owner?.src).toBeDefined();
    expect(owner!.src).toContain(REQUIRED_REFERENCES.stateUpdate);
  });

  it('fullscreen self-heal resets stale fullscreen mode to sidebar when off-route', () => {
    // The self-heal lives in the same owner that registers the listener
    // today; once extracted to a hook it will too. Search the owner directly.
    const owner = loadTrackedSources().find(({ src }) => src && src.includes(REQUIRED_REFERENCES.listenerRegistration));
    expect(owner?.src).toBeDefined();
    expect(owner!.src).toContain(REQUIRED_REFERENCES.selfHealResetToSidebar);
    expect(owner!.src).toContain(REQUIRED_REFERENCES.fullScreenRouteCheck);
  });
});
