/**
 * Type re-exports for forms
 * All types are defined in ../types.ts to avoid duplication
 */

// Re-export types from parent types.ts
export type {
  InteractiveFormProps,
  InteractiveAttributesInput,
  InteractiveAttributesOutput,
} from '../types';

// Re-export from constants for backward compatibility
export { COMMON_REQUIREMENTS } from '../../../constants/interactive-config';
export type { ActionType, CommonRequirement } from '../../../constants/interactive-config';

