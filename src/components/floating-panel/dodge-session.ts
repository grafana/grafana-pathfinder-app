/**
 * Dodge session state machine
 *
 * Explicit transactional state for the floating panel's highlight-dodge
 * compact/restore lifecycle.
 *
 * The contract this module enforces: while a dodge session holds a saved
 * scroll position, browser layout-derived values like scrollTop are NOT
 * authoritative — compact mode collapses the scroll container and minimize
 * hides it with display:none; both clamp scrollTop to 0, a layout artifact,
 * not user intent. A measured scrollTop is only adopted when no session
 * scroll is already saved, and a deferred scroll write only lands when its
 * token is still current.
 *
 * Ownership boundary: the pre-dodge *position* restore target stays in
 * useHighlightDodge (retargeted by manual drag); position restores apply
 * synchronously and are never deferred, so they need no session state.
 * This session owns view + scroll + staleness token only.
 */

export type FloatingPanelView = 'full' | 'compact' | 'minimized';

export interface DodgeSessionState {
  view: FloatingPanelView;
  /** The only authoritative scroll value while a session is active. */
  savedScrollTop: number | null;
  /** Bumps on every action that stales a pending deferred scroll write. */
  restoreToken: number;
}

export type DodgeSessionAction =
  | { type: 'COMPACT'; measuredScrollTop: number | null }
  | { type: 'RESTORE_FULL' }
  | { type: 'MINIMIZE'; measuredScrollTop: number | null }
  | { type: 'SCROLL_RESTORE_LANDED'; token: number };

export function createInitialDodgeSession(): DodgeSessionState {
  return {
    view: 'full',
    savedScrollTop: null,
    restoreToken: 0,
  };
}

export function dodgeSessionReducer(state: DodgeSessionState, action: DodgeSessionAction): DodgeSessionState {
  switch (action.type) {
    case 'COMPACT':
      return {
        view: 'compact',
        savedScrollTop: state.savedScrollTop ?? action.measuredScrollTop,
        restoreToken: state.restoreToken + 1,
      };

    case 'RESTORE_FULL':
      if (state.savedScrollTop === null) {
        return state.view === 'full' ? state : { ...state, view: 'full' };
      }
      return {
        ...state,
        view: 'full',
        restoreToken: state.restoreToken + 1,
      };

    case 'MINIMIZE':
      return {
        view: 'minimized',
        savedScrollTop: state.savedScrollTop ?? action.measuredScrollTop,
        restoreToken: state.restoreToken + 1,
      };

    case 'SCROLL_RESTORE_LANDED':
      if (state.savedScrollTop === null || action.token !== state.restoreToken) {
        return state;
      }
      return {
        ...state,
        savedScrollTop: null,
      };

    default: {
      // Exhaustiveness check: adding a DodgeSessionAction variant without
      // handling it above fails to compile here.
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}
