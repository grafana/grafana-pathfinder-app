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
  REQUIREMENTS_NOT_MET: 'requirements-not-met', // Used by InteractiveGuided
  REQUIREMENTS_UNMET: 'requirements-unmet', // Used by InteractiveMultiStep/InteractiveStep
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

/** Fix types for data-test-fix-type attribute */
export const FIX_TYPES = {
  NONE: 'none',
  NAVIGATION: 'navigation',
  LAZY_SCROLL: 'lazy-scroll',
  LOCATION: 'location',
  EXPAND_PARENT_NAVIGATION: 'expand-parent-navigation',
} as const;

export type FixTypeValue = (typeof FIX_TYPES)[keyof typeof FIX_TYPES];
