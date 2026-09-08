import { decideStepCheck, type StepDecisionInput } from './step-decision';

const initial: StepDecisionInput = {
  alignmentPaused: false,
  eligible: true,
  hasObjectives: true,
  hasRequirements: true,
};

it.each<[Partial<StepDecisionInput>, ReturnType<typeof decideStepCheck>]>([
  [{ alignmentPaused: true, objectivesPassed: true }, 'blocked'],
  [{ eligible: false }, 'check-objectives'],
  [{ eligible: false, objectivesPassed: true }, 'completed'],
  [{ eligible: false, objectivesPassed: false }, 'blocked'],
  [{ objectivesPassed: false }, 'check-requirements'],
  [{ hasObjectives: false }, 'check-requirements'],
  [{ hasObjectives: false, hasRequirements: false }, 'enabled'],
  [{ hasObjectives: false, objectivesPassed: true, hasRequirements: false }, 'enabled'],
])('preserves the phase priority for %j', (input, decision) => {
  expect(decideStepCheck({ ...initial, ...input })).toBe(decision);
});
