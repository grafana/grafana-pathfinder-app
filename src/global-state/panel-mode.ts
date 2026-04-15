import { getAppEvents } from '@grafana/runtime';
import { StorageKeys } from '../lib/storage-keys';
import { type FloatingPanelGeometry, getDefaultFloatingPanelGeometry } from '../constants/floating-panel';

export type PanelMode = 'sidebar' | 'floating';

export interface PendingGuide {
  url: string;
  title: string;
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
  private _sidebarTabSnapshot: string | null = null;
  private _sidebarActiveTabSnapshot: string | null = null;
  /**
   * Get the current panel mode from localStorage.
   * Defaults to 'sidebar' for backward compatibility.
   */
  public getMode(): PanelMode {
    const stored = localStorage.getItem(StorageKeys.PANEL_MODE);
    if (stored === 'floating') {
      return 'floating';
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

    if (mode === 'floating') {
      // Close the Grafana extension sidebar to free the slot
      getAppEvents().publish({ type: 'close-extension-sidebar', payload: {} });
    }

    document.dispatchEvent(
      new CustomEvent('pathfinder-panel-mode-change', {
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
   * Snapshot the current sidebar tab state from localStorage.
   * Called before switching to floating mode so the floating panel's
   * model writes (via openDocsPage → saveTabsToStorage) don't
   * permanently overwrite the sidebar's tab state.
   */
  public snapshotSidebarTabs(): void {
    this._sidebarTabSnapshot = localStorage.getItem(StorageKeys.TABS) ?? null;
    this._sidebarActiveTabSnapshot = localStorage.getItem(StorageKeys.ACTIVE_TAB) ?? null;
  }

  /**
   * Restore the sidebar tab snapshot to localStorage.
   * Called before switching back to sidebar mode so the sidebar's
   * model restores the original tabs, not the floating panel's.
   */
  public restoreSidebarTabSnapshot(): void {
    if (this._sidebarTabSnapshot !== null) {
      localStorage.setItem(StorageKeys.TABS, this._sidebarTabSnapshot);
    }
    if (this._sidebarActiveTabSnapshot !== null) {
      localStorage.setItem(StorageKeys.ACTIVE_TAB, this._sidebarActiveTabSnapshot);
    }
    this._sidebarTabSnapshot = null;
    this._sidebarActiveTabSnapshot = null;
  }
}

export const panelModeManager = new PanelModeManager();
