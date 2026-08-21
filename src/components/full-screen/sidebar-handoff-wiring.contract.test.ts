/**
 * Tripwire (Pattern J — contract-surface preservation)
 *
 * Pins the wiring shape of the full-screen sidebar-handoff and full-screen
 * relaunch event contracts: which effect owns each `document` listener, that
 * the listener reads the latest callback through a ref (not a dependency
 * array) so a same-tick automatic dispatch can't be handled by a stale
 * closure, and that add/remove use the same event name.
 *
 * Why source-assertion (not runtime mount): `@grafana/scenes` + `@grafana/ui`
 * require a theme provider not available in the Jest environment, so
 * `FullScreenPanel.tsx` can't be rendered here (see
 * `panel-mode-surface-toggles.contract.test.ts`, established for the same
 * reason). The dispatch-side behavior (does `requestSidebarHandoff` fire the
 * event) is proven behaviorally in `global-state/panel-mode.test.ts`; this
 * file only pins the listener side.
 */

import * as fs from 'fs';
import * as path from 'path';

function read(rel: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf-8');
}

describe('full-screen sidebar-handoff and relaunch listener wiring', () => {
  const fullScreenPanel = read('components/full-screen/FullScreenPanel.tsx');

  it('the REQUEST_SIDEBAR_HANDOFF_EVENT listener subscribes once (empty deps), not on every handleExitToSidebar identity change', () => {
    // A `[handleExitToSidebar]` dependency array would re-subscribe on every
    // render where the callback's identity changes, and — more importantly —
    // would let the effect close over a stale `handleExitToSidebar` between
    // an automatic dispatch and the next re-render. Pin the empty array.
    expect(fullScreenPanel).toMatch(
      /useEffect\(\(\) => \{\s*const handleSidebarHandoffRequest = \(event: Event\) => \{[\s\S]*?\}, \[\]\);/
    );
  });

  it('the handoff handler reads handleExitToSidebarRef.current(), not handleExitToSidebar directly', () => {
    const handlerBlock = fullScreenPanel.match(
      /const handleSidebarHandoffRequest = \(event: Event\) => \{[\s\S]*?\n {4}\};/
    )?.[0];
    expect(handlerBlock).toBeDefined();
    expect(handlerBlock).toContain("handleExitToSidebarRef.current('content_requires_grafana_ui', targetPath)");
    expect(handlerBlock).not.toMatch(/[^.]handleExitToSidebar\(/);
  });

  it('adds and removes the same REQUEST_SIDEBAR_HANDOFF_EVENT listener', () => {
    expect(fullScreenPanel).toContain(
      'document.addEventListener(REQUEST_SIDEBAR_HANDOFF_EVENT, handleSidebarHandoffRequest)'
    );
    expect(fullScreenPanel).toContain(
      'document.removeEventListener(REQUEST_SIDEBAR_HANDOFF_EVENT, handleSidebarHandoffRequest)'
    );
  });

  it('every handleExitToSidebar call site passes an explicit reason (regression guard for the analytics conflation fix)', () => {
    expect(fullScreenPanel).toContain("void handleExitToSidebar('manual_exit')");
    expect(fullScreenPanel).toContain("void handleExitToSidebarRef.current('empty_state_fallback')");
    expect(fullScreenPanel).toContain("void handleExitToSidebar('dock_request')");
    expect(fullScreenPanel).toContain("void handleExitToSidebarRef.current('content_requires_grafana_ui', targetPath)");
  });

  it('panel-mode.ts does not publish a toast from requestSidebarHandoffAndWait itself (regression guard)', () => {
    const panelMode = read('global-state/panel-mode.ts');
    const fnBody = panelMode.match(/export function requestSidebarHandoffAndWait\([\s\S]*?\n\}/)?.[0];
    expect(fnBody).toBeDefined();
    expect(fnBody).toContain('new CustomEvent(REQUEST_SIDEBAR_HANDOFF_EVENT');
    expect(fnBody).not.toContain('getAppEvents()');
  });

  it('validates targetPath through resolveSafeTargetPath before it reaches locationService.push, falling back to priorPath then PLUGIN_BASE_URL', () => {
    // Regression guard: targetPath is author-controlled manifest data with no
    // user confirmation gate (see resolve-safe-target-path.ts) — it must never
    // reach locationService.push unvalidated, and a rejected/absent value must
    // still fall through to priorPath/PLUGIN_BASE_URL rather than dropping the
    // handoff entirely.
    expect(fullScreenPanel).toContain("import { resolveSafeTargetPath } from './resolve-safe-target-path';");
    expect(fullScreenPanel).toContain(
      'const safeTargetPath = targetPath != null ? resolveSafeTargetPath(targetPath) : undefined;'
    );
    expect(fullScreenPanel).toContain('locationService.push(safeTargetPath ?? priorPath ?? PLUGIN_BASE_URL);');
    expect(fullScreenPanel).not.toMatch(/locationService\.push\(targetPath \?\?/);
  });

  it('imports the shared FullScreenExitReason type from full-screen-autodock.ts rather than declaring its own disconnected union', () => {
    // Regression guard: a local, uncoordinated reason type here previously
    // claimed (only in a comment) to "mirror" full-screen-autodock.ts's
    // vocabulary with nothing enforcing it. The import is the actual contract.
    expect(fullScreenPanel).toContain(
      "import { dockOnLeavingFullScreen, type HistoryAction, type FullScreenExitReason } from './full-screen-autodock';"
    );
    expect(fullScreenPanel).not.toMatch(/type FullScreenExitToSidebarReason/);
  });

  it('the REQUEST_FULLSCREEN_GUIDE_EVENT listener is added and removed alongside the legacy pathfinder-request-full-screen event', () => {
    expect(fullScreenPanel).toContain(
      "document.addEventListener('pathfinder-request-full-screen', handleFullScreenRequest)"
    );
    expect(fullScreenPanel).toContain(
      'document.addEventListener(REQUEST_FULLSCREEN_GUIDE_EVENT, handleFullScreenRequest)'
    );
    expect(fullScreenPanel).toContain(
      "document.removeEventListener('pathfinder-request-full-screen', handleFullScreenRequest)"
    );
    expect(fullScreenPanel).toContain(
      'document.removeEventListener(REQUEST_FULLSCREEN_GUIDE_EVENT, handleFullScreenRequest)'
    );
  });
});
