import { getResumeInfo, computeStepEligibility } from './step-section-utils';
import type { StepInfo } from '../../types/component-props.types';

// Minimal StepInfo factory — only fields used by these utilities
function makeStep(id: string, targetAction?: string): StepInfo {
  return {
    stepId: id,
    element: null as any,
    index: 0,
    targetAction,
    isMultiStep: false,
    isGuided: false,
  };
}

const real = (id: string) => makeStep(id, 'click');
const noop = (id: string) => makeStep(id, 'noop');

// ─── getResumeInfo ────────────────────────────────────────────────────────────

describe('getResumeInfo', () => {
  it('returns zeroed state for an empty section', () => {
    expect(getResumeInfo([], 0)).toEqual({ nextStepIndex: 0, remainingSteps: 0, isResume: false });
  });

  it('returns isResume: false and full interactive count at the start', () => {
    const steps = [real('a'), real('b'), real('c')];
    expect(getResumeInfo(steps, 0)).toEqual({ nextStepIndex: 0, remainingSteps: 3, isResume: false });
  });

  it('returns isResume: true when partially through a section', () => {
    const steps = [real('a'), real('b'), real('c')];
    const result = getResumeInfo(steps, 1);
    expect(result).toEqual({ nextStepIndex: 1, remainingSteps: 2, isResume: true });
  });

  it('excludes noop steps from remainingSteps count', () => {
    // The regression: 3 real + 2 noop steps should show 3, not 5
    const steps = [noop('n1'), real('a'), noop('n2'), real('b'), real('c')];
    expect(getResumeInfo(steps, 0).remainingSteps).toBe(3);
  });

  it('excludes noop steps ahead of currentStepIndex when resuming', () => {
    const steps = [real('a'), noop('n1'), real('b'), noop('n2'), real('c')];
    // Resuming from index 1 (n1): remaining real steps after index 1 are b and c
    expect(getResumeInfo(steps, 1).remainingSteps).toBe(2);
  });

  it('returns remainingSteps: 0 when all noop steps', () => {
    const steps = [noop('n1'), noop('n2'), noop('n3')];
    expect(getResumeInfo(steps, 0).remainingSteps).toBe(0);
  });

  it('returns remainingSteps: 0 when all steps are completed', () => {
    const steps = [real('a'), real('b')];
    // currentStepIndex beyond end signals all completed
    const result = getResumeInfo(steps, steps.length);
    expect(result).toEqual({ nextStepIndex: 2, remainingSteps: 0, isResume: false });
  });
});

// ─── computeStepEligibility ───────────────────────────────────────────────────

describe('computeStepEligibility', () => {
  it('returns empty array for empty steps', () => {
    expect(computeStepEligibility([], new Set())).toEqual([]);
  });

  it('marks only the first step eligible when none are completed', () => {
    const steps = [real('a'), real('b'), real('c')];
    expect(computeStepEligibility(steps, new Set())).toEqual([true, false, false]);
  });

  it('unlocks the next step when the previous is completed', () => {
    const steps = [real('a'), real('b'), real('c')];
    expect(computeStepEligibility(steps, new Set(['a']))).toEqual([true, true, false]);
  });

  it('marks all steps eligible when all are completed', () => {
    const steps = [real('a'), real('b'), real('c')];
    expect(computeStepEligibility(steps, new Set(['a', 'b', 'c']))).toEqual([true, true, true]);
  });

  it('treats noop steps as always complete for eligibility', () => {
    // noop at index 0 means index 1 is immediately eligible even with no completions
    const steps = [noop('n1'), real('b'), real('c')];
    expect(computeStepEligibility(steps, new Set())).toEqual([true, true, false]);
  });

  it('treats consecutive noops as always complete', () => {
    const steps = [noop('n1'), noop('n2'), real('c')];
    expect(computeStepEligibility(steps, new Set())).toEqual([true, true, true]);
  });

  it('noop steps are still gated by preceding incomplete real steps', () => {
    const steps = [real('a'), noop('n1'), real('b'), real('c')];
    // 'a' not completed → n1, b, c all locked
    expect(computeStepEligibility(steps, new Set())).toEqual([true, false, false, false]);
    // Complete 'a' → n1 unlocks; n1 is noop so b unlocks too; c still locked
    expect(computeStepEligibility(steps, new Set(['a']))).toEqual([true, true, true, false]);
  });
});
