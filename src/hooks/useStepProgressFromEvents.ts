/**
 * Subscribe to the unified `pathfinder:progress` window event (variant
 * `kind: 'document'`) and project the detail into a "done/total" string
 * for the panel header chip.
 *
 * Why this exists: identical 20-line subscription used to live in both
 * `FullScreenPanel` and `FloatingPanelManager`. The previous polling on
 * `__DocsPluginCurrentStepIndex` only updated while a step was *executing*,
 * so the chip went stale immediately after each step finished. The event
 * is published by `interactive-section` whenever execution OR completion
 * state changes, so listening for it gives us a counter that reflects
 * "completed / total" instead of a moving cursor.
 *
 * The hook returns `undefined` when no progress has been observed yet, or
 * when `hasActiveGuide` flips to false (the chip is meaningless without an
 * active guide and we don't want a stale value lingering on the recommendations
 * tab).
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

  // Derived in render rather than via setState in the effect so the
  // `react-hooks/set-state-in-effect` rule stays clean. Stale state from a
  // prior active session is hidden until the next event arrives — the chip
  // is meaningless without an active guide anyway.
  return hasActiveGuide ? stepProgress : undefined;
}
