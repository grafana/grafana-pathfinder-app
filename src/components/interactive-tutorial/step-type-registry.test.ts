/**
 * PERMANENT — unit tests for the step-type schema registry.
 *
 * These tests verify each schema entry's `toStepInfoExtension` and
 * `toEnhancedProps` against synthetic props/contexts. They are
 * permanent (not disposable like the Phase 0 tripwires) because they
 * cover the registry's own contract, not transient behaviour during
 * an extraction.
 */

import {
  CHALLENGE_BLOCK_SCHEMA,
  STEP_TYPE_SCHEMAS,
  INTERACTIVE_STEP_SCHEMA,
  INTERACTIVE_MULTISTEP_SCHEMA,
  INTERACTIVE_GUIDED_SCHEMA,
  INTERACTIVE_QUIZ_SCHEMA,
  TERMINAL_STEP_SCHEMA,
  TERMINAL_CONNECT_STEP_SCHEMA,
  CODE_BLOCK_STEP_SCHEMA,
  type EnhanceContext,
  type StepTypeSchema,
} from './step-type-registry';
import type { StepInfo } from '../../types/component-props.types';

function makeStepInfo(overrides: Partial<StepInfo> = {}): StepInfo {
  return {
    stepId: 'section-test-step-1',
    element: { type: 'div', props: {}, key: null } as any,
    index: 0,
    isMultiStep: false,
    isGuided: false,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<EnhanceContext> = {}): EnhanceContext {
  return {
    stepInfo: makeStepInfo(),
    isEligibleForChecking: true,
    isCurrentlyExecuting: false,
    documentStepIndex: 5,
    documentTotalSteps: 12,
    sectionId: 'section-test',
    sectionTitle: 'Test section',
    baseDisabled: false,
    isRunning: false,
    sectionRequirementsPassed: true,
    resetTrigger: 0,
    onStepComplete: jest.fn(),
    onStepReset: jest.fn(),
    ...overrides,
  };
}

describe('step-type-registry', () => {
  describe('STEP_TYPE_SCHEMAS array', () => {
    it('contains every tracked step-type schema in fixed order', () => {
      const kinds = STEP_TYPE_SCHEMAS.map((s) => s.kind);
      expect(kinds).toEqual([
        'plain',
        'multistep',
        'guided',
        'quiz',
        'terminal',
        'terminal-connect',
        'codeblock',
        'challenge',
      ]);
    });

    it('every schema has a unique idPrefix', () => {
      const prefixes = STEP_TYPE_SCHEMAS.map((s) => s.idPrefix);
      expect(new Set(prefixes).size).toBe(prefixes.length);
    });
  });

  describe('INTERACTIVE_STEP_SCHEMA (plain)', () => {
    it('toStepInfoExtension maps props 1:1 with isMultiStep=false, isGuided=false', () => {
      const ext = INTERACTIVE_STEP_SCHEMA.toStepInfoExtension({
        targetAction: 'highlight',
        refTarget: '.foo',
        targetValue: 'bar',
        targetComment: 'see foo',
        requirements: 'logged-in',
        postVerify: 'data-x=1',
        skippable: true,
        showMe: false,
      });
      expect(ext).toEqual({
        targetAction: 'highlight',
        refTarget: '.foo',
        targetValue: 'bar',
        targetComment: 'see foo',
        requirements: 'logged-in',
        postVerify: 'data-x=1',
        skippable: true,
        showMe: false,
        isMultiStep: false,
        isGuided: false,
      });
    });

    it('toEnhancedProps emits the full plain-step prop surface', () => {
      const ctx = makeCtx();
      const props = INTERACTIVE_STEP_SCHEMA.toEnhancedProps(ctx);
      expect(props).toEqual({
        stepId: 'section-test-step-1',
        isEligibleForChecking: true,
        isCurrentlyExecuting: false,
        onStepComplete: ctx.onStepComplete,
        stepIndex: 5,
        totalSteps: 12,
        sectionId: 'section-test',
        sectionTitle: 'Test section',
        onStepReset: ctx.onStepReset,
        disabled: false,
        resetTrigger: 0,
      });
    });

    it('disabled formula: ORs baseDisabled', () => {
      const props = INTERACTIVE_STEP_SCHEMA.toEnhancedProps(makeCtx({ baseDisabled: true }));
      expect(props.disabled).toBe(true);
    });

    it('disabled formula: ORs failing section requirements', () => {
      const props = INTERACTIVE_STEP_SCHEMA.toEnhancedProps(makeCtx({ sectionRequirementsPassed: false }));
      expect(props.disabled).toBe(true);
    });

    it('disabled formula: ORs (isRunning && !isCurrentlyExecuting)', () => {
      // Section is running and this step is NOT the currently executing one → disabled.
      const propsA = INTERACTIVE_STEP_SCHEMA.toEnhancedProps(makeCtx({ isRunning: true, isCurrentlyExecuting: false }));
      expect(propsA.disabled).toBe(true);
      // Section is running and this step IS the currently executing one → enabled.
      const propsB = INTERACTIVE_STEP_SCHEMA.toEnhancedProps(makeCtx({ isRunning: true, isCurrentlyExecuting: true }));
      expect(propsB.disabled).toBe(false);
    });

    it('refTarget is "stepRefs"', () => {
      expect(INTERACTIVE_STEP_SCHEMA.refTarget).toBe('stepRefs');
    });
  });

  describe('INTERACTIVE_MULTISTEP_SCHEMA', () => {
    it('toStepInfoExtension blanks targetAction/refTarget/targetValue and sets isMultiStep=true', () => {
      const ext = INTERACTIVE_MULTISTEP_SCHEMA.toStepInfoExtension({
        targetAction: 'should-be-ignored',
        refTarget: '.ignored',
        targetValue: 'ignored',
        requirements: 'r',
        skippable: false,
      });
      expect(ext).toEqual({
        targetAction: undefined,
        refTarget: undefined,
        targetValue: undefined,
        requirements: 'r',
        skippable: false,
        isMultiStep: true,
        isGuided: false,
      });
    });

    it('refTarget is "multiStepRefs"', () => {
      expect(INTERACTIVE_MULTISTEP_SCHEMA.refTarget).toBe('multiStepRefs');
    });

    it('toEnhancedProps surface matches the plain step (shared formula)', () => {
      expect(INTERACTIVE_MULTISTEP_SCHEMA.toEnhancedProps).toBe(INTERACTIVE_STEP_SCHEMA.toEnhancedProps);
    });
  });

  describe('INTERACTIVE_GUIDED_SCHEMA', () => {
    it('toStepInfoExtension sets isGuided=true', () => {
      const ext = INTERACTIVE_GUIDED_SCHEMA.toStepInfoExtension({ requirements: 'r' });
      expect(ext.isGuided).toBe(true);
      expect(ext.isMultiStep).toBe(false);
    });

    it('refTarget is "multiStepRefs" (guided refs share the multi-step ref bag)', () => {
      expect(INTERACTIVE_GUIDED_SCHEMA.refTarget).toBe('multiStepRefs');
    });
  });

  describe('INTERACTIVE_QUIZ_SCHEMA', () => {
    it('toStepInfoExtension sets isQuiz=true', () => {
      const ext = INTERACTIVE_QUIZ_SCHEMA.toStepInfoExtension({ requirements: 'r', skippable: true });
      expect(ext).toMatchObject({ isMultiStep: false, isGuided: false, isQuiz: true });
    });

    it('refTarget is "none"', () => {
      expect(INTERACTIVE_QUIZ_SCHEMA.refTarget).toBe('none');
    });

    it('toEnhancedProps omits isCurrentlyExecuting and onStepReset', () => {
      const props = INTERACTIVE_QUIZ_SCHEMA.toEnhancedProps(makeCtx({ isCurrentlyExecuting: true }));
      expect('isCurrentlyExecuting' in props).toBe(false);
      expect('onStepReset' in props).toBe(false);
    });

    it('disabled formula is simple — ignores sectionRequirementsPassed and isRunning', () => {
      const a = INTERACTIVE_QUIZ_SCHEMA.toEnhancedProps(
        makeCtx({ baseDisabled: false, sectionRequirementsPassed: false, isRunning: true })
      );
      expect(a.disabled).toBe(false);
      const b = INTERACTIVE_QUIZ_SCHEMA.toEnhancedProps(makeCtx({ baseDisabled: true }));
      expect(b.disabled).toBe(true);
    });
  });

  describe('TERMINAL_STEP_SCHEMA', () => {
    it('toStepInfoExtension sets targetAction="terminal"', () => {
      expect(TERMINAL_STEP_SCHEMA.toStepInfoExtension({ requirements: 'r' }).targetAction).toBe('terminal');
    });

    it('shares the quiz toEnhancedProps formula', () => {
      expect(TERMINAL_STEP_SCHEMA.toEnhancedProps).toBe(INTERACTIVE_QUIZ_SCHEMA.toEnhancedProps);
    });
  });

  describe('TERMINAL_CONNECT_STEP_SCHEMA', () => {
    it('toStepInfoExtension sets targetAction="terminal-connect"', () => {
      expect(TERMINAL_CONNECT_STEP_SCHEMA.toStepInfoExtension({ requirements: 'r' }).targetAction).toBe(
        'terminal-connect'
      );
    });
  });

  describe('CODE_BLOCK_STEP_SCHEMA', () => {
    it('toStepInfoExtension passes through refTarget but sets isMultiStep=true and targetAction="code-block"', () => {
      const ext = CODE_BLOCK_STEP_SCHEMA.toStepInfoExtension({ refTarget: '.code', requirements: 'r' });
      expect(ext).toMatchObject({
        targetAction: 'code-block',
        refTarget: '.code',
        targetValue: undefined,
        isMultiStep: true,
        isGuided: false,
      });
    });

    it('toEnhancedProps includes isCurrentlyExecuting but omits onStepReset', () => {
      const props = CODE_BLOCK_STEP_SCHEMA.toEnhancedProps(makeCtx({ isCurrentlyExecuting: true }));
      expect('isCurrentlyExecuting' in props).toBe(true);
      expect(props.isCurrentlyExecuting).toBe(true);
      expect('onStepReset' in props).toBe(false);
    });

    it('uses the orchestrated disabled formula (mirrors plain step)', () => {
      const props = CODE_BLOCK_STEP_SCHEMA.toEnhancedProps(makeCtx({ isRunning: true, isCurrentlyExecuting: false }));
      expect(props.disabled).toBe(true);
    });

    it('refTarget is "multiStepRefs"', () => {
      expect(CODE_BLOCK_STEP_SCHEMA.refTarget).toBe('multiStepRefs');
    });
  });

  describe('CHALLENGE_BLOCK_SCHEMA', () => {
    it('refTarget is "none" — challenges do not participate in Do Section orchestration', () => {
      expect(CHALLENGE_BLOCK_SCHEMA.refTarget).toBe('none');
    });

    it('toStepInfoExtension marks isMultiStep=false and isGuided=false', () => {
      const ext = CHALLENGE_BLOCK_SCHEMA.toStepInfoExtension({ requirements: 'r', skippable: true });
      expect(ext).toMatchObject({ isMultiStep: false, isGuided: false });
    });

    it('shares the quiz toEnhancedProps formula', () => {
      expect(CHALLENGE_BLOCK_SCHEMA.toEnhancedProps).toBe(INTERACTIVE_QUIZ_SCHEMA.toEnhancedProps);
    });
  });

  describe('idPrefix conventions match stepId numbering in symmetry tripwire', () => {
    it.each([
      [INTERACTIVE_STEP_SCHEMA, 'step'],
      [INTERACTIVE_MULTISTEP_SCHEMA, 'multistep'],
      [INTERACTIVE_GUIDED_SCHEMA, 'guided'],
      [INTERACTIVE_QUIZ_SCHEMA, 'quiz'],
      [TERMINAL_STEP_SCHEMA, 'terminal'],
      [TERMINAL_CONNECT_STEP_SCHEMA, 'terminal-connect'],
      [CODE_BLOCK_STEP_SCHEMA, 'codeblock'],
      [CHALLENGE_BLOCK_SCHEMA, 'challenge'],
    ])('%o uses prefix %s', (schema: StepTypeSchema, expected: string) => {
      expect(schema.idPrefix).toBe(expected);
    });
  });
});
