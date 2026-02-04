/**
 * Guide Runner - Public API
 *
 * This module provides utilities for discovering and testing interactive steps
 * in guide documents. It implements DOM-based step discovery per the E2E Test Runner design.
 *
 * @see tests/e2e-runner/design/e2e-test-runner-design.md
 */

// ============================================
// Types
// ============================================
export type {
  TestableStep,
  StepDiscoveryResult,
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
export { DEFAULT_STEP_TIMEOUT_MS, TIMEOUT_PER_MULTISTEP_ACTION_MS } from './constants';

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
export { discoverStepsFromDOM, logDiscoveryResults } from './discovery';

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
export {
  scrollStepIntoView,
  waitForDoItButtonEnabled,
  waitForDoItButtonToAppear,
  calculateStepTimeout,
  waitForStepCompletion,
  checkObjectiveCompletion,
  waitForCompletionWithObjectivePolling,
  executeStep,
  executeAllSteps,
  logStepResult,
  summarizeResults,
  logExecutionSummary,
} from './execution';
