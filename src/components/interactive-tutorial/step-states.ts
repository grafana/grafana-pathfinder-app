/**
 * State constants for interactive step components
 *
 * These constants define the valid values for data-test-* attributes used in E2E testing.
 * They ensure type safety and consistency between components and tests.
 */

/** UI states for interactive step components (data-test-step-state attribute) */
export const STEP_STATES = {
  IDLE: 'idle',
  EXECUTING: 'executing',
  CHECKING: 'checking',
  COMPLETED: 'completed',
  ERROR: 'error',
  CANCELLED: 'cancelled',
  REQUIREMENTS_UNMET: 'requirements-unmet', // Used by InteractiveStep, InteractiveMultiStep, InteractiveGuided
} as const;

export type StepStateValue = (typeof STEP_STATES)[keyof typeof STEP_STATES];

/** Requirements states for data-test-requirements-state attribute */
export const REQUIREMENTS_STATES = {
  MET: 'met',
  UNMET: 'unmet',
  CHECKING: 'checking',
  UNKNOWN: 'unknown',
} as const;

export type RequirementsStateValue = (typeof REQUIREMENTS_STATES)[keyof typeof REQUIREMENTS_STATES];

/** Form validation states for data-test-form-state attribute */
export const FORM_STATES = {
  IDLE: 'idle',
  CHECKING: 'checking',
  VALID: 'valid',
  INVALID: 'invalid',
} as const;

export type FormStateValue = (typeof FORM_STATES)[keyof typeof FORM_STATES];

/**
 * Fix type constants for the data-test-fix-type attribute.
 * The canonical definition lives in `src/requirements-manager/fix-types.ts`
 * (Tier 2) so the fix-handler registry can reference it without crossing the
 * Tier 2 → Tier 3-4 import boundary. Re-exported here for UI consumers via the
 * requirements-manager barrel.
 */
export { FIX_TYPES } from '../../requirements-manager';
export type { FixTypeValue } from '../../requirements-manager';
