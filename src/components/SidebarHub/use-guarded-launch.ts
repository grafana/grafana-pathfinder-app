import { useCallback, useEffect, useRef, useState } from 'react';
import { getAppEvents } from '@grafana/runtime';
import { t } from '@grafana/i18n';
import { logger } from '../../lib/logging';

/** Runs one launch at a time and turns a failed launch into an error toast instead of an unhandled rejection. */
export function useGuardedLaunch() {
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (launch: () => void | Promise<void>) => {
    if (locked.current) {
      return;
    }
    locked.current = true;
    setPending(true);
    try {
      await launch();
    } catch (error) {
      logger.error('[SidebarHub] Guide launch failed', { error });
      getAppEvents().publish({
        type: 'alert-error',
        payload: [
          t('myLearning.launchErrorTitle', 'Could not open the guide'),
          t('myLearning.launchErrorMessage', 'Something went wrong while loading the guide. Please try again.'),
        ],
      });
    } finally {
      locked.current = false;
      if (mounted.current) {
        setPending(false);
      }
    }
  }, []);

  return { pending, run };
}
