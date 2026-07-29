import { getAppEvents } from '@grafana/runtime';
import { StorageKeys } from '../lib/storage-keys';
import { PANEL_MODE_CHANGE_EVENT } from '../lib/event-names';
// Surgical import (not the ../lib/telemetry barrel): panel-mode is
// entry-eager, and the barrel would pull the telemetry package into module.js.
import { reportPathfinderSurface, reportPathfinderSurfaceClosed } from '../lib/telemetry/surface';
import { type FloatingPanelGeometry, getDefaultFloatingPanelGeometry } from '../constants/floating-panel';
import type { PackageOpenInfo } from '../types/content-panel.types';
import type { RawContent } from '../types/content.types';
import type { LaunchSource } from '../recovery';

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
  /**
   * Launch source of the ORIGINAL launch, carried so alignment semantics
   * survive the surface handoff — a `home_page` launch needs the same
   * starting-location check whether it lands in the sidebar (event path)
   * or a floating overlay (this path). Consumers fall back to their legacy
   * handoff source when absent.
   */
  source?: LaunchSource;
}

/**
 * Global state manager for the panel display mode (sidebar / floating /
 * fullscreen).
 *
 * PERSISTENCE CONTRACT
 * --------------------
 * Two things are tracked separately:
 *   - the CURRENT surface (what the user sees right now), and
 *   - the PERSISTED preference (localStorage — what a fresh page load restores).
 *
 * Three mutators, distinguished only by how they touch those two:
 *   - `setModePersisted(mode)` — a DELIBERATE surface ADOPTION. Always writes
 *     localStorage and ends any transient session. Use at explicit user
 *     surface-switch controls: pop-out, switch-to-fullscreen, the floating
 *     dock-to-sidebar pill, deep links.
 *   - `setModeTransient(mode)` — an AUTOMATIC launch selection (a guide opened
 *     from My Learning picks the surface that best fits its content). In-memory
 *     only, never persists, so the user's stored preference survives.
 *   - `setMode(mode)` — everything else: automatic teardown / auto-dock /
 *     self-heal / cold-load sync, and deliberate RETURN-to-base gestures
 *     (fullscreen back-arrow, floating close). CONDITIONAL — while a transient
 *     session is active it does not persist (leaving an auto-launched surface
 *     restores the stored preference); outside a session it persists (returning
 *     from a surface the user chose themselves sticks).
 *
 * WHY this shape — decisions 2 and 3 and the rejected "setMode never persists"
 * alternative — is recorded canonically in docs/design/PANEL-MODE-PERSISTENCE.md.
 * The load-bearing invariant (decision 2): an automatic launch never overwrites
 * the stored preference. The intentional asymmetry (decision 3, #1449): the
 * dock-to-sidebar pill persists (an adoption) while the fullscreen
 * return-to-sidebar exit does not (a return). The conditional `setMode` is
 * deliberate — do not "simplify" it away; the doc explains what that regresses.
 */
class PanelModeManager {
  private _pendingGuide: PendingGuide | null = null;
  private _priorPath: string | null = null;
  /**
   * In-memory current surface, and the single source of truth for whether a
   * transient auto-launch session is active (`_transientMode !== null`). When
   * non-null it wins over the persisted preference for `getMode()` and mount
   * decisions and is never written to localStorage. Set by an automatic launch
   * (`setModeTransient`) and by each conditional `setMode` during the session;
   * cleared by a deliberate `setModePersisted` (localStorage governs again) or
   * a page reload. Does not survive a reload.
   */
  private _transientMode: PanelMode | null = null;

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
   * Conditional mode change — the default path for automatic transitions
   * (teardown, auto-dock, self-heal, cold-load sync) and for deliberate
   * RETURN-to-base gestures (fullscreen back-arrow, floating close). Persists
   * to localStorage ONLY when no transient session is active; during a session
   * it updates the in-memory surface without touching the stored preference
   * (decision 2). Dispatches `pathfinder-panel-mode-change` and closes the
   * extension sidebar when switching to floating/fullscreen. Deliberate surface
   * ADOPTIONS must use `setModePersisted` — see the class-level contract.
   */
  public setMode(mode: PanelMode): void {
    this.applyModeChange(mode, (next) => {
      if (this._transientMode !== null) {
        this._transientMode = next;
      } else {
        localStorage.setItem(StorageKeys.PANEL_MODE, next);
      }
    });
  }

  /**
   * Deliberate surface ADOPTION (pop-out, switch-to-fullscreen, the floating
   * dock-to-sidebar pill, deep links). Always persists to localStorage, ends
   * any active transient session, and drops the in-memory override so
   * localStorage governs again. Runs the same side effects as `setMode`. See
   * decision 3 in the class-level contract for why the sidebar dock is an
   * adoption but the fullscreen exit is not.
   */
  public setModePersisted(mode: PanelMode): void {
    this.applyModeChange(mode, (next) => {
      this._transientMode = null;
      localStorage.setItem(StorageKeys.PANEL_MODE, next);
    });
  }

  /**
   * Automatic launch selection: a guide opened from My Learning chooses the
   * surface that fits its content. Records the surface in memory only and opens
   * a transient session; never persists, so the user's stored preference is
   * untouched (decision 2). The session ends only when a deliberate
   * `setModePersisted` runs or the page reloads. Runs the same side effects as
   * `setMode`; does not survive a reload.
   */
  public setModeTransient(mode: PanelMode): void {
    this.applyModeChange(mode, (next) => {
      this._transientMode = next;
    });
  }

  private applyModeChange(mode: PanelMode, commit: (mode: PanelMode) => void): void {
    const previous = this.getMode();

    // Record the new state first (idempotent) so `setModeTransient` opens the
    // session even when the surface does not visibly change — e.g. an auto-launch
    // to the surface that already matches the stored preference. Without this, a
    // later teardown would find no active session and persist over the user's
    // preference.
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
