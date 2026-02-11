/**
 * Step State Machine Tests
 *
 * Integration-style tests for step-state.ts with real dependencies.
 * No mocking - tests verify actual config values and state transitions.
 */

import { INTERACTIVE_CONFIG } from '../constants/interactive-config';

import {
  createInitialState,
  deriveIsChecking,
  deriveIsCompleted,
  deriveIsEnabled,
  deriveIsRetrying,
  deriveIsSkipped,
  stepReducer,
  toLegacyState,
  type CompletionReason,
  type StepAction,
  type StepState,
} from './step-state';

describe('step-state', () => {
  // ============================================================
  // createInitialState Tests
  // ============================================================
  describe('createInitialState', () => {
    it('should create state with default values', () => {
      const state = createInitialState();

      // Assert important invariants without coupling to full object shape
      expect(state).toEqual(
        expect.objectContaining({
          status: 'idle',
          completionReason: 'none',
          retryCount: 0,
          canSkip: false,
          canFix: false,
        })
      );
      // Verify config integration separately
      expect(state.maxRetries).toBe(INTERACTIVE_CONFIG.delays.requirements.maxRetries);
    });

    it('should set canSkip to true when option provided', () => {
      const state = createInitialState({ canSkip: true });

      expect(state.canSkip).toBe(true);
    });

    it('should set canSkip to false when option explicitly false', () => {
      const state = createInitialState({ canSkip: false });

      expect(state.canSkip).toBe(false);
    });

    it('should default canSkip to false when undefined', () => {
      const state = createInitialState({ canSkip: undefined });

      expect(state.canSkip).toBe(false);
    });

    it('should use maxRetries from INTERACTIVE_CONFIG', () => {
      const state = createInitialState();

      expect(state.maxRetries).toBe(INTERACTIVE_CONFIG.delays.requirements.maxRetries);
    });
  });

  // ============================================================
  // stepReducer Tests - State Machine Transitions
  // ============================================================
  describe('stepReducer', () => {
    let initialState: StepState;

    beforeEach(() => {
      initialState = createInitialState();
    });

    describe('START_CHECK action', () => {
      it('should transition from idle to checking', () => {
        const state = stepReducer(initialState, { type: 'START_CHECK' });

        expect(state.status).toBe('checking');
        expect(state.error).toBeUndefined();
        expect(state.retryCount).toBe(0);
      });

      it('should transition from blocked to checking', () => {
        const blockedState: StepState = {
          ...initialState,
          status: 'blocked',
          error: 'Some error',
        };

        const state = stepReducer(blockedState, { type: 'START_CHECK' });

        expect(state.status).toBe('checking');
        expect(state.error).toBeUndefined();
      });

      it('should transition from enabled to checking', () => {
        const enabledState: StepState = {
          ...initialState,
          status: 'enabled',
        };

        const state = stepReducer(enabledState, { type: 'START_CHECK' });

        expect(state.status).toBe('checking');
      });

      it('should be a no-op from completed state', () => {
        const completedState: StepState = {
          ...initialState,
          status: 'completed',
          completionReason: 'manual',
        };

        const state = stepReducer(completedState, { type: 'START_CHECK' });

        // State should be unchanged
        expect(state).toBe(completedState);
        expect(state.status).toBe('completed');
      });

      it('should reset retryCount to 0', () => {
        const stateWithRetries: StepState = {
          ...initialState,
          status: 'blocked',
          retryCount: 2,
        };

        const state = stepReducer(stateWithRetries, { type: 'START_CHECK' });

        expect(state.retryCount).toBe(0);
      });

      it('should clear error when starting check', () => {
        const stateWithError: StepState = {
          ...initialState,
          status: 'blocked',
          error: 'Previous error message',
        };

        const state = stepReducer(stateWithError, { type: 'START_CHECK' });

        expect(state.error).toBeUndefined();
      });
    });

    describe('SET_BLOCKED action', () => {
      it('should transition to blocked with error and explanation', () => {
        const action: StepAction = {
          type: 'SET_BLOCKED',
          error: 'Element not found',
          explanation: 'The target element is not visible',
        };

        const state = stepReducer(initialState, action);

        expect(state.status).toBe('blocked');
        expect(state.error).toBe('Element not found');
        expect(state.explanation).toBe('The target element is not visible');
      });

      it('should clear fix-related fields', () => {
        const stateWithFix: StepState = {
          ...initialState,
          canFix: true,
          fixType: 'navigation',
          targetHref: '/some/path',
        };

        const state = stepReducer(stateWithFix, { type: 'SET_BLOCKED', error: 'Blocked' });

        expect(state.canFix).toBe(false);
        expect(state.fixType).toBeUndefined();
        expect(state.targetHref).toBeUndefined();
      });

      it('should handle SET_BLOCKED without explanation', () => {
        const state = stepReducer(initialState, {
          type: 'SET_BLOCKED',
          error: 'Error only',
        });

        expect(state.error).toBe('Error only');
        expect(state.explanation).toBeUndefined();
      });
    });

    describe('SET_ENABLED action', () => {
      it('should transition to enabled and clear error/explanation', () => {
        const blockedState: StepState = {
          ...initialState,
          status: 'blocked',
          error: 'Old error',
          explanation: 'Old explanation',
        };

        const state = stepReducer(blockedState, { type: 'SET_ENABLED' });

        expect(state.status).toBe('enabled');
        expect(state.error).toBeUndefined();
        expect(state.explanation).toBeUndefined();
      });

      it('should set fix capabilities when provided', () => {
        const state = stepReducer(initialState, {
          type: 'SET_ENABLED',
          canFix: true,
          fixType: 'navigation',
          targetHref: '/dashboard',
        });

        expect(state.canFix).toBe(true);
        expect(state.fixType).toBe('navigation');
        expect(state.targetHref).toBe('/dashboard');
      });

      it('should default canFix to false when not provided', () => {
        const state = stepReducer(initialState, { type: 'SET_ENABLED' });

        expect(state.canFix).toBe(false);
      });

      it('should handle undefined optional parameters', () => {
        const state = stepReducer(initialState, {
          type: 'SET_ENABLED',
          canFix: undefined,
          fixType: undefined,
          targetHref: undefined,
        });

        expect(state.canFix).toBe(false);
        expect(state.fixType).toBeUndefined();
        expect(state.targetHref).toBeUndefined();
      });
    });

    describe('SET_COMPLETED action', () => {
      const completionReasons: CompletionReason[] = ['objectives', 'manual', 'skipped'];

      it.each(completionReasons)('should complete with reason: %s', (reason) => {
        const state = stepReducer(initialState, {
          type: 'SET_COMPLETED',
          reason,
        });

        expect(state.status).toBe('completed');
        expect(state.completionReason).toBe(reason);
      });

      it('should set default explanation when not provided', () => {
        const state = stepReducer(initialState, {
          type: 'SET_COMPLETED',
          reason: 'manual',
        });

        expect(state.explanation).toBe('Completed');
      });

      it('should use provided explanation', () => {
        const state = stepReducer(initialState, {
          type: 'SET_COMPLETED',
          reason: 'objectives',
          explanation: 'Already done!',
        });

        expect(state.explanation).toBe('Already done!');
      });

      it('should clear error and canFix', () => {
        const errorState: StepState = {
          ...initialState,
          error: 'Some error',
          canFix: true,
        };

        const state = stepReducer(errorState, {
          type: 'SET_COMPLETED',
          reason: 'manual',
        });

        expect(state.error).toBeUndefined();
        expect(state.canFix).toBe(false);
      });
    });

    describe('SET_ERROR action', () => {
      it('should transition to blocked with error details', () => {
        const state = stepReducer(initialState, {
          type: 'SET_ERROR',
          error: 'Network timeout',
          explanation: 'Check your connection',
        });

        expect(state.status).toBe('blocked');
        expect(state.error).toBe('Network timeout');
        expect(state.explanation).toBe('Check your connection');
      });

      it('should set fix information when provided', () => {
        const state = stepReducer(initialState, {
          type: 'SET_ERROR',
          error: 'Nav menu closed',
          canFix: true,
          fixType: 'navigation',
          targetHref: '/nav',
        });

        expect(state.canFix).toBe(true);
        expect(state.fixType).toBe('navigation');
        expect(state.targetHref).toBe('/nav');
      });

      it('should default canFix to false when not provided', () => {
        const state = stepReducer(initialState, {
          type: 'SET_ERROR',
          error: 'Error',
        });

        expect(state.canFix).toBe(false);
      });
    });

    describe('UPDATE_RETRY action', () => {
      it('should update retry count', () => {
        const state = stepReducer(initialState, {
          type: 'UPDATE_RETRY',
          retryCount: 2,
          isRetrying: true,
        });

        expect(state.retryCount).toBe(2);
      });

      it('should preserve other state fields', () => {
        const stateWithFields: StepState = {
          ...initialState,
          status: 'checking',
          error: 'Some error',
          explanation: 'Some explanation',
        };

        const state = stepReducer(stateWithFields, {
          type: 'UPDATE_RETRY',
          retryCount: 1,
          isRetrying: true,
        });

        expect(state.status).toBe('checking');
        expect(state.error).toBe('Some error');
        expect(state.explanation).toBe('Some explanation');
        expect(state.retryCount).toBe(1);
      });

      it('should handle boundary retry counts', () => {
        const state1 = stepReducer(initialState, {
          type: 'UPDATE_RETRY',
          retryCount: 0,
          isRetrying: false,
        });
        expect(state1.retryCount).toBe(0);

        const state2 = stepReducer(initialState, {
          type: 'UPDATE_RETRY',
          retryCount: 3,
          isRetrying: true,
        });
        expect(state2.retryCount).toBe(3);
      });
    });

    describe('RESET action', () => {
      it('should reset to initial state preserving canSkip', () => {
        const completedState: StepState = {
          ...initialState,
          status: 'completed',
          completionReason: 'manual',
          error: 'old error',
          explanation: 'old explanation',
          canFix: true,
          canSkip: true,
        };

        const state = stepReducer(completedState, { type: 'RESET' });

        expect(state.status).toBe('idle');
        expect(state.completionReason).toBe('none');
        expect(state.error).toBeUndefined();
        expect(state.explanation).toBeUndefined();
        expect(state.canFix).toBe(false);
        expect(state.canSkip).toBe(true); // Preserved from original state
      });

      it('should override canSkip when explicitly provided', () => {
        const stateWithSkip: StepState = {
          ...initialState,
          canSkip: true,
        };

        const state = stepReducer(stateWithSkip, { type: 'RESET', canSkip: false });

        expect(state.canSkip).toBe(false);
      });

      it('should preserve canSkip from state when not provided in action', () => {
        const stateWithSkip: StepState = {
          ...initialState,
          canSkip: true,
        };

        const state = stepReducer(stateWithSkip, { type: 'RESET' });

        expect(state.canSkip).toBe(true);
      });
    });

    describe('unknown action', () => {
      it('should return unchanged state for unknown action type', () => {
        const unknownAction = { type: 'UNKNOWN_ACTION' } as unknown as StepAction;

        const state = stepReducer(initialState, unknownAction);

        expect(state).toBe(initialState);
      });
    });
  });

  // ============================================================
  // State Transition Sequence Tests
  // ============================================================
  describe('state transition sequences', () => {
    it('should complete full flow: idle → checking → enabled → checking → completed', () => {
      let state = createInitialState();
      expect(state.status).toBe('idle');

      state = stepReducer(state, { type: 'START_CHECK' });
      expect(state.status).toBe('checking');

      state = stepReducer(state, { type: 'SET_ENABLED' });
      expect(state.status).toBe('enabled');

      state = stepReducer(state, { type: 'START_CHECK' });
      expect(state.status).toBe('checking');

      state = stepReducer(state, { type: 'SET_COMPLETED', reason: 'manual' });
      expect(state.status).toBe('completed');
      expect(state.completionReason).toBe('manual');
    });

    it('should handle error flow: idle → checking → blocked → checking → enabled', () => {
      let state = createInitialState();
      expect(state.status).toBe('idle');

      state = stepReducer(state, { type: 'START_CHECK' });
      expect(state.status).toBe('checking');

      state = stepReducer(state, { type: 'SET_BLOCKED', error: 'Element not found' });
      expect(state.status).toBe('blocked');
      expect(state.error).toBe('Element not found');

      state = stepReducer(state, { type: 'START_CHECK' });
      expect(state.status).toBe('checking');
      expect(state.error).toBeUndefined();

      state = stepReducer(state, { type: 'SET_ENABLED' });
      expect(state.status).toBe('enabled');
    });

    it('should handle skip flow: idle → checking → enabled → completed(skipped)', () => {
      let state = createInitialState({ canSkip: true });
      expect(state.status).toBe('idle');
      expect(state.canSkip).toBe(true);

      state = stepReducer(state, { type: 'START_CHECK' });
      expect(state.status).toBe('checking');

      state = stepReducer(state, { type: 'SET_ENABLED' });
      expect(state.status).toBe('enabled');

      state = stepReducer(state, { type: 'SET_COMPLETED', reason: 'skipped' });
      expect(state.status).toBe('completed');
      expect(state.completionReason).toBe('skipped');
    });

    it('should handle retry sequence with UPDATE_RETRY', () => {
      let state = createInitialState();

      state = stepReducer(state, { type: 'START_CHECK' });
      expect(state.retryCount).toBe(0);

      // First retry
      state = stepReducer(state, { type: 'UPDATE_RETRY', retryCount: 1, isRetrying: true });
      expect(state.retryCount).toBe(1);

      // Second retry
      state = stepReducer(state, { type: 'UPDATE_RETRY', retryCount: 2, isRetrying: true });
      expect(state.retryCount).toBe(2);

      // Success after retry
      state = stepReducer(state, { type: 'SET_ENABLED' });
      expect(state.status).toBe('enabled');
      expect(state.retryCount).toBe(2); // Retry count preserved
    });
  });

  // ============================================================
  // Derive Function Tests
  // ============================================================
  describe('derive functions', () => {
    describe('deriveIsEnabled', () => {
      it('should return true only when status is enabled', () => {
        expect(deriveIsEnabled({ ...createInitialState(), status: 'enabled' })).toBe(true);
        expect(deriveIsEnabled({ ...createInitialState(), status: 'idle' })).toBe(false);
        expect(deriveIsEnabled({ ...createInitialState(), status: 'checking' })).toBe(false);
        expect(deriveIsEnabled({ ...createInitialState(), status: 'blocked' })).toBe(false);
        expect(deriveIsEnabled({ ...createInitialState(), status: 'completed' })).toBe(false);
      });
    });

    describe('deriveIsCompleted', () => {
      it('should return true only when status is completed', () => {
        expect(deriveIsCompleted({ ...createInitialState(), status: 'completed' })).toBe(true);
        expect(deriveIsCompleted({ ...createInitialState(), status: 'idle' })).toBe(false);
        expect(deriveIsCompleted({ ...createInitialState(), status: 'checking' })).toBe(false);
        expect(deriveIsCompleted({ ...createInitialState(), status: 'blocked' })).toBe(false);
        expect(deriveIsCompleted({ ...createInitialState(), status: 'enabled' })).toBe(false);
      });
    });

    describe('deriveIsChecking', () => {
      it('should return true only when status is checking', () => {
        expect(deriveIsChecking({ ...createInitialState(), status: 'checking' })).toBe(true);
        expect(deriveIsChecking({ ...createInitialState(), status: 'idle' })).toBe(false);
        expect(deriveIsChecking({ ...createInitialState(), status: 'blocked' })).toBe(false);
        expect(deriveIsChecking({ ...createInitialState(), status: 'enabled' })).toBe(false);
        expect(deriveIsChecking({ ...createInitialState(), status: 'completed' })).toBe(false);
      });
    });

    describe('deriveIsSkipped', () => {
      it('should return true only when completed with skipped reason', () => {
        expect(
          deriveIsSkipped({
            ...createInitialState(),
            status: 'completed',
            completionReason: 'skipped',
          })
        ).toBe(true);
      });

      it('should return false for completed with other reasons', () => {
        expect(
          deriveIsSkipped({
            ...createInitialState(),
            status: 'completed',
            completionReason: 'manual',
          })
        ).toBe(false);
        expect(
          deriveIsSkipped({
            ...createInitialState(),
            status: 'completed',
            completionReason: 'objectives',
          })
        ).toBe(false);
      });

      it('should return false for non-completed statuses', () => {
        expect(
          deriveIsSkipped({
            ...createInitialState(),
            status: 'enabled',
            completionReason: 'skipped', // Invalid combo but should still be false
          })
        ).toBe(false);
      });
    });

    describe('deriveIsRetrying', () => {
      it('should return true only when checking with retryCount > 0', () => {
        expect(
          deriveIsRetrying({
            ...createInitialState(),
            status: 'checking',
            retryCount: 1,
          })
        ).toBe(true);

        expect(
          deriveIsRetrying({
            ...createInitialState(),
            status: 'checking',
            retryCount: 3,
          })
        ).toBe(true);
      });

      it('should return false when checking with retryCount 0', () => {
        expect(
          deriveIsRetrying({
            ...createInitialState(),
            status: 'checking',
            retryCount: 0,
          })
        ).toBe(false);
      });

      it('should return false when not checking even with retryCount > 0', () => {
        expect(
          deriveIsRetrying({
            ...createInitialState(),
            status: 'blocked',
            retryCount: 2,
          })
        ).toBe(false);

        expect(
          deriveIsRetrying({
            ...createInitialState(),
            status: 'enabled',
            retryCount: 1,
          })
        ).toBe(false);
      });
    });
  });

  // ============================================================
  // toLegacyState Tests
  // ============================================================
  describe('toLegacyState', () => {
    it('should correctly map all fields', () => {
      const state: StepState = {
        status: 'enabled',
        completionReason: 'none',
        error: undefined,
        explanation: 'Step is ready',
        canFix: true,
        fixType: 'navigation',
        targetHref: '/dashboard',
        retryCount: 1,
        maxRetries: 3,
        canSkip: true,
      };

      const legacy = toLegacyState(state);

      expect(legacy).toEqual({
        isEnabled: true,
        isCompleted: false,
        isChecking: false,
        isSkipped: false,
        completionReason: 'none',
        explanation: 'Step is ready',
        error: undefined,
        canFixRequirement: true, // Note: canFix → canFixRequirement rename
        canSkip: true,
        fixType: 'navigation',
        targetHref: '/dashboard',
        retryCount: 1,
        maxRetries: 3,
        isRetrying: false, // Not checking, so not retrying
      });
    });

    it('should derive isRetrying correctly in legacy format', () => {
      const checkingState: StepState = {
        ...createInitialState(),
        status: 'checking',
        retryCount: 2,
      };

      const legacy = toLegacyState(checkingState);

      expect(legacy.isRetrying).toBe(true);
      expect(legacy.isChecking).toBe(true);
    });

    it('should derive isSkipped correctly in legacy format', () => {
      const skippedState: StepState = {
        ...createInitialState(),
        status: 'completed',
        completionReason: 'skipped',
      };

      const legacy = toLegacyState(skippedState);

      expect(legacy.isSkipped).toBe(true);
      expect(legacy.isCompleted).toBe(true);
    });

    it('should match derive function outputs exactly', () => {
      const states: StepState[] = [
        { ...createInitialState(), status: 'idle' },
        { ...createInitialState(), status: 'checking', retryCount: 1 },
        { ...createInitialState(), status: 'blocked' },
        { ...createInitialState(), status: 'enabled' },
        { ...createInitialState(), status: 'completed', completionReason: 'manual' },
        { ...createInitialState(), status: 'completed', completionReason: 'skipped' },
      ];

      for (const state of states) {
        const legacy = toLegacyState(state);

        expect(legacy.isEnabled).toBe(deriveIsEnabled(state));
        expect(legacy.isCompleted).toBe(deriveIsCompleted(state));
        expect(legacy.isChecking).toBe(deriveIsChecking(state));
        expect(legacy.isSkipped).toBe(deriveIsSkipped(state));
        expect(legacy.isRetrying).toBe(deriveIsRetrying(state));
      }
    });
  });

  // ============================================================
  // Edge Cases
  // ============================================================
  describe('edge cases', () => {
    it('should handle state preservation on no-op transitions', () => {
      const completedState: StepState = {
        ...createInitialState(),
        status: 'completed',
        completionReason: 'objectives',
        explanation: 'Custom explanation',
        canSkip: true,
      };

      // START_CHECK is no-op for completed
      const state = stepReducer(completedState, { type: 'START_CHECK' });

      expect(state).toBe(completedState);
      expect(state.explanation).toBe('Custom explanation');
      expect(state.canSkip).toBe(true);
    });

    it('should handle empty strings in action payloads', () => {
      const state = stepReducer(createInitialState(), {
        type: 'SET_BLOCKED',
        error: '',
        explanation: '',
      });

      expect(state.error).toBe('');
      expect(state.explanation).toBe('');
    });

    it('should handle very long error messages', () => {
      const longError = 'x'.repeat(10000);
      const state = stepReducer(createInitialState(), {
        type: 'SET_ERROR',
        error: longError,
      });

      expect(state.error).toBe(longError);
    });
  });
});
