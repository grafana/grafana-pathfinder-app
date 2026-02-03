/**
 * Check Phases Tests
 *
 * Integration-style tests for check-phases.ts with real dependencies.
 * Tests verify actual config values and explanation generation.
 */

import { INTERACTIVE_CONFIG } from '../constants/interactive-config';

import {
  createBlockedState,
  createCheckingState,
  createEnabledState,
  createErrorState,
  createObjectivesCompletedState,
  createRequirementsState,
} from './check-phases';

describe('check-phases', () => {
  // ============================================================
  // createCheckingState Tests
  // ============================================================
  describe('createCheckingState', () => {
    it('should create checking state with correct flags', () => {
      const state = createCheckingState(false);

      expect(state.isChecking).toBe(true);
      expect(state.isEnabled).toBe(false);
      expect(state.isCompleted).toBe(false);
      expect(state.isSkipped).toBe(false);
    });

    it('should use maxRetries from INTERACTIVE_CONFIG', () => {
      const state = createCheckingState(false);

      expect(state.maxRetries).toBe(INTERACTIVE_CONFIG.delays.requirements.maxRetries);
    });

    it('should initialize with zero retry count', () => {
      const state = createCheckingState(false);

      expect(state.retryCount).toBe(0);
      expect(state.isRetrying).toBe(false);
    });
  });

  // ============================================================
  // createObjectivesCompletedState Tests
  // ============================================================
  describe('createObjectivesCompletedState', () => {
    it('should create objectives completed state with correct flags', () => {
      const state = createObjectivesCompletedState(false);

      expect(state.isEnabled).toBe(true);
      expect(state.isCompleted).toBe(true);
      expect(state.isChecking).toBe(false);
      expect(state.isSkipped).toBe(false);
    });

    it('should set completion reason to objectives', () => {
      const state = createObjectivesCompletedState(false);

      expect(state.completionReason).toBe('objectives');
    });

    it('should have "Already done!" explanation', () => {
      const state = createObjectivesCompletedState(false);

      expect(state.explanation).toBe('Already done!');
    });

    it('should use maxRetries from config', () => {
      const state = createObjectivesCompletedState(false);

      expect(state.maxRetries).toBe(INTERACTIVE_CONFIG.delays.requirements.maxRetries);
    });
  });

  // ============================================================
  // createBlockedState Tests
  // ============================================================
  describe('createBlockedState', () => {
    it('should create blocked state with correct flags', () => {
      const state = createBlockedState('step-1');

      expect(state.isEnabled).toBe(false);
      expect(state.isCompleted).toBe(false);
      expect(state.isChecking).toBe(false);
      expect(state.isSkipped).toBe(false);
    });

    it('should have "Complete previous step" explanation', () => {
      const state = createBlockedState('step-1');

      expect(state.explanation).toBe('Complete previous step');
    });

    it('should have sequential dependency error message', () => {
      const state = createBlockedState('step-1');

      expect(state.error).toBe('Sequential dependency not met');
    });

    it('should never allow skipping for sequential dependencies', () => {
      // Test with various step IDs - canSkip should always be false
      const state1 = createBlockedState('step-1');
      const state2 = createBlockedState('section-1-step-2');
      const state3 = createBlockedState('any-step');

      expect(state1.canSkip).toBe(false);
      expect(state2.canSkip).toBe(false);
      expect(state3.canSkip).toBe(false);
    });

    it('should not allow fixing blocked state', () => {
      const state = createBlockedState('step-1');

      expect(state.canFixRequirement).toBe(false);
      expect(state.fixType).toBeUndefined();
      expect(state.targetHref).toBeUndefined();
    });
  });

  // ============================================================
  // createRequirementsState Tests - Basic
  // ============================================================
  describe('createRequirementsState', () => {
    describe('passing requirements', () => {
      it('should create enabled state when requirements pass', () => {
        const state = createRequirementsState({ pass: true, error: [] }, 'exists-reftarget', undefined, false);

        expect(state.isEnabled).toBe(true);
        expect(state.isCompleted).toBe(false);
        expect(state.error).toBeUndefined();
        expect(state.canFixRequirement).toBe(false);
      });

      it('should not auto-complete when requirements pass', () => {
        const state = createRequirementsState({ pass: true, error: [] }, 'exists-reftarget', undefined, false);

        expect(state.isCompleted).toBe(false);
        expect(state.completionReason).toBe('none');
      });

      it('should have no explanation when requirements pass', () => {
        const state = createRequirementsState({ pass: true, error: [] }, 'exists-reftarget', undefined, false);

        expect(state.explanation).toBeUndefined();
      });
    });

    describe('failing requirements', () => {
      it('should create disabled state when requirements fail', () => {
        const state = createRequirementsState(
          { pass: false, error: [{ pass: false, error: 'Element not found' }] },
          'exists-reftarget',
          undefined,
          false
        );

        expect(state.isEnabled).toBe(false);
        expect(state.isCompleted).toBe(false);
        expect(state.error).toBe('Element not found');
      });

      it('should generate explanation from requirements', () => {
        const state = createRequirementsState(
          { pass: false, error: [{ pass: false, error: 'Error' }] },
          'exists-reftarget',
          undefined,
          false
        );

        expect(state.explanation).toBeDefined();
        // Explanation is generated by getRequirementExplanation
        expect(state.explanation).toContain('target element');
      });
    });

    describe('skippable parameter', () => {
      it('should pass through skippable value', () => {
        const skippable = createRequirementsState({ pass: false, error: [] }, 'exists-reftarget', undefined, true);
        expect(skippable.canSkip).toBe(true);

        const notSkippable = createRequirementsState({ pass: false, error: [] }, 'exists-reftarget', undefined, false);
        expect(notSkippable.canSkip).toBe(false);
      });
    });
  });

  // ============================================================
  // createRequirementsState Test Matrix (Comprehensive)
  // ============================================================
  describe('createRequirementsState test matrix', () => {
    it('should handle all requirements passing', () => {
      const result = createRequirementsState({ pass: true, error: [] }, 'test-req', undefined, false);

      expect(result.isEnabled).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.canFixRequirement).toBe(false);
    });

    it('should handle single requirement failing', () => {
      const result = createRequirementsState(
        { pass: false, error: [{ pass: false, error: 'Element not found', requirement: 'exists:.target' }] },
        'exists:.target',
        undefined,
        false
      );

      expect(result.isEnabled).toBe(false);
      expect(result.error).toBe('Element not found');
    });

    it('should filter to only failed requirements', () => {
      const result = createRequirementsState(
        {
          pass: false,
          error: [
            { pass: true, error: undefined },
            { pass: false, error: 'Y', requirement: 'req-y' },
          ],
        },
        'multiple-reqs',
        undefined,
        false
      );

      // Only failed error message should be included
      expect(result.error).toBe('Y');
    });

    it('should join multiple failure errors', () => {
      const result = createRequirementsState(
        {
          pass: false,
          error: [
            { pass: false, error: 'A', requirement: 'req-a' },
            { pass: false, error: 'B', requirement: 'req-b' },
          ],
        },
        'multiple-reqs',
        undefined,
        false
      );

      expect(result.error).toBe('A, B');
    });

    it('should extract fix info from first fixable error', () => {
      const result = createRequirementsState(
        {
          pass: false,
          error: [
            { pass: false, error: 'Non-fixable', canFix: false },
            { pass: false, error: 'Fixable', canFix: true, fixType: 'nav', targetHref: '/x' },
          ],
        },
        'fixable-req',
        undefined,
        false
      );

      expect(result.canFixRequirement).toBe(true);
      expect(result.fixType).toBe('nav');
      expect(result.targetHref).toBe('/x');
    });

    it('should handle navmenu-open special case', () => {
      const result = createRequirementsState(
        { pass: false, error: [{ pass: false, error: 'Menu closed' }] },
        'navmenu-open',
        undefined,
        false
      );

      expect(result.canFixRequirement).toBe(true);
      expect(result.fixType).toBe('navigation');
    });

    it('should use hints to override explanation', () => {
      const result = createRequirementsState(
        { pass: false, error: [{ pass: false, error: 'Some error' }] },
        'some-req',
        'Custom hint text',
        false
      );

      expect(result.explanation).toBe('Custom hint text');
    });

    it('should handle empty error array', () => {
      const result = createRequirementsState({ pass: false, error: [] }, 'test-req', undefined, false);

      // Should handle gracefully
      expect(result.error).toBeUndefined();
      expect(result.isEnabled).toBe(false);
    });

    it('should handle undefined error array', () => {
      const result = createRequirementsState({ pass: false, error: undefined }, 'test-req', undefined, false);

      // Should not crash and handle gracefully
      expect(result.error).toBeUndefined();
      expect(result.isEnabled).toBe(false);
    });

    it('should extract scrollContainer from fixable error', () => {
      const result = createRequirementsState(
        {
          pass: false,
          error: [{ pass: false, error: 'Need scroll', canFix: true, scrollContainer: '.panel-content' }],
        },
        'scroll-req',
        undefined,
        false
      );

      expect(result.scrollContainer).toBe('.panel-content');
    });

    it('should affect explanation text when skippable', () => {
      const skippable = createRequirementsState(
        { pass: false, error: [{ pass: false, error: 'Error' }] },
        'exists-reftarget',
        undefined,
        true
      );

      const notSkippable = createRequirementsState(
        { pass: false, error: [{ pass: false, error: 'Error' }] },
        'exists-reftarget',
        undefined,
        false
      );

      // Skippable explanation should include skip information
      expect(skippable.explanation).toContain('skip');
      // Non-skippable should not mention skipping
      expect(notSkippable.explanation).not.toContain('skip');
    });

    it('should use first failed requirement for explanation generation', () => {
      const result = createRequirementsState(
        {
          pass: false,
          error: [
            { pass: false, error: 'First error', requirement: 'navmenu-open' },
            { pass: false, error: 'Second error', requirement: 'has-plugin:test' },
          ],
        },
        'multiple-reqs',
        undefined,
        false
      );

      // First failed requirement (navmenu-open) should influence explanation
      expect(result.explanation).toContain('navigation menu');
    });
  });

  // ============================================================
  // createEnabledState Tests
  // ============================================================
  describe('createEnabledState', () => {
    it('should create enabled state with correct flags', () => {
      const state = createEnabledState(false);

      expect(state.isEnabled).toBe(true);
      expect(state.isCompleted).toBe(false);
      expect(state.isChecking).toBe(false);
      expect(state.isSkipped).toBe(false);
    });

    it('should have completion reason as none', () => {
      const state = createEnabledState(false);

      expect(state.completionReason).toBe('none');
    });
  });

  // ============================================================
  // createErrorState Tests
  // ============================================================
  describe('createErrorState', () => {
    it('should create error state with correct flags', () => {
      const state = createErrorState('Test error', 'exists-reftarget', undefined, undefined, false);

      expect(state.isEnabled).toBe(false);
      expect(state.isCompleted).toBe(false);
      expect(state.isChecking).toBe(false);
      expect(state.isSkipped).toBe(false);
    });

    it('should preserve error message', () => {
      const state = createErrorState('Network timeout', 'test-req', undefined, undefined, false);

      expect(state.error).toBe('Network timeout');
    });

    it('should generate explanation from requirements', () => {
      const state = createErrorState('Error', 'navmenu-open', undefined, undefined, false);

      expect(state.explanation).toContain('navigation menu');
    });

    it('should generate explanation from objectives when requirements undefined', () => {
      const state = createErrorState('Error', undefined, 'exists:.target', undefined, false);

      expect(state.explanation).toBeDefined();
    });

    it('should use hints for explanation when provided', () => {
      const state = createErrorState('Error', 'test-req', undefined, 'Custom hint', false);

      expect(state.explanation).toBe('Custom hint');
    });

    it('should handle skippable parameter in explanation', () => {
      const skippable = createErrorState('Error', 'test-req', undefined, undefined, true);
      const notSkippable = createErrorState('Error', 'test-req', undefined, undefined, false);

      expect(skippable.explanation).toContain('skip');
      expect(notSkippable.explanation).not.toContain('skip');
    });

    it('should not allow fixing error states', () => {
      const state = createErrorState('Error', 'test-req', undefined, undefined, false);

      expect(state.canFixRequirement).toBe(false);
      expect(state.fixType).toBeUndefined();
      expect(state.targetHref).toBeUndefined();
    });

    it('should use maxRetries from config', () => {
      const state = createErrorState('Error', 'test-req', undefined, undefined, false);

      expect(state.maxRetries).toBe(INTERACTIVE_CONFIG.delays.requirements.maxRetries);
    });
  });

  // ============================================================
  // Phase Orchestration Contract Tests
  // ============================================================
  describe('phase orchestration contracts', () => {
    it('should short-circuit when objectives are met', () => {
      const state = createObjectivesCompletedState(true);

      expect(state.isCompleted).toBe(true);
      expect(state.completionReason).toBe('objectives');
      // Terminal state - no subsequent phases needed
    });

    it('should block step before checking requirements when not eligible', () => {
      const state = createBlockedState('step-1');

      expect(state.isEnabled).toBe(false);
      expect(state.canSkip).toBe(false); // Sequential deps never skippable
      expect(state.explanation).toBe('Complete previous step');
    });

    it('should enable step when requirements pass', () => {
      const state = createRequirementsState({ pass: true, error: [] }, 'element-exists:.target', undefined, true);

      expect(state.isEnabled).toBe(true);
      expect(state.isCompleted).toBe(false); // Ready to execute, not auto-completed
    });

    it('should create enabled state for unconditional steps', () => {
      const state = createEnabledState(false);

      expect(state.isEnabled).toBe(true);
      expect(state.canSkip).toBe(false);
      expect(state.canFixRequirement).toBe(false);
    });

    it('should produce correct state through full phase sequence', () => {
      // Simulate useStepChecker's decision flow:
      // - objectivesMet = false (continue to next phase)
      // - isEligible = true (continue to requirements check)
      // - requirementsResult = failing
      const requirementsResult = { pass: false, error: [{ pass: false, error: 'Not found' }] };

      // Phase 1: Check objectives (not met, continue)
      // Phase 2: Check eligibility (eligible, continue)
      // Phase 3: Check requirements (failed)
      const finalState = createRequirementsState(requirementsResult, 'element-exists:.btn', undefined, true);

      expect(finalState.isEnabled).toBe(false);
      expect(finalState.canSkip).toBe(true);
      expect(finalState.error).toBe('Not found');
    });

    describe('contract invariants', () => {
      it('should have isChecking false in all terminal states', () => {
        // Only createCheckingState returns isChecking: true
        expect(createCheckingState(false).isChecking).toBe(true);

        // All other factories return isChecking: false
        expect(createObjectivesCompletedState(false).isChecking).toBe(false);
        expect(createBlockedState('step').isChecking).toBe(false);
        expect(createRequirementsState({ pass: true, error: [] }, 'req', undefined, false).isChecking).toBe(false);
        expect(createEnabledState(false).isChecking).toBe(false);
        expect(createErrorState('err', 'req', undefined, undefined, false).isChecking).toBe(false);
      });

      it('should have maxRetries equal to config value in all states', () => {
        const expectedMaxRetries = INTERACTIVE_CONFIG.delays.requirements.maxRetries;

        expect(createCheckingState(false).maxRetries).toBe(expectedMaxRetries);
        expect(createObjectivesCompletedState(false).maxRetries).toBe(expectedMaxRetries);
        expect(createBlockedState('step').maxRetries).toBe(expectedMaxRetries);
        expect(createRequirementsState({ pass: true, error: [] }, 'req', undefined, false).maxRetries).toBe(
          expectedMaxRetries
        );
        expect(createEnabledState(false).maxRetries).toBe(expectedMaxRetries);
        expect(createErrorState('err', 'req', undefined, undefined, false).maxRetries).toBe(expectedMaxRetries);
      });

      it('should have retryCount of 0 in all freshly created states', () => {
        expect(createCheckingState(false).retryCount).toBe(0);
        expect(createObjectivesCompletedState(false).retryCount).toBe(0);
        expect(createBlockedState('step').retryCount).toBe(0);
        expect(createRequirementsState({ pass: true, error: [] }, 'req', undefined, false).retryCount).toBe(0);
        expect(createEnabledState(false).retryCount).toBe(0);
        expect(createErrorState('err', 'req', undefined, undefined, false).retryCount).toBe(0);
      });

      it('should have completionReason "none" unless completed', () => {
        expect(createCheckingState(false).completionReason).toBe('none');
        expect(createBlockedState('step').completionReason).toBe('none');
        expect(createRequirementsState({ pass: true, error: [] }, 'req', undefined, false).completionReason).toBe(
          'none'
        );
        expect(createEnabledState(false).completionReason).toBe('none');
        expect(createErrorState('err', 'req', undefined, undefined, false).completionReason).toBe('none');

        // Only objectives completed has different reason
        expect(createObjectivesCompletedState(false).completionReason).toBe('objectives');
      });

      it('should have isSkipped false except for skipped completion', () => {
        // All factory functions return isSkipped: false
        // isSkipped: true only occurs when completionReason: 'skipped'
        expect(createCheckingState(false).isSkipped).toBe(false);
        expect(createObjectivesCompletedState(false).isSkipped).toBe(false);
        expect(createBlockedState('step').isSkipped).toBe(false);
        expect(createRequirementsState({ pass: true, error: [] }, 'req', undefined, false).isSkipped).toBe(false);
        expect(createEnabledState(false).isSkipped).toBe(false);
        expect(createErrorState('err', 'req', undefined, undefined, false).isSkipped).toBe(false);
      });
    });
  });

  // ============================================================
  // Factory Contract Tests (Consolidated)
  // ============================================================
  describe('factory contract tests', () => {
    const skippableFactories = [
      { name: 'createCheckingState', fn: (skip: boolean) => createCheckingState(skip) },
      { name: 'createEnabledState', fn: (skip: boolean) => createEnabledState(skip) },
      { name: 'createObjectivesCompletedState', fn: (skip: boolean) => createObjectivesCompletedState(skip) },
    ];

    describe.each(skippableFactories)('$name', ({ fn }) => {
      it('should pass through skippable parameter', () => {
        expect(fn(true).canSkip).toBe(true);
        expect(fn(false).canSkip).toBe(false);
      });

      it('should have fix fields undefined or false', () => {
        const state = fn(false);
        expect(state.canFixRequirement).toBe(false);
        expect(state.fixType).toBeUndefined();
        expect(state.targetHref).toBeUndefined();
      });
    });

    // Factories that should have no error (excludes error states and blocked states)
    const noErrorFactories = [
      { name: 'createCheckingState', fn: () => createCheckingState(false) },
      { name: 'createEnabledState', fn: () => createEnabledState(false) },
      { name: 'createObjectivesCompletedState', fn: () => createObjectivesCompletedState(false) },
    ];

    describe.each(noErrorFactories)('$name', ({ fn }) => {
      it('should have no error', () => {
        expect(fn().error).toBeUndefined();
      });
    });
  });

  // ============================================================
  // Edge Cases
  // ============================================================
  describe('edge cases', () => {
    it('should handle empty requirements string', () => {
      const state = createRequirementsState(
        { pass: false, error: [{ pass: false, error: 'Error' }] },
        '',
        undefined,
        false
      );

      // Should not crash
      expect(state.isEnabled).toBe(false);
    });

    it('should handle multiple fixable errors (first one wins)', () => {
      const state = createRequirementsState(
        {
          pass: false,
          error: [
            { pass: false, error: 'First', canFix: true, fixType: 'first-type', targetHref: '/first' },
            { pass: false, error: 'Second', canFix: true, fixType: 'second-type', targetHref: '/second' },
          ],
        },
        'test-req',
        undefined,
        false
      );

      // First fixable error should win
      expect(state.fixType).toBe('first-type');
      expect(state.targetHref).toBe('/first');
    });

    it('should handle mix of passing and failing requirements', () => {
      const state = createRequirementsState(
        {
          pass: false,
          error: [
            { pass: true },
            { pass: false, error: 'Failed' },
            { pass: true },
            { pass: false, error: 'Also failed' },
          ],
        },
        'test-req',
        undefined,
        false
      );

      // Only failing errors should be joined
      expect(state.error).toBe('Failed, Also failed');
    });

    it('should handle very long error messages', () => {
      const longError = 'x'.repeat(10000);
      const state = createRequirementsState(
        { pass: false, error: [{ pass: false, error: longError }] },
        'test-req',
        undefined,
        false
      );

      expect(state.error).toBe(longError);
    });

    it('should handle null-ish values in error array', () => {
      const state = createRequirementsState(
        {
          pass: false,
          error: [
            { pass: false, error: undefined },
            { pass: false, error: '' },
            { pass: false, error: 'Real error' },
          ],
        },
        'test-req',
        undefined,
        false
      );

      // Should filter out empty/undefined errors
      expect(state.error).toBe('Real error');
    });
  });
});
