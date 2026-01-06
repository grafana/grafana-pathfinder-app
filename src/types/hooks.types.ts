/**
 * Hook-related type definitions
 * Centralized interfaces for React hooks across the application
 */

// ============================================================================
// STEP CHECKER HOOKS
// ============================================================================

/**
 * Props for useStepChecker hook
 * Unified hook for checking tutorial-specific requirements and objectives
 */
export interface UseStepCheckerProps {
  requirements?: string;
  objectives?: string;
  hints?: string;
  stepId: string;
  targetAction?: string; // Pass through to requirements checking
  refTarget?: string; // Pass through to requirements checking
  isEligibleForChecking: boolean;
  skippable?: boolean; // Whether this step can be skipped if requirements fail
  stepIndex?: number; // Document-wide step index for sequence awareness
  lazyRender?: boolean; // Enable progressive scroll discovery for virtualized containers
  scrollContainer?: string; // CSS selector for scroll container when lazyRender is enabled
}

/**
 * Return type for useStepChecker hook
 */
export interface UseStepCheckerReturn {
  // Unified state
  isEnabled: boolean;
  isCompleted: boolean;
  isChecking: boolean;
  isSkipped?: boolean; // Whether this step was skipped due to failed requirements

  // Retry state
  retryCount?: number; // Current retry attempt
  maxRetries?: number; // Maximum retry attempts
  isRetrying?: boolean; // Whether currently in a retry cycle

  // Diagnostics
  completionReason: 'none' | 'objectives' | 'manual' | 'skipped';
  explanation?: string;
  error?: string;
  canFixRequirement?: boolean; // Whether the requirement can be automatically fixed
  canSkip?: boolean; // Whether this step can be skipped
  fixType?: string; // Type of fix available (e.g., 'lazy-scroll', 'navigation', 'location')

  // Actions
  checkStep: () => Promise<void>;
  markCompleted: () => void;
  markSkipped?: () => void; // Function to skip this step
  resetStep: () => void; // Reset all step state including skipped
  fixRequirement?: () => Promise<void>; // Function to automatically fix the requirement
}

// ============================================================================
// REQUIREMENTS CHECKER HOOKS
// ============================================================================

// Note: Requirements-specific types (RequirementsCheckResult, RequirementsCheckOptions, etc.)
// are kept in src/requirements-manager/ as they are domain-specific with specialized fields.
// Import them from requirements-manager if needed.

// ============================================================================
// INTERACTIVE HOOKS
// ============================================================================

/**
 * Options for useInteractiveElements hook
 */
export interface UseInteractiveElementsOptions {
  containerRef?: React.RefObject<HTMLElement>;
  disabled?: boolean;
}

// Note: InteractiveRequirementsCheck and CheckResult are kept in
// src/interactive-engine/interactive.hook.ts as they are domain-specific.
// Import them from interactive-engine if needed.

// ============================================================================
// CONTEXT PANEL HOOKS
// ============================================================================

// Note: UseContextPanelOptions and UseContextPanelReturn are defined in context.types.ts
// to avoid circular dependencies. Import from there if needed.

// ============================================================================
// UTILITY HOOKS
// ============================================================================

/**
 * Text selection position
 */
export interface SelectionPosition {
  top: number;
  left: number;
  width: number;
  height: number;
  buttonPlacement: 'top' | 'bottom';
}

/**
 * Text selection state
 */
export interface TextSelectionState {
  selectedText: string;
  position: SelectionPosition | null;
  isValid: boolean;
}

/**
 * Safe event handler options
 */
export interface SafeEventOptions {
  preventDefault?: boolean;
  stopPropagation?: boolean;
  stopImmediatePropagation?: boolean;
}
