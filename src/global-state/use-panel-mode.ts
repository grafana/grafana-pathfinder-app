/**
 * Tracks the panel mode (`sidebar` / `floating` / `fullscreen`) and exposes the
 * two surface-coordination dispatchers used across Pathfinder chrome.
 *
 * This is the plain listener: it mirrors `pathfinder-panel-mode-change` into
 * React state and offers pop-out/dock and full-screen requests. It deliberately
 * carries no fullscreen self-heal — that behavior is sidebar-specific and lives
 * in `docs-panel/hooks/usePanelMode.ts`; the block editor legitimately mounts on
 * the fullscreen surface and must not reset itself off it.
 */
import * as React from 'react';
import { PANEL_MODE_CHANGE_EVENT } from '../lib/event-names';
import { panelModeManager, type PanelMode } from './panel-mode';

export interface PanelModeControls {
  panelMode: PanelMode;
  /** Pop out to a floating window (from sidebar) or dock back (from floating). */
  handleTogglePanelMode: () => void;
  /** Request a switch to the full-screen surface. */
  handleGoFullScreen: () => void;
}

export function usePanelModeControls(): PanelModeControls {
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

  // The sidebar's docs-panel handler picks up pop-out for the editor tab; the
  // FloatingPanelManager handles dock requests.
  const handleTogglePanelMode = React.useCallback(() => {
    if (panelMode === 'sidebar') {
      document.dispatchEvent(new CustomEvent('pathfinder-request-pop-out'));
    } else {
      document.dispatchEvent(new CustomEvent('pathfinder-request-dock'));
    }
  }, [panelMode]);

  const handleGoFullScreen = React.useCallback(() => {
    document.dispatchEvent(new CustomEvent('pathfinder-request-full-screen'));
  }, []);

  return { panelMode, handleTogglePanelMode, handleGoFullScreen };
}
