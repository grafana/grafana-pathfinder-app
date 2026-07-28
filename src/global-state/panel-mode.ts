import { getAppEvents } from '@grafana/runtime';
import { StorageKeys } from '../lib/storage-keys';
import { PANEL_MODE_CHANGE_EVENT } from '../lib/event-names';
// Surgical import (not the ../lib/telemetry barrel): panel-mode is
// entry-eager, and the barrel would pull the telemetry package into module.js.
import { reportPathfinderSurface, reportPathfinderSurfaceClosed } from '../lib/telemetry/surface';
import { type FloatingPanelGeometry, getDefaultFloatingPanelGeometry } from '../constants/floating-panel';
import type { PackageOpenInfo } from '../types/content-panel.types';
import type { RawContent } from '../types/content.types';

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
  /**
   * Content already fetched + snippet-expanded by `prepareGuideLaunch`, carried
   * so the receiving surface renders it without a second fetch (one-fetch
   * launch). One-shot memory state — consumed with the pending guide, never
   * persisted to tab storage.
   */
  preparedContent?: RawContent;
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
   * In-memory current surface. When non-null it wins over the persisted
   * preference for `getMode()` and mount decisions and is never written to
   * localStorage. Set by an automatic launch (`setModeTransient`) and updated by
   * each non-persisting `setMode` during the round-trip; cleared when a
   * persisting write (`setModePersisted`, or `setMode` outside a round-trip)
   * takes over so localStorage governs again. Does not survive a page reload.
   */
  private _transientMode: PanelMode | null = null;
  /**
   * Whether an auto-launch round-trip is in progress. Gates ONLY persistence:
   * while active, plain `setMode` (every automatic teardown / exit / auto-dock,
   * to sidebar OR floating) does not overwrite the user's stored preference
   * (locked decision 2). The round-trip ends only when a deliberate
   * `setModePersisted` runs or the page reloads.
   */
  private _transientActive = false;

  /**
   * Get the current panel mode. The in-memory surface override wins over the
   * persisted preference; otherwise read from localStorage. Defaults to
   * 'sidebar' for backward compatibility.
   */
  public getMode(): PanelMode {
    if (this._transientMode) {
      return this._transientMode;
    }
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
   * Switch panel mode. Dispatches a `pathfinder-panel-mode-change` event so
   * both the sidebar and floating panel can react.
   *
   * When switching to 'floating' or 'fullscreen', closes the extension sidebar.
   *
   * This is the AUTOMATIC path and the single enforcement point for locked
   * decision 2: while an auto-launch round-trip is active it is non-persisting
   * for EVERY destination (teardown, exit, auto-dock to sidebar OR floating) and
   * keeps the round-trip open, so no automatic surface change overwrites the
   * user's stored preference. Outside a round-trip it persists the mode and
   * drops any in-memory override. Deliberate user surface choices must use
   * `setModePersisted`.
   */
  public setMode(mode: PanelMode): void {
    this.applyModeChange(mode, (next) => {
      if (this._transientActive) {
        this._transientMode = next;
      } else {
        this._transientMode = null;
        localStorage.setItem(StorageKeys.PANEL_MODE, next);
      }
    });
  }

  /**
   * Switch panel mode for a DELIBERATE user surface choice (the pop-out /
   * full-screen controls, a deep-link `panelMode=`). Always persists to
   * localStorage, ends any active auto-launch round-trip, and drops the
   * in-memory override so localStorage governs again. Runs the same side effects
   * as `setMode`.
   */
  public setModePersisted(mode: PanelMode): void {
    this.applyModeChange(mode, (next) => {
      this._transientActive = false;
      this._transientMode = null;
      localStorage.setItem(StorageKeys.PANEL_MODE, next);
    });
  }

  /**
   * Switch panel mode for an automatic launch WITHOUT persisting it. Runs the
   * same side effects as `setMode` (close sidebar, telemetry, mode-change
   * event) but records the choice in memory only, so the user's stored
   * preference is untouched (locked decision: an automatic launch selection
   * must not overwrite the persisted preference). Opens an auto-launch
   * round-trip that the next `setMode` (exit / auto-dock / close) ends; does
   * not survive a reload.
   */
  public setModeTransient(mode: PanelMode): void {
    this.applyModeChange(mode, (next) => {
      this._transientActive = true;
      this._transientMode = next;
    });
  }

  private applyModeChange(mode: PanelMode, commit: (mode: PanelMode) => void): void {
    const previous = this.getMode();

    // Record the new state first (idempotent) so a transient session is marked
    // even when the surface does not visibly change — e.g. an auto-launch to the
    // surface that already matches the stored preference. Otherwise the session
    // would not be flagged transient and a later teardown would persist over the
    // user's preference.
    commit(mode);

    if (mode === previous) {
      return;
    }

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
