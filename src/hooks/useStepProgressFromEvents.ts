/**
 * Subscribe to the `pathfinder-step-progress` window event and project the
 * detail into a "done/total" string for the panel header chip.
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

interface StepProgressDetail {
  totalSteps?: number;
  completedCount?: number;
}

/** Numeric completed/total step counts for the active guide, or `undefined`. */
export interface StepProgressCounts {
  /** User-facing steps completed across the whole document. */
  done: number;
  /** Total user-facing steps in the document. */
  total: number;
}

/**
 * Numeric variant of {@link useStepProgressFromEvents}: returns the raw
 * completed/total step counts (clamped so `done <= total`) rather than a
 * formatted string. Both counts are in user-facing STEPS — the same unit the
 * "Step N of M" chip uses — so consumers stay consistent with what the reader
 * sees, not with internal content-block counts.
 */
export function useStepProgressCounts(hasActiveGuide: boolean): StepProgressCounts | undefined {
  const [counts, setCounts] = useState<StepProgressCounts | undefined>();

  useEffect(() => {
    if (!hasActiveGuide) {
      return;
    }

    const handle = (e: Event) => {
      const detail = (e as CustomEvent<StepProgressDetail>).detail;
      const total = detail?.totalSteps ?? 0;
      const done = detail?.completedCount ?? 0;
      if (total > 0) {
        setCounts({ done: Math.max(0, Math.min(done, total)), total });
      } else {
        setCounts(undefined);
      }
    };

    window.addEventListener('pathfinder-step-progress', handle);
    return () => {
      window.removeEventListener('pathfinder-step-progress', handle);
    };
  }, [hasActiveGuide]);

  // Derived in render rather than via setState in the effect so the
  // `react-hooks/set-state-in-effect` rule stays clean. Stale state from a
  // prior active session is hidden until the next event arrives — the chip
  // is meaningless without an active guide anyway.
  return hasActiveGuide ? counts : undefined;
}

export function useStepProgressFromEvents(hasActiveGuide: boolean): string | undefined {
  const counts = useStepProgressCounts(hasActiveGuide);
  return counts ? `${counts.done}/${counts.total}` : undefined;
}
