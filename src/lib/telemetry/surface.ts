import pluginJson from '../../plugin.json';
import { StorageKeys } from '../storage-keys';
import { isExtensionSidebarOwnedByPathfinder } from '../storage/extension-sidebar';
import { KIOSK_OVERLAY_TEST_ID } from '../../constants/surface-selectors';
import { newGuideLoadId } from '../guide-diagnostics';

const SIDEBAR_COMPONENT_TITLE = 'Interactive learning';
const CONTROLLER_ROOT_ID = 'pathfinder-controller-root';

export type PathfinderSurface = 'sidebar' | 'floating' | 'fullscreen' | 'kiosk' | 'controller' | 'closed';

type SurfaceListener = (surface: PathfinderSurface) => void;

// Single owner of "which Pathfinder surface is active": surfaces report
// transitions here, telemetry subscribes. The DOM/localStorage read below is
// only the cold-start fallback, latched after its first read — every open
// path reports on mount, so a report (never a re-read) supersedes it.
let reportedSurface: PathfinderSurface | null = null;
let latchedColdSurface: PathfinderSurface | null = null;
const listeners = new Set<SurfaceListener>();

// In-memory and per tab by design: never written to storage, so a reload ends the session.
let panelSessionId: string | null = null;
// Cleared once sent: `session_started_at` rides on the first event of a session only.
let panelSessionStartedAt: number | null = null;

// Held by a kiosk launch across the gap before the sidebar opens (the launcher bounds it): a `closed`
// report inside it must not end the session, and the release ends it if nothing opened.
let handoffPending = false;

export function setPathfinderHandoff(pending: boolean): void {
  handoffPending = pending;
  if (!pending && reportedSurface === 'closed') {
    panelSessionId = null;
  }
}

export function getPanelSessionId(): string | null {
  return reportedSurface === 'closed' ? null : panelSessionId;
}

export function takePanelSessionProperties(): { pathfinder_session_id: string; session_started_at?: number } | null {
  const id = getPanelSessionId();
  if (id === null) {
    return null;
  }
  const startedAt = panelSessionStartedAt;
  panelSessionStartedAt = null;
  return startedAt === null
    ? { pathfinder_session_id: id }
    : { pathfinder_session_id: id, session_started_at: startedAt };
}

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
  // Query the overlay itself, not the persistent manager root — the root
  // mounts once kiosk mode is config-enabled and stays in the DOM whether
  // or not the overlay is actually visible.
  if (document.querySelector(`[data-testid="${KIOSK_OVERLAY_TEST_ID}"]`) !== null) {
    return 'kiosk';
  }
  if (document.getElementById(CONTROLLER_ROOT_ID) !== null) {
    return 'controller';
  }
  return 'closed';
}

export function getPathfinderSurface(): PathfinderSurface {
  if (reportedSurface !== null) {
    return reportedSurface;
  }
  latchedColdSurface ??= readPathfinderSurface();
  return latchedColdSurface;
}

export function isPathfinderOpen(): boolean {
  return getPathfinderSurface() !== 'closed';
}

export function hasReportedPathfinderSurface(): boolean {
  return reportedSurface !== null;
}

export function reportPathfinderSurface(surface: PathfinderSurface): void {
  if (surface === reportedSurface) {
    return;
  }
  reportedSurface = surface;
  latchedColdSurface = null;
  if (surface === 'closed') {
    // A mode change closes the old surface and opens the next in one task; only a close that outlives it ends the session.
    if (!handoffPending) {
      queueMicrotask(() => {
        if (reportedSurface === 'closed') {
          panelSessionId = null;
        }
      });
    }
  } else {
    handoffPending = false;
    if (panelSessionId === null) {
      panelSessionId = newGuideLoadId();
      panelSessionStartedAt = Date.now();
    }
  }
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
