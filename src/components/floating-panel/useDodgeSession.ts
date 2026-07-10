import { useCallback, useEffect, useRef, useState } from 'react';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { waitForReactUpdates } from '../../lib/async-utils';
import { FloatingPanelEvents, type FloatingPanelMoveDetail } from '../../lib/event-names';
import {
  createInitialDodgeSession,
  dodgeSessionReducer,
  type DodgeSessionAction,
  type DodgeSessionState,
  type FloatingPanelView,
} from './dodge-session';

/**
 * Adapter between the pure dodge-session reducer and the DOM: owns the
 * document-level pathfinder-floating-* listeners, the scrollable content
 * ref, the deferred token-gated scroll write, and the dodge flash/analytics
 * timers that FloatingPanel previously managed inline.
 */
export function useDodgeSession(setPosition: (x: number, y: number) => void): {
  view: FloatingPanelView;
  isDodging: boolean;
  contentRef: React.RefObject<HTMLDivElement>;
  minimize: () => void;
  restoreFromPill: () => void;
} {
  const [session, setSession] = useState<DodgeSessionState>(createInitialDodgeSession);
  const sessionRef = useRef(session);
  const contentRef = useRef<HTMLDivElement>(null);
  const [isDodging, setIsDodging] = useState(false);
  const dodgeTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  // Synchronous dispatch: handlers need the next state immediately (to know
  // whether a scroll write was scheduled and under which token), so the
  // reducer is applied to a ref before setState. Must only be called from
  // event/promise callbacks or effect cleanup — calling during render would double-apply
  // actions under StrictMode.
  const dispatch = useCallback((action: DodgeSessionAction, commit = true): DodgeSessionState => {
    const next = dodgeSessionReducer(sessionRef.current, action);
    sessionRef.current = next;
    if (commit) {
      setSession(next);
    }
    return next;
  }, []);

  const restoreFull = useCallback(() => {
    const next = dispatch({ type: 'RESTORE_FULL' });
    if (next.restoreScroll !== 'scheduled' || next.savedScrollTop === null) {
      return;
    }
    const { restoreToken: token, savedScrollTop } = next;
    waitForReactUpdates().then(() => {
      if (sessionRef.current.restoreToken !== token) {
        return;
      }
      if (contentRef.current) {
        contentRef.current.scrollTop = savedScrollTop;
      }
      dispatch({ type: 'SCROLL_RESTORE_LANDED', token });
    });
  }, [dispatch]);

  const minimize = useCallback(() => {
    dispatch({ type: 'MINIMIZE' });
  }, [dispatch]);

  useEffect(() => {
    const handleDodge = (e: CustomEvent<FloatingPanelMoveDetail>) => {
      setIsDodging(true);
      setPosition(e.detail.x, e.detail.y);
      dodgeTimersRef.current.forEach(clearTimeout);
      dodgeTimersRef.current = [];
      // Report the move after the position transition completes
      dodgeTimersRef.current.push(
        setTimeout(() => {
          reportAppInteraction(UserInteraction.FloatingPanelMoved, {
            trigger: 'highlight_dodge',
            x: e.detail.x,
            y: e.detail.y,
          });
        }, 250)
      );
      // Keep the border flash visible for 1s so the user notices the move
      dodgeTimersRef.current.push(
        setTimeout(() => {
          setIsDodging(false);
        }, 1000)
      );
    };

    const handleCompact = () => {
      dispatch({ type: 'COMPACT', measuredScrollTop: contentRef.current?.scrollTop ?? null });
    };

    const handleRestorePosition = (e: CustomEvent<FloatingPanelMoveDetail>) => {
      setPosition(e.detail.x, e.detail.y);
    };

    const handleRestoreFull = () => {
      restoreFull();
    };

    document.addEventListener(FloatingPanelEvents.Dodge, handleDodge as EventListener);
    document.addEventListener(FloatingPanelEvents.RestorePosition, handleRestorePosition as EventListener);
    document.addEventListener(FloatingPanelEvents.Compact, handleCompact);
    document.addEventListener(FloatingPanelEvents.RestoreFull, handleRestoreFull);

    return () => {
      dispatch({ type: 'CANCEL_PENDING_RESTORE' }, false);
      document.removeEventListener(FloatingPanelEvents.Dodge, handleDodge as EventListener);
      document.removeEventListener(FloatingPanelEvents.RestorePosition, handleRestorePosition as EventListener);
      document.removeEventListener(FloatingPanelEvents.Compact, handleCompact);
      document.removeEventListener(FloatingPanelEvents.RestoreFull, handleRestoreFull);
      dodgeTimersRef.current.forEach(clearTimeout);
      dodgeTimersRef.current = [];
    };
  }, [setPosition, dispatch, restoreFull]);

  return {
    view: session.view,
    isDodging,
    contentRef,
    minimize,
    restoreFromPill: restoreFull,
  };
}
