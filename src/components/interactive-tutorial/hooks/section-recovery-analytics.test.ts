import { reportSectionRecoveryEvent } from './section-recovery-analytics';
import { reportAppInteraction } from '../../../lib/analytics';
import type { SectionRecoveryPlan } from '../../../recovery/section-recovery-plan';

jest.mock('../../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: {
    SectionRecoveryPaused: 'section_recovery_paused',
    SectionRecoveryRestore: 'section_recovery_restore',
    SectionRecoveryResolved: 'section_recovery_resolved',
  },
}));

const target = {
  kind: 'target-present' as const,
  refTarget: "button[aria-label='Run query']",
  targetAction: 'button',
  recover: [
    { kind: 'resume-location' as const, objectives: [] },
    {
      kind: 'toggle' as const,
      refTarget: '#row',
      targetAction: 'highlight',
      targetState: 'aria-expanded:true',
      objectives: [],
    },
  ],
};
const plan: SectionRecoveryPlan = { cursorStepId: 's2', cursorAction: 'button', checks: [target], key: 'k' };
const published = { guideSource: 'bundled', guideId: 'explore-basics', sourceConfirmed: true };

beforeEach(() => jest.clearAllMocks());

it('describes a pause without selectors, naming the section only for published guides', () => {
  reportSectionRecoveryEvent(
    { kind: 'paused', check: target, locationRestore: true },
    plan,
    'section-explore',
    published
  );
  expect(reportAppInteraction).toHaveBeenCalledWith('section_recovery_paused', {
    guide_source: 'bundled',
    guide_visibility: 'public',
    guide_id: 'explore-basics',
    section_id: 'section-explore',
    step_action: 'button',
    trigger: 'target',
    recipe_length: 1,
    location_restore: true,
  });
});

it('sends a private guide id but no section id', () => {
  reportSectionRecoveryEvent(
    { kind: 'restore', outcome: 'failed', durationMs: 412, failure: 'repair_failed' },
    plan,
    'section-internal-runbook',
    { guideSource: 'app-platform', guideId: 'internal-runbook', sourceConfirmed: true }
  );
  expect(reportAppInteraction).toHaveBeenCalledWith('section_recovery_restore', {
    guide_source: 'app_platform',
    guide_visibility: 'private',
    guide_id: 'internal-runbook',
    step_action: 'button',
    outcome: 'failed',
    duration_ms: 412,
    failure_reason: 'repair_failed',
  });
});

it('reports how a pause ended', () => {
  reportSectionRecoveryEvent({ kind: 'resolved', resolvedBy: 'self' }, undefined, 's', undefined);
  expect(reportAppInteraction).toHaveBeenCalledWith('section_recovery_resolved', {
    guide_source: 'unresolved',
    guide_visibility: 'private',
    resolved_by: 'self',
  });
});
