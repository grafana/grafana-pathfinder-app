/**
 * Project `pathfinder:progress` events (`kind: 'document'`) into a
 * "done/total" string for the shared panel header chip. The event refires
 * on completion changes, not just step execution, so the counter stays
 * fresh between steps. Returns `undefined` when no event has arrived or
 * `hasActiveGuide` is false (no stale chip on the recommendations tab).
 */

import { useEffect, useState } from 'react';

import { subscribeProgressEvent } from '../global-state/progress-events';

export function useStepProgressFromEvents(hasActiveGuide: boolean): string | undefined {
  const [stepProgress, setStepProgress] = useState<string | undefined>();

  useEffect(() => {
    if (!hasActiveGuide) {
      return;
    }

    return subscribeProgressEvent((detail) => {
      if (detail.kind !== 'document') {
        return;
      }
      const total = detail.totalSteps ?? 0;
      const done = detail.completedCount ?? 0;
      if (total > 0) {
        setStepProgress(`${done}/${total}`);
      } else {
        setStepProgress(undefined);
      }
    });
  }, [hasActiveGuide]);

  // Derive in render so `react-hooks/set-state-in-effect` stays clean.
  return hasActiveGuide ? stepProgress : undefined;
}
