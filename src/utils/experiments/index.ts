/**
 * Experiments module - Centralized experiment management for Pathfinder
 *
 * This module contains all experiment-related functionality split into:
 * - experiment-utils: Storage helpers, path utilities, user age checking
 * - experiment-orchestrator: Initialization logic, auto-open orchestration
 * - experiment-debug: Debug utilities (window.__pathfinderExperiment)
 */

// Re-export from experiment-utils
export {
  getStorageKeys,
  getParentPath,
  getTreatmentPageKey,
  findMatchingTargetPage,
  hasParentAutoOpened,
  markParentAutoOpened,
  markGlobalAutoOpened,
  syncExperimentStateFromUserStorage,
  resetExperimentState,
  shouldAutoOpenForPath,
  isSidebarAlreadyInUse,
  isOnboardingFlowPath,
} from './experiment-utils';

// Re-export from experiment-orchestrator
export {
  initializeExperiments,
  shouldMountSidebar,
  attemptAutoOpen,
  setupMainExperimentAutoOpen,
  getAutoOpenFeatureFlag,
  getCurrentPath,
  type ExperimentState,
  type AutoOpenContext,
} from './experiment-orchestrator';

// Re-export from experiment-debug
export { createExperimentDebugger, logExperimentConfig } from './experiment-debug';
