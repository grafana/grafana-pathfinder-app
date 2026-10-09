// Progress events and completion correlation are opt-in; terminal events have their own guard.

import { reportAppInteraction, UserInteraction } from '../lib/analytics';
import { getFeatureFlagValue } from '../utils/openfeature';

import type { RegisteredGuideIdentity } from './guide-identity-registry';
import type { CompletionFact } from './types';

const PROGRESS_ANALYTICS_FLAG = 'pathfinder.progress-analytics';
const CROSSING_THRESHOLDS = [75, 50, 25] as const;

function isEnabled(): boolean {
  return getFeatureFlagValue(PROGRESS_ANALYTICS_FLAG, false);
}

function definedOnly(properties: Record<string, string | number | boolean | undefined>) {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * The threshold a progress step should report, or `null` for none. A fresh
 * attempt reports 0; afterwards only the highest of 25/50/75 crossed by this
 * step, so a single jump across several thresholds reports once and an
 * attempt reports at most four times.
 */
export function thresholdToReport(previous: number, next: number, minted: boolean): number | null {
  if (minted) {
    return 0;
  }
  return CROSSING_THRESHOLDS.find((threshold) => previous < threshold && threshold <= next) ?? null;
}

export function reportGuideProgress(
  identity: RegisteredGuideIdentity,
  attemptId: string,
  percent: number,
  threshold: number
): void {
  if (!isEnabled()) {
    return;
  }
  reportAppInteraction(
    UserInteraction.GuideProgress,
    definedOnly({
      guide_source: identity.guideSource,
      guide_id: identity.guideId,
      path_id: identity.pathId,
      percent,
      threshold,
      attempt_id: attemptId,
    })
  );
}

export function completionAttemptAnalyticsProperties(fact: CompletionFact): Record<string, string> {
  return fact.attemptId && isEnabled() ? { attempt_id: fact.attemptId } : {};
}
