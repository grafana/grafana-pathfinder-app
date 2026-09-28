export interface StepDecisionInput {
  alignmentPaused: boolean;
  eligible: boolean;
  hasObjectives: boolean;
  objectivesPassed?: boolean;
  hasRequirements: boolean;
}

export function decideStepCheck(
  input: StepDecisionInput
): 'blocked' | 'check-objectives' | 'completed' | 'check-requirements' | 'enabled' {
  if (input.alignmentPaused) {
    return 'blocked';
  }
  if (input.hasObjectives && input.objectivesPassed === undefined) {
    return 'check-objectives';
  }
  if (input.hasObjectives && input.objectivesPassed) {
    return 'completed';
  }
  if (!input.eligible) {
    return 'blocked';
  }
  return input.hasRequirements ? 'check-requirements' : 'enabled';
}
