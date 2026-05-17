/**
 * Dev-mode-scoped logger.
 *
 * Returns a referentially-stable `logSession` callback that emits to
 * `console.log` only when `isDevMode` is true. The callback identity does
 * not change when `isDevMode` toggles — the latest `isDevMode` value is
 * read through a ref — so effects depending on `logSession` do not re-run.
 *
 * Security: dev-mode-scoped logging keeps potentially sensitive user data
 * (session ids, attendee names, replay events) out of production console
 * output. Do not change the gating to a non-ref read, or every dev-mode
 * toggle would re-fire every effect with `logSession` in its dep array.
 */
import * as React from 'react';

export type LogSession = (...args: unknown[]) => void;

export function useDevModeLogger(isDevMode: boolean): LogSession {
  const logSessionRef = React.useRef<LogSession>((...args: unknown[]) => {
    if (isDevMode) {
      console.log(...args);
    }
  });
  // Refresh the ref via layout effect (not during render) so the closure
  // always sees the latest isDevMode value. The callback identity returned
  // below remains stable across renders.
  React.useLayoutEffect(() => {
    logSessionRef.current = (...args: unknown[]) => {
      if (isDevMode) {
        console.log(...args);
      }
    };
  });
  return React.useCallback((...args: unknown[]) => {
    logSessionRef.current(...args);
  }, []);
}
