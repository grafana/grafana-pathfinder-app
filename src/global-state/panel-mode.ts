import { getAppEvents } from '@grafana/runtime';
import { StorageKeys } from '../lib/storage-keys';
import { type FloatingPanelGeometry, getDefaultFloatingPanelGeometry } from '../constants/floating-panel';

export type PanelMode = 'sidebar' | 'floating';

/**
 * Global state manager for the panel display mode.
 *
 * Tracks whether Pathfinder guides render in the Grafana extension sidebar
 * or in a free-floating draggable panel. Persists the user's preference
 * to localStorage and coordinates mode transitions by dispatching events.
 */
class PanelModeManager {
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
}

export const panelModeManager = new PanelModeManager();
