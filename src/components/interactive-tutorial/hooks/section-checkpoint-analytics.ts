import { reportAppInteraction, UserInteraction } from '../../../lib/analytics';
import { logger } from '../../../lib/logging';
import { guideIdentityAnalyticsProperties } from '../../../completion-records';
import type { AnalyticsCompletionIdentity } from '../../../docs-retrieval';
import type { JsonSectionCheckpoint } from '../../../types/json-guide.types';
import type { SectionCheckpointEvent } from './use-section-checkpoint';

export function reportSectionCheckpointEvent(
  event: SectionCheckpointEvent,
  checkpoint: JsonSectionCheckpoint,
  sectionId: string,
  identity: AnalyticsCompletionIdentity | undefined
): void {
  const guide = identity
    ? guideIdentityAnalyticsProperties({ kind: 'guide', ...identity })
    : { guide_source: 'unresolved', guide_visibility: 'private' };
  const checkIndex = event.kind === 'unverifiable' ? event.checkIndex : event.result?.checkIndex;
  const check = checkIndex === undefined ? undefined : checkpoint.checks[checkIndex];
  const properties = {
    ...guide,
    ...(guide.guide_visibility === 'public' ? { section_id: sectionId } : {}),
    ...(check && checkIndex !== undefined
      ? {
          check_index: checkIndex,
          check_kind: 'requirement' in check ? 'requirement' : 'target',
          check_has_recipe: Boolean(check.recover?.length),
        }
      : {}),
  };
  if (event.kind === 'unverifiable') {
    logger.warn(
      `Checkpoint check ${event.checkIndex} in section "${sectionId}" cannot be verified (${event.reason}); it no longer gates the section.`
    );
    reportAppInteraction(UserInteraction.SectionCheckpointUnverifiable, { ...properties, reason: event.reason });
    return;
  }
  if (event.kind === 'paused') {
    reportAppInteraction(UserInteraction.SectionCheckpointPaused, {
      ...properties,
      can_restore: event.result.canRestore,
    });
    return;
  }
  reportAppInteraction(UserInteraction.SectionCheckpointRestore, {
    ...properties,
    outcome: event.outcome,
    duration_ms: event.durationMs,
  });
}
