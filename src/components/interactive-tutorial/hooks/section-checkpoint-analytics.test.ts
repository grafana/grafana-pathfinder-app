import { reportSectionCheckpointEvent } from './section-checkpoint-analytics';
import { reportAppInteraction } from '../../../lib/analytics';

jest.mock('../../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: {
    SectionCheckpointPaused: 'section_checkpoint_paused',
    SectionCheckpointRestore: 'section_checkpoint_restore',
    SectionCheckpointUnverifiable: 'section_checkpoint_unverifiable',
  },
}));
jest.mock('../../../lib/logging', () => ({ logger: { warn: jest.fn() } }));

const checkpoint = {
  checks: [{ requirement: 'on-page:/explore' }, { target: '#options', state: 'expanded' as const, recover: [] }],
};
const paused = { kind: 'paused' as const, result: { passed: false, canRestore: true, checkIndex: 1 } };

beforeEach(() => jest.clearAllMocks());

it('names the section only for published guides', () => {
  reportSectionCheckpointEvent(paused, checkpoint, 'section-explore', {
    guideSource: 'bundled',
    guideId: 'explore-basics',
    sourceConfirmed: true,
  });
  expect(reportAppInteraction).toHaveBeenCalledWith('section_checkpoint_paused', {
    guide_source: 'bundled',
    guide_visibility: 'public',
    guide_id: 'explore-basics',
    section_id: 'section-explore',
    check_index: 1,
    check_kind: 'target',
    check_has_recipe: false,
    can_restore: true,
  });
});

it('sends no guide or section identity for a private guide', () => {
  reportSectionCheckpointEvent(
    {
      kind: 'restore',
      outcome: 'failed',
      durationMs: 412,
      result: { passed: false, canRestore: false, checkIndex: 0 },
    },
    checkpoint,
    'section-internal-runbook',
    { guideSource: 'app-platform', guideId: 'internal-runbook', sourceConfirmed: true }
  );
  const properties = jest.mocked(reportAppInteraction).mock.calls[0]![1];
  expect(properties).toEqual({
    guide_source: 'app-platform',
    guide_visibility: 'private',
    check_index: 0,
    check_kind: 'requirement',
    check_has_recipe: false,
    outcome: 'failed',
    duration_ms: 412,
  });
});

it('reports a cancelled restore without a check when none was evaluated', () => {
  reportSectionCheckpointEvent({ kind: 'restore', outcome: 'cancelled', durationMs: 90 }, checkpoint, 's', undefined);
  expect(reportAppInteraction).toHaveBeenCalledWith('section_checkpoint_restore', {
    guide_source: 'unresolved',
    guide_visibility: 'private',
    outcome: 'cancelled',
    duration_ms: 90,
  });
});

it('reports a check the guide cannot verify with its reason', () => {
  reportSectionCheckpointEvent(
    { kind: 'unverifiable', checkIndex: 1, reason: 'ambiguous' },
    checkpoint,
    's',
    undefined
  );
  expect(reportAppInteraction).toHaveBeenCalledWith('section_checkpoint_unverifiable', {
    guide_source: 'unresolved',
    guide_visibility: 'private',
    check_index: 1,
    check_kind: 'target',
    check_has_recipe: false,
    reason: 'ambiguous',
  });
});
