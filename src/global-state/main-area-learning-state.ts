/**
 * Global state for the main-area learning view.
 *
 * Tracks whether the /learning route is currently active, enabling
 * context-aware link interception routing. When active, intercepted
 * doc links are routed to the main area instead of the sidebar.
 *
 * Analogous to sidebarState (src/global-state/sidebar.ts).
 */

class MainAreaLearningState {
  private _isActive = false;

  getIsActive(): boolean {
    return this._isActive;
  }

  setIsActive(active: boolean): void {
    this._isActive = active;
  }
}

export const mainAreaLearningState = new MainAreaLearningState();
