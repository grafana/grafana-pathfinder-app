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
  refTarget?: string | string[]; // Pass through to requirements checking (single selector or fallback chain)
  isEligibleForChecking: boolean;
  skippable?: boolean; // Whether this step can be skipped if requirements fail
  stepIndex?: number; // Document-wide step index for sequence awareness
  lazyRender?: boolean; // Enable progressive scroll discovery for virtualized containers
  scrollContainer?: string; // CSS selector for scroll container when lazyRender is enabled
  /**
   * Whether the step is disabled. When true, auto-completion callbacks are suppressed.
   */
  disabled?: boolean;
  /**
   * Section that owns this step.
   *
   * - `string` — the step is section-managed; the checker writes terminal
   *   transitions (manual, skipped, objectives) to the completion store
   *   under this sectionId.
   * - `undefined` — standalone step; writes use the synthetic
   *   `STANDALONE_SECTION_ID`.
   * - `null` — non-step context (e.g. the section's own objectives
   *   checker, which is a section-scope evaluation rather than a step).
   *   The checker SKIPS all store writes.
   *
   * Lets the checker collapse the previous dual-write pattern where the
   * FSM updated its own state and the step component separately wrote
   * to the store — closes the FSM/store divergence on the skip and
   * standalone-objectives paths.
   */
  sectionId?: string | null;
  /**
   * Callback invoked when objectives are satisfied, notifying parent of step completion.
   * Called with stepId when completionReason becomes 'objectives'.
   */
  onStepComplete?: (stepId: string) => void;
  /**
   * Callback invoked when objectives are satisfied, for additional completion handling.
   * Called after onStepComplete when completionReason becomes 'objectives'.
   */
  onComplete?: () => void;
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
  requiresDomElement?: boolean; // failure is a missing DOM element; gates the AI "Fix this" variant

  // Actions
  checkStep: () => Promise<void>;
  markCompleted: () => void;
  markSkipped?: () => void; // Function to skip this step
  // Reset all step state including skipped. Pass `{ skipStoreWrite: true }`
  // from broadcast callers (e.g. `resetTrigger` effects) whose section has
  // already written to the completion store via `resetSteps` — otherwise
  // every child step fans out a write and wipes preceding completions.
  resetStep: (options?: { skipStoreWrite?: boolean }) => void;
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
