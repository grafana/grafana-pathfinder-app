/**
 * Tracks the panel mode (`sidebar` / `floating` / `fullscreen`) and propagates
 * changes from the `pathfinder-panel-mode-change` CustomEvent into React state.
 *
 * Also performs the fullscreen self-heal: if React mounts this sidebar
 * instance while `panelModeManager` reports stale `'fullscreen'` mode AND
 * the current pathname is not the full-screen route, reset the mode to
 * `'sidebar'`. Without the self-heal we'd render the "Pathfinder is in
 * full screen" placeholder forever after a tab close + reopen, or when
 * the user navigates from `/fullscreen` to another Grafana page via the
 * global nav (the auto-dock listener can only fire while FullScreenPanel
 * is mounted).
 *
 * Contract surfaces preserved (Pattern J — pinned by
 * docs-panel.panel-mode.test.tsx):
 *   - CustomEvent name: `pathfinder-panel-mode-change`
 *   - Self-heal reset: `panelModeManager.setMode('sidebar')`
 *   - Off-route check: `ROUTES.FullScreen` under `PLUGIN_BASE_URL`
 */
import * as React from 'react';
import { PLUGIN_BASE_URL, ROUTES } from '../../../constants';
import { PANEL_MODE_CHANGE_EVENT } from '../../../lib/event-names';
import { panelModeManager, type PanelMode } from '../../../global-state/panel-mode';

export interface UsePanelModeResult {
  panelMode: PanelMode;
  isFullScreenActive: boolean;
}

export function usePanelMode(): UsePanelModeResult {
  const [panelMode, setPanelMode] = React.useState<PanelMode>(() => panelModeManager.getMode());

  React.useEffect(() => {
    const handleModeChange = (e: CustomEvent<{ mode: PanelMode }>) => {
      setPanelMode(e.detail.mode);
    };
    document.addEventListener(PANEL_MODE_CHANGE_EVENT, handleModeChange as EventListener);
    return () => {
      document.removeEventListener(PANEL_MODE_CHANGE_EVENT, handleModeChange as EventListener);
    };
  }, []);

  React.useEffect(() => {
    if (panelMode !== 'fullscreen') {
      return;
    }
    const onFullScreenRoute = window.location.pathname.startsWith(`${PLUGIN_BASE_URL}/${ROUTES.FullScreen}`);
    if (!onFullScreenRoute) {
      panelModeManager.setMode('sidebar');
      // eslint-disable-next-line react-hooks/set-state-in-effect -- self-heal: correct stale persisted fullscreen mode when not on the fullscreen route
      setPanelMode('sidebar');
    }
  }, [panelMode]);

  return { panelMode, isFullScreenActive: panelMode === 'fullscreen' };
}
