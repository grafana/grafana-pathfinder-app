import { conditionTokens } from '../lib/condition-input';
import type { ConditionInput } from '../types/requirements.types';

export interface RecoveryStepInput {
  stepId: string;
  kind: string;
  targetAction?: string;
  refTarget?: string;
  targetState?: boolean | string;
  requirements?: ConditionInput;
  lazyRender?: boolean;
  opaqueBefore?: boolean;
}

export type RecoveryCondition =
  | { kind: 'requirement'; requirement: string }
  | { kind: 'target-present'; refTarget: string; targetAction: string }
  | { kind: 'target-state'; refTarget: string; targetAction: string; targetState: boolean | string }
  | { kind: 'resume-location' };

export type RecoveryAction =
  | { kind: 'resume-location'; objectives: RecoveryCondition[] }
  | {
      kind: 'toggle';
      refTarget: string;
      targetAction: string;
      targetState: boolean | string;
      objectives: RecoveryCondition[];
    };

export type RecoveryCheck = RecoveryCondition & { recover?: RecoveryAction[] };

export interface SectionRecoveryPlan {
  cursorStepId: string;
  cursorAction?: string;
  checks: RecoveryCheck[];
  key: string;
  setupStepId?: string;
}

type StepEffect = 'toggle' | 'transparent' | 'barrier';

const TARGETED_ACTIONS = new Set(['button', 'highlight', 'formfill', 'hover']);
const TRANSPARENT_ACTIONS = new Set(['formfill', 'hover', 'noop', 'popout']);
const TRANSPARENT_KINDS = new Set(['quiz', 'terminal', 'terminal-connect', 'codeblock']);

function hasTargetState(step: RecoveryStepInput): boolean {
  return step.targetState !== undefined && step.targetState !== '';
}

function effectOf(step: RecoveryStepInput, skipped: ReadonlySet<string>): StepEffect {
  if (skipped.has(step.stepId)) {
    return 'transparent';
  }
  if (TRANSPARENT_KINDS.has(step.kind)) {
    return 'transparent';
  }
  if (step.kind !== 'plain') {
    return 'barrier';
  }
  if ((step.targetAction === 'button' || step.targetAction === 'highlight') && hasTargetState(step)) {
    return step.lazyRender || !step.refTarget ? 'barrier' : 'toggle';
  }
  return TRANSPARENT_ACTIONS.has(step.targetAction ?? '') ? 'transparent' : 'barrier';
}

function stateAttribute(targetState: boolean | string): string {
  return typeof targetState === 'string' && targetState.includes(':') ? targetState.split(':')[0]!.trim() : '';
}

function priorToggles(
  steps: readonly RecoveryStepInput[],
  cursor: number,
  skipped: ReadonlySet<string>
): { toggles: RecoveryAction[]; barrierStepId?: string } {
  const toggles: RecoveryAction[] = [];
  const seen = new Set<string>();
  for (let index = cursor - 1; index >= 0 && !steps[index + 1]!.opaqueBefore; index--) {
    const step = steps[index]!;
    const effect = effectOf(step, skipped);
    if (effect === 'barrier') {
      return { toggles, barrierStepId: step.stepId };
    }
    if (effect !== 'toggle') {
      continue;
    }
    const refTarget = step.refTarget!;
    const targetAction = step.targetAction!;
    const targetState = step.targetState!;
    const identity = `${refTarget}\n${stateAttribute(targetState)}`;
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    toggles.unshift({
      kind: 'toggle',
      refTarget,
      targetAction,
      targetState,
      objectives: [{ kind: 'target-state', refTarget, targetAction, targetState }],
    });
  }
  return { toggles };
}

export function deriveSectionRecoveryPlan(
  steps: readonly RecoveryStepInput[],
  cursor: number,
  skipped: ReadonlySet<string>
): SectionRecoveryPlan | undefined {
  const step = steps[cursor];
  if (!step) {
    return undefined;
  }
  const checks: RecoveryCheck[] = conditionTokens(step.requirements)
    .filter((token) => token.startsWith('on-page:'))
    .map((requirement) => ({ kind: 'requirement', requirement }));
  let setupStepId: string | undefined;
  if (step.kind === 'plain' && TARGETED_ACTIONS.has(step.targetAction ?? '') && step.refTarget && !step.lazyRender) {
    const { toggles, barrierStepId } = priorToggles(steps, cursor, skipped);
    setupStepId = barrierStepId;
    checks.push({
      kind: 'target-present',
      refTarget: step.refTarget,
      targetAction: step.targetAction!,
      recover: [{ kind: 'resume-location', objectives: [{ kind: 'resume-location' }] }, ...toggles],
    });
  }
  if (checks.length === 0) {
    return undefined;
  }
  return {
    cursorStepId: step.stepId,
    cursorAction: step.kind === 'plain' ? step.targetAction : step.kind,
    checks,
    key: JSON.stringify([step.stepId, checks]),
    ...(setupStepId ? { setupStepId } : {}),
  };
}
