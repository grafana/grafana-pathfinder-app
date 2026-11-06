interface WorkflowAction {
  targetAction?: string;
  refTarget?: string;
  targetValue?: string;
  requirements?: readonly string[];
}

export const CLOUD_TOKEN_OBJECTIVE = 'workflow-ready:cloud-access-policy-token';

const tokenNameTargets = new Set(['#tokenName', '[data-testid="generate-token-name-input"]']);
const tokenSubmitTarget = '[data-testid="generate-token-submit-button"]';

const workflows = [
  {
    objective: CLOUD_TOKEN_OBJECTIVE,
    matches: (actions: readonly WorkflowAction[]) => {
      const last = actions[actions.length - 1];
      if (!last || last.targetAction !== 'button' || last.targetValue) {
        return false;
      }
      if (actions.length === 1) {
        return last.refTarget === tokenSubmitTarget;
      }
      const first = actions[0]!;
      return (
        actions.length === 2 &&
        first.targetAction === 'formfill' &&
        tokenNameTargets.has(first.refTarget ?? '') &&
        !first.targetValue &&
        (last.refTarget === 'Create token' || last.refTarget === tokenSubmitTarget)
      );
    },
  },
];

export function inferWorkflowObjectives(
  actions: readonly WorkflowAction[],
  requirements: readonly string[] = []
): string[] | undefined {
  const pages = new Set(
    [...requirements, ...actions.flatMap((action) => action.requirements ?? [])].filter((condition) =>
      condition.startsWith('on-page:/a/')
    )
  );
  if (pages.size !== 1) {
    return undefined;
  }
  const workflow = workflows.find((candidate) => candidate.matches(actions));
  return workflow ? [...pages, workflow.objective] : undefined;
}
