/**
 * Detects a `?session=…` URL parameter on mount and either:
 *   - opens the attendee-join modal (when live sessions are enabled), or
 *   - publishes a warning toast explaining the feature is disabled on this
 *     Grafana instance.
 *
 * The effect re-runs when `isLiveSessionsEnabled` flips so a configuration
 * change after mount still routes correctly.
 */
import * as React from 'react';
import { getAppEvents } from '@grafana/runtime';

export interface UseSessionJoinUrlCheckParams {
  isLiveSessionsEnabled: boolean | undefined;
  onShowAttendeeJoin: () => void;
}

export function useSessionJoinUrlCheck({
  isLiveSessionsEnabled,
  onShowAttendeeJoin,
}: UseSessionJoinUrlCheckParams): void {
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('session')) {
      return;
    }
    if (!isLiveSessionsEnabled) {
      getAppEvents().publish({
        type: 'alert-warning',
        payload: [
          'Live sessions disabled',
          'Live sessions are disabled on this Grafana instance. Ask your administrator to enable them in the Pathfinder plugin configuration.',
        ],
      });
      return;
    }
    onShowAttendeeJoin();
    // The onShowAttendeeJoin callback is intentionally not in the dep array:
    // it's a setState setter (stable by React contract), and including it
    // would cause the warning to re-fire if a caller passes an unstable
    // callback by accident.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLiveSessionsEnabled]);
}
