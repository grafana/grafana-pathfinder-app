import { getAppEvents } from '@grafana/runtime';
import { StorageKeys } from '../lib/storage-keys';
import { PANEL_MODE_CHANGE_EVENT } from '../lib/event-names';
import { reportPathfinderSurface, reportPathfinderSurfaceClosed } from '../lib/telemetry';
import { type FloatingPanelGeometry, getDefaultFloatingPanelGeometry } from '../constants/floating-panel';
import type { PackageOpenInfo } from '../types/content-panel.types';

export type PanelMode = 'sidebar' | 'floating' | 'fullscreen';

export interface PendingGuide {
  /**
   * URL of the guide to open. Optional — `'editor'` handoffs carry no URL
   * (the receiving surface calls `panel.openEditor()`).
   */
  url?: string;
  title: string;
  /**
   * Type discriminator so the consumer routes to the right open method.
   * - `'learning-journey'` → `panel.openLearningJourney`
   * - `'docs'` / `'interactive'` → `panel.openDocsPage`
   * - `'editor'` → `panel.openEditor` (no URL)
   *
   * Mirrors the `type` field on the `auto-launch-tutorial` event.
   */
  type?: 'learning-journey' | 'docs' | 'interactive' | 'editor';
  /**
   * Carry the manifest + pre-resolved milestones across surface handoffs.
   *
   * Required for synthetic packages whose URL is not a recognised package
   * URL (e.g. PR-tester journeys backed by raw GitHub URLs). Without this,
   * the receiving surface falls through to plain `fetchContent` and the
   * milestone toolbar / Alt+arrow navigation never appear.
   */
  packageInfo?: PackageOpenInfo;
}

/**
 * Global state manager for the panel display mode.
 *
 * Tracks whether Pathfinder guides render in the Grafana extension sidebar
 * or in a free-floating draggable panel. Persists the user's preference
 * to localStorage and coordinates mode transitions by dispatching events.
 */
class PanelModeManager {
  private _pendingGuide: PendingGuide | null = null;
  private _priorPath: string | null = null;
  /**
   * Get the current panel mode from localStorage.
   * Defaults to 'sidebar' for backward compatibility.
   */
  public getMode(): PanelMode {
    const stored = localStorage.getItem(StorageKeys.PANEL_MODE);
    if (stored === 'floating') {
      return 'floating';
    }
    if (stored === 'fullscreen') {
      return 'fullscreen';
    }
    return 'sidebar';
  }

  /**
   * Switch panel mode. Persists to localStorage and dispatches a
   * `pathfinder-panel-mode-change` event so both the sidebar and
   * floating panel can react.
   *
   * When switching to 'floating', closes the extension sidebar.
   * When switching to 'sidebar', notifies the floating panel to unmount.
   */
  public setMode(mode: PanelMode): void {
    const previous = this.getMode();
    if (mode === previous) {
      return;
    }

    localStorage.setItem(StorageKeys.PANEL_MODE, mode);

    if (mode === 'floating' || mode === 'fullscreen') {
      // Close the Grafana extension sidebar to free the slot. Full screen
      // also closes the sidebar so the two CombinedLearningJourneyPanel
      // instances do not collide on the __DocsPluginActiveTabId window
      // global or on tab storage writes.
      getAppEvents().publish({ type: 'close-extension-sidebar', payload: {} });
      reportPathfinderSurface(mode);
    } else if (previous === 'floating' || previous === 'fullscreen') {
      // 'sidebar' mode does not mean the sidebar is open — its mount reports
      // 'sidebar' itself; until then the surface is closed.
      reportPathfinderSurfaceClosed(previous);
    }

    document.dispatchEvent(
      new CustomEvent(PANEL_MODE_CHANGE_EVENT, {
        detail: { mode, previous },
      })
    );
  }

  /**
   * Read persisted floating panel geometry (position + size).
   * Returns default bottom-right position if nothing is stored.
   */
  public getPanelGeometry(): FloatingPanelGeometry {
    try {
      const raw = localStorage.getItem(StorageKeys.FLOATING_PANEL_GEOMETRY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          typeof parsed.x === 'number' &&
          typeof parsed.y === 'number' &&
          typeof parsed.width === 'number' &&
          typeof parsed.height === 'number'
        ) {
          return parsed as FloatingPanelGeometry;
        }
      }
    } catch {
      // Fall through to default
    }
    return getDefaultFloatingPanelGeometry();
  }

  /**
   * Persist floating panel geometry to localStorage.
   */
  public setPanelGeometry(geometry: FloatingPanelGeometry): void {
    localStorage.setItem(StorageKeys.FLOATING_PANEL_GEOMETRY, JSON.stringify(geometry));
  }

  /**
   * Store a guide to be opened when the floating panel mounts.
   * Called before setMode('floating') to hand off the active guide
   * from the sidebar to the floating panel.
   */
  public setPendingGuide(guide: PendingGuide): void {
    this._pendingGuide = guide;
  }

  /**
   * Consume and clear the pending guide. Returns null if none was set.
   */
  public consumePendingGuide(): PendingGuide | null {
    const guide = this._pendingGuide;
    this._pendingGuide = null;
    return guide;
  }

  /**
   * Capture the Grafana route the user was on right before entering full
   * screen, so the explicit "Return to sidebar" button can land them back
   * where they came from instead of the plugin home (My Learning).
   *
   * Called from the sidebar / floating "switch to full screen" handlers,
   * immediately before the route push to `/fullscreen`.
   */
  public capturePriorPath(path: string): void {
    this._priorPath = path;
  }

  /**
   * Consume and clear the captured prior path. Returns null if nothing
   * was captured (e.g. cold-loaded `/fullscreen` URL with no entry route).
   */
  public consumePriorPath(): string | null {
    const path = this._priorPath;
    this._priorPath = null;
    return path;
  }
}

export const panelModeManager = new PanelModeManager();
