import pluginJson from '../../plugin.json';
import { StorageKeys } from '../storage-keys';
import { isExtensionSidebarOwnedByPathfinder } from '../storage/extension-sidebar';

const SIDEBAR_COMPONENT_TITLE = 'Interactive learning';
const KIOSK_ROOT_ID = 'pathfinder-kiosk-root';
const CONTROLLER_ROOT_ID = 'pathfinder-controller-root';

export type PathfinderSurface = 'sidebar' | 'floating' | 'fullscreen' | 'kiosk' | 'controller' | 'closed';

type SurfaceListener = (surface: PathfinderSurface) => void;

// Single owner of "which Pathfinder surface is active": surfaces report
// transitions here, telemetry subscribes. The DOM/localStorage read below is
// only the cold-start fallback.
let reportedSurface: PathfinderSurface | null = null;
const listeners = new Set<SurfaceListener>();

// Mode literals mirror PanelMode in global-state/panel-mode — importing
// panelModeManager here would cycle via global-state → analytics → faro.
export function readPathfinderSurface(): PathfinderSurface {
  try {
    const mode = localStorage.getItem(StorageKeys.PANEL_MODE);
    if (mode === 'floating' || mode === 'fullscreen') {
      return mode;
    }
  } catch {
    // localStorage unavailable — fall through to the DOM checks.
  }
  if (isExtensionSidebarOwnedByPathfinder(pluginJson.id, SIDEBAR_COMPONENT_TITLE)) {
    return 'sidebar';
  }
  if (document.getElementById(KIOSK_ROOT_ID) !== null) {
    return 'kiosk';
  }
  if (document.getElementById(CONTROLLER_ROOT_ID) !== null) {
    return 'controller';
  }
  return 'closed';
}

export function getPathfinderSurface(): PathfinderSurface {
  return reportedSurface ?? readPathfinderSurface();
}

export function isPathfinderOpen(): boolean {
  return getPathfinderSurface() !== 'closed';
}

export function reportPathfinderSurface(surface: PathfinderSurface): void {
  if (surface === reportedSurface) {
    return;
  }
  reportedSurface = surface;
  for (const listener of listeners) {
    try {
      listener(surface);
    } catch {
      // Telemetry must never break the app it's observing.
    }
  }
}

// Reports `closed` only when `from` is still active — unmounts during a
// handoff fire after the destination reported itself and must not clobber it.
export function reportPathfinderSurfaceClosed(from: PathfinderSurface): void {
  if (getPathfinderSurface() === from) {
    reportPathfinderSurface('closed');
  }
}

export function onPathfinderSurfaceChange(listener: SurfaceListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
