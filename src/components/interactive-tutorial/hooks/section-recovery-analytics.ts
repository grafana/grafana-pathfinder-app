import { reportAppInteraction, UserInteraction } from '../../../lib/analytics';
import { guideIdentityAnalyticsProperties } from '../../../completion-records';
import type { AnalyticsCompletionIdentity } from '../../../docs-retrieval';
import type { SectionRecoveryPlan } from '../../../recovery/section-recovery-plan';
import type { SectionRecoveryEvent } from './use-section-recovery';

export function reportSectionRecoveryEvent(
  event: SectionRecoveryEvent,
  plan: SectionRecoveryPlan | undefined,
  sectionId: string,
  identity: AnalyticsCompletionIdentity | undefined
): void {
  const guide = identity
    ? guideIdentityAnalyticsProperties({ kind: 'guide', ...identity })
    : { guide_source: 'unresolved', guide_visibility: 'private' };
  const properties = {
    ...guide,
    ...(guide.guide_visibility === 'public' ? { section_id: sectionId } : {}),
    ...(plan?.cursorAction ? { step_action: plan.cursorAction } : {}),
  };
  switch (event.kind) {
    case 'paused':
      reportAppInteraction(UserInteraction.SectionRecoveryPaused, {
        ...properties,
        trigger: event.check.kind === 'requirement' ? 'page' : 'target',
        recipe_length: (event.check.recover ?? []).filter((action) => action.kind === 'toggle').length,
        location_restore: event.locationRestore,
      });
      return;
    case 'restore':
      reportAppInteraction(UserInteraction.SectionRecoveryRestore, {
        ...properties,
        outcome: event.outcome,
        duration_ms: event.durationMs,
        ...(event.failure ? { failure_reason: event.failure } : {}),
      });
      return;
    case 'resolved':
      reportAppInteraction(UserInteraction.SectionRecoveryResolved, { ...properties, resolved_by: event.resolvedBy });
  }
}
