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
  private _titleListener: ((title: string) => void) | null = null;

  getIsActive(): boolean {
    return this._isActive;
  }

  setIsActive(active: boolean): void {
    this._isActive = active;
  }

  /** Notify the page title subscriber when the loaded guide title changes. */
  setTitle(title: string): void {
    this._titleListener?.(title);
  }

  /**
   * Register a listener that is called whenever the guide title changes.
   * Intended for use by learningPage to keep SceneAppPage.title in sync.
   * Returns an unsubscribe function.
   */
  onTitleChange(listener: (title: string) => void): () => void {
    this._titleListener = listener;
    return () => {
      this._titleListener = null;
    };
  }
}

export const mainAreaLearningState = new MainAreaLearningState();
