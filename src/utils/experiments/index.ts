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
  getAfter24hStorageKeys,
  getParentPath,
  getTreatmentPageKey,
  findMatchingTargetPage,
  hasParentAutoOpened,
  markParentAutoOpened,
  markGlobalAutoOpened,
  syncExperimentStateFromUserStorage,
  resetExperimentState,
  shouldAutoOpenForPath,
  hasAfter24hAutoOpened,
  markAfter24hAutoOpened,
  resetAfter24hExperimentState,
  isUserAccountOlderThan24Hours,
  isSidebarAlreadyInUse,
  isOnboardingFlowPath,
} from './experiment-utils';

// Re-export from experiment-orchestrator
export {
  initializeExperiments,
  shouldMountSidebar,
  attemptAutoOpen,
  setupMainExperimentAutoOpen,
  setupAfter24hAutoOpen,
  getAutoOpenFeatureFlag,
  getCurrentPath,
  type ExperimentState,
  type AutoOpenContext,
} from './experiment-orchestrator';

// Re-export from experiment-debug
export { createExperimentDebugger, logExperimentConfig } from './experiment-debug';
