import { evictAllContentCaches, getSectionSkippedSteps, markStepCompleted } from './completion-store';

afterEach(() => evictAllContentCaches());

it('reads which completed steps in a section were skipped', () => {
  markStepCompleted('skipped-step', 'recovery-section', 'skipped');
  markStepCompleted('done-step', 'recovery-section', 'manual');
  markStepCompleted('other-skip', 'other-section', 'skipped');
  expect(getSectionSkippedSteps('recovery-section', new Set(['skipped-step', 'done-step']))).toEqual(
    new Set(['skipped-step'])
  );
  expect(getSectionSkippedSteps('empty-section', new Set())).toEqual(new Set());
});
