/**
 * Guide Runner - Public API
 *
 * This module provides utilities for discovering and testing interactive steps
 * in guide documents. It implements DOM-based step discovery per the E2E Test Runner design.
 *
 * @see docs/developer/E2E_TESTING.md#how-it-works
 */

// ============================================
// Types
// ============================================
export type {
  TestableStep,
  StepDiscoveryResult,
  StepContractSource,
  UnsupportedStepCoverage,
  StepCoverage,
  StepStatus,
  SkipReason,
  RequirementStatus,
  RequirementFixType,
  RequirementResult,
  FixAttemptResult,
  FixResult,
  AbortReason,
  ArtifactPaths,
  ErrorClassification,
  StepTestResult,
  AllStepsResult,
  OnStepCompleteCallback,
} from './types';

// ============================================
// Constants
// ============================================
export {
  DEFAULT_STEP_TIMEOUT_MS,
  GUIDE_INITIAL_TIMEOUT_MS,
  GUIDE_SETUP_TIMEOUT_MS,
  STEP_OVERHEAD_TIMEOUT_MS,
  TIMEOUT_PER_MULTISTEP_ACTION_MS,
  TIMEOUT_PER_GUIDED_SUBSTEP_MS,
  SCROLL_INTO_VIEW_TIMEOUT_MS,
  LATE_COMPLETION_CHECK_TIMEOUT_MS,
  GUIDED_RELOAD_LOAD_TIMEOUT_MS,
  SKIP_SYNC_TIMEOUT_MS,
  CURRENT_STEP_SELECTOR,
  LEGACY_STEP_SELECTOR,
} from './constants';

// ============================================
// Error Classification
// ============================================
export { classifyError } from './classification';

// ============================================
// Artifact Collection
// ============================================
export {
  captureFailureArtifacts,
  captureSuccessArtifacts,
  capturePreStepArtifacts,
  captureFinalScreenshot,
} from './artifacts';

// ============================================
// Discovery
// ============================================
export { discoverStepsFromDOM, logDiscoveryResults, withExecutedCoverage } from './discovery';
export { ensureDocsPanelOpen } from './bootstrap';
export { dismissBadgeCelebrations } from './badge-celebrations';

// ============================================
// Requirements
// ============================================
export {
  validateSession,
  detectRequirements,
  waitForRequirementsCheckComplete,
  handleRequirements,
  clickFixButton,
  attemptToFixRequirements,
  handleRequirementsWithFix,
} from './requirements';

// ============================================
// Execution
// ============================================
export type { GuidedCommentBoxWaitOutcome } from './execution';
export {
  scrollStepIntoView,
  calculateGuideTimeout,
  calculateStepTimeout,
  determineUnmetRequirementOutcome,
  parseNthMatchSelector,
  selectStepAction,
  waitForGuidedCommentBoxReady,
  runGuidedSubstepLoop,
  executeStep,
  executeAllSteps,
  logStepResult,
  summarizeResults,
  skippableFailuresAffectSuccess,
  logExecutionSummary,
} from './execution';
export { clickSkipButtonAndSync } from './drivers';
