import { getResumeInfo, computeStepEligibility, analyzeAcknowledgement } from './step-section-utils';
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

// ─── analyzeAcknowledgement (issue #842) ──────────────────────────────────────

describe('analyzeAcknowledgement', () => {
  it('returns no acknowledgement needed for an empty section', () => {
    expect(analyzeAcknowledgement([])).toEqual({ needsAcknowledgement: false, isAllPassive: false });
  });

  it('returns no acknowledgement needed when the section has only interactives', () => {
    expect(analyzeAcknowledgement(['interactive', 'interactive', 'interactive'])).toEqual({
      needsAcknowledgement: false,
      isAllPassive: false,
    });
  });

  it('does not require acknowledgement when passive content is purely interior', () => {
    // markdown, interactive, interactive — read naturally before the last action
    expect(analyzeAcknowledgement(['passive', 'interactive', 'interactive'])).toEqual({
      needsAcknowledgement: false,
      isAllPassive: false,
    });
  });

  it('does not require acknowledgement for passive content sandwiched between interactives', () => {
    expect(analyzeAcknowledgement(['interactive', 'passive', 'interactive'])).toEqual({
      needsAcknowledgement: false,
      isAllPassive: false,
    });
  });

  it('requires acknowledgement for trailing passive content after the last interactive', () => {
    // The core issue: interactive, interactive, markdown, markdown
    expect(analyzeAcknowledgement(['interactive', 'interactive', 'passive', 'passive'])).toEqual({
      needsAcknowledgement: true,
      isAllPassive: false,
    });
  });

  it('requires acknowledgement for a single trailing noop step', () => {
    expect(analyzeAcknowledgement(['interactive', 'passive'])).toEqual({
      needsAcknowledgement: true,
      isAllPassive: false,
    });
  });

  it('flags a section composed entirely of passive content as both needing acknowledgement and all-passive', () => {
    expect(analyzeAcknowledgement(['passive', 'passive', 'passive'])).toEqual({
      needsAcknowledgement: true,
      isAllPassive: true,
    });
  });

  it('treats ignored children (whitespace text nodes, booleans) as invisible', () => {
    // ignore between two interactives should not be misread as trailing passive
    expect(analyzeAcknowledgement(['interactive', 'ignore', 'interactive'])).toEqual({
      needsAcknowledgement: false,
      isAllPassive: false,
    });
    // ignore after the last interactive should not force acknowledgement either
    expect(analyzeAcknowledgement(['interactive', 'ignore'])).toEqual({
      needsAcknowledgement: false,
      isAllPassive: false,
    });
  });

  it('handles mixed interior + trailing passive correctly', () => {
    expect(analyzeAcknowledgement(['passive', 'interactive', 'passive', 'interactive', 'passive'])).toEqual({
      needsAcknowledgement: true,
      isAllPassive: false,
    });
  });
});
