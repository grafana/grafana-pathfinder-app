/**
 * Experiment Orchestrator
 *
 * High-level orchestration logic for experiments:
 * - Initializes experiment configs from OpenFeature
 * - Handles resetCache logic for both experiments
 * - Manages auto-open triggering for sidebar
 * - Determines if sidebar should be mounted based on experiment variants
 */

import { getAppEvents, locationService } from '@grafana/runtime';

import pluginJson from '../../plugin.json';
import { StorageKeys } from '../../lib/user-storage';
import { sidebarState } from '../../global-state/sidebar';
import { getExperimentConfig, getFeatureFlagValue, matchPathPattern, type ExperimentConfig } from '../openfeature';

import {
  getStorageKeys,
  getAfter24hStorageKeys,
  syncExperimentStateFromUserStorage,
  resetExperimentState,
  resetAfter24hExperimentState,
  shouldAutoOpenForPath,
  markParentAutoOpened,
  markGlobalAutoOpened,
  markAfter24hAutoOpened,
  hasAfter24hAutoOpened,
  isUserAccountOlderThan24Hours,
  isSidebarAlreadyInUse,
  isOnboardingFlowPath,
} from './experiment-utils';

// ============================================================================
// TYPES
// ============================================================================

export interface ExperimentState {
  mainConfig: ExperimentConfig;
  mainVariant: string;
  after24hConfig: ExperimentConfig;
  after24hVariant: string;
  hostname: string;
  targetPages: string[];
}

export interface AutoOpenContext {
  currentPath: string;
  featureFlagEnabled: boolean;
  pluginConfig: { openPanelOnLaunch?: boolean };
}

// ============================================================================
// EXPERIMENT INITIALIZATION
// ============================================================================

/**
 * Initializes both experiments at module load time.
 * Handles resetCache logic for both experiments.
 *
 * @returns ExperimentState with both configs and variants
 */
export function initializeExperiments(): ExperimentState {
  const hostname = window.location.hostname;

  // Evaluate main experiment config
  const mainConfig: ExperimentConfig = getExperimentConfig('pathfinder.experiment-variant');
  const mainVariant = mainConfig.variant;
  const targetPages = mainConfig.pages;

  // Handle resetCache for main experiment
  handleMainExperimentResetCache(hostname, mainConfig);

  // Sync experiment state from Grafana user storage to sessionStorage (fire and forget)
  syncExperimentStateFromUserStorage(hostname, targetPages).catch((error) => {
    console.warn('[Pathfinder] Failed to sync experiment state from user storage:', error);
  });

  // Log main experiment config
  console.warn(
    `[Pathfinder] Experiment config loaded: variant="${mainVariant}", pages=${JSON.stringify(targetPages)}, resetCache=${mainConfig.resetCache}`
  );

  // Evaluate after-24h experiment config
  const after24hConfig: ExperimentConfig = getExperimentConfig('pathfinder.after-24h-experiment');
  const after24hVariant = after24hConfig.variant;

  // Handle resetCache for after-24h experiment
  handleAfter24hExperimentResetCache(hostname, after24hConfig);

  // Log after-24h experiment config
  console.warn(
    `[Pathfinder] After-24h experiment config loaded: variant="${after24hVariant}", resetCache=${after24hConfig.resetCache}`
  );

  return {
    mainConfig,
    mainVariant,
    after24hConfig,
    after24hVariant,
    hostname,
    targetPages,
  };
}

/**
 * Handles resetCache logic for main experiment.
 * Uses localStorage to track if reset has been processed to support false → true transitions.
 */
function handleMainExperimentResetCache(hostname: string, config: ExperimentConfig): void {
  const resetProcessedKey = `${StorageKeys.EXPERIMENT_RESET_PROCESSED_PREFIX}${hostname}`;
  const resetProcessed = localStorage.getItem(resetProcessedKey);

  if (config.resetCache) {
    if (resetProcessed !== 'true') {
      resetExperimentState(hostname).catch((error) => {
        console.warn('[Pathfinder] Failed to reset experiment state:', error);
      });
      localStorage.setItem(resetProcessedKey, 'true');
      console.log('[Pathfinder] Pop-open reset triggered: cleared auto-open tracking in all storages');
    }
  } else {
    if (resetProcessed === 'true') {
      localStorage.setItem(resetProcessedKey, 'false');
    }
  }
}

/**
 * Handles resetCache logic for after-24h experiment.
 */
function handleAfter24hExperimentResetCache(hostname: string, config: ExperimentConfig): void {
  const keys = getAfter24hStorageKeys(hostname);
  const resetProcessedKey = keys.resetProcessed;
  const resetProcessed = localStorage.getItem(resetProcessedKey);

  if (config.resetCache) {
    if (resetProcessed !== 'true') {
      resetAfter24hExperimentState(hostname);
      localStorage.setItem(resetProcessedKey, 'true');
      console.log('[Pathfinder] After-24h pop-open reset triggered: cleared auto-open tracking');
    }
  } else {
    if (resetProcessed === 'true') {
      localStorage.setItem(resetProcessedKey, 'false');
    }
  }
}

// ============================================================================
// SIDEBAR MOUNTING DECISION
// ============================================================================

/**
 * Determines if the sidebar component should be mounted based on experiment variants.
 * The sidebar is NOT mounted for control groups in either experiment.
 *
 * @param mainVariant - Variant from main experiment
 * @param after24hVariant - Variant from after-24h experiment
 * @returns true if sidebar should be mounted
 */
export function shouldMountSidebar(mainVariant: string, after24hVariant: string): boolean {
  return mainVariant !== 'control' && after24hVariant !== 'control';
}

// ============================================================================
// AUTO-OPEN LOGIC
// ============================================================================

/**
 * Attempts to auto-open the sidebar with a configurable delay.
 * Uses Grafana app events to trigger the sidebar open.
 */
export function attemptAutoOpen(delay = 200): void {
  setTimeout(() => {
    try {
      const appEvents = getAppEvents();
      appEvents.publish({
        type: 'open-extension-sidebar',
        payload: {
          pluginId: pluginJson.id,
          componentTitle: 'Interactive learning',
        },
      });
    } catch (error) {
      console.error('Failed to auto-open Interactive learning panel:', error);
    }
  }, delay);
}

/**
 * Sets up auto-open logic for the main experiment.
 * Handles treatment (per-page tracking) and excluded (global tracking) variants.
 */
export function setupMainExperimentAutoOpen(state: ExperimentState, context: AutoOpenContext): void {
  const { mainVariant, hostname, targetPages } = state;
  const { currentPath, featureFlagEnabled, pluginConfig } = context;

  const isTreatment = mainVariant === 'treatment';
  const isExcluded = mainVariant === 'excluded';

  // Check if current page matches any target page from GOFF config (treatment only)
  const isTargetPage =
    targetPages.length === 0 || targetPages.some((targetPath) => matchPathPattern(targetPath, currentPath));

  // Determine if we should auto-open
  const shouldAutoOpen =
    (isTreatment && isTargetPage) || (isExcluded && (featureFlagEnabled || pluginConfig.openPanelOnLaunch));

  if (!shouldAutoOpen) {
    // If treatment and not on target page, set up navigation listener for future navigation
    if (isTreatment && !isTargetPage && targetPages.length > 0) {
      setupTreatmentNavigationListener(hostname, targetPages);
    }
    return;
  }

  const keys = getStorageKeys(hostname);
  const sessionKey = keys.autoOpened;
  const isOnboardingFlow = isOnboardingFlowPath(currentPath);
  const hasAutoOpened = sessionStorage.getItem(sessionKey);

  // For treatment: check per-page (once per target page pattern)
  // For excluded: check global (once per session)
  const matchingPattern = isTreatment ? shouldAutoOpenForPath(hostname, targetPages, currentPath) : null;
  const shouldOpenNow = isTreatment ? matchingPattern !== null : !hasAutoOpened;

  // Auto-open immediately if not on onboarding flow
  if (shouldOpenNow && !isOnboardingFlow) {
    if (isSidebarAlreadyInUse()) {
      console.log('[Pathfinder] Skipping auto-open: sidebar already in use by another plugin');
    } else {
      if (isTreatment && matchingPattern) {
        markParentAutoOpened(hostname, matchingPattern);
      } else if (!isTreatment) {
        markGlobalAutoOpened(hostname);
      }
      sidebarState.setPendingOpenSource(isTreatment ? 'experiment_treatment' : 'auto_open', 'auto-open');
      attemptAutoOpen(200);
    }
  }

  // If user starts on onboarding flow, set up listener for navigation away
  if ((isTreatment || !hasAutoOpened) && isOnboardingFlow) {
    setupOnboardingFlowListener(hostname, targetPages, isTreatment, sessionKey);
  }

  // For treatment not on target page, set up navigation listener
  if (isTreatment && !isTargetPage && targetPages.length > 0) {
    setupTreatmentNavigationListener(hostname, targetPages);
  }
}

/**
 * Sets up listener for navigation away from onboarding flow.
 */
function setupOnboardingFlowListener(
  hostname: string,
  targetPages: string[],
  isTreatment: boolean,
  sessionKey: string
): void {
  const checkLocationChange = () => {
    const newLocation = locationService.getLocation();
    const newPath = newLocation.pathname || window.location.pathname || '';
    const stillOnOnboarding = isOnboardingFlowPath(newPath);
    const alreadyOpened = sessionStorage.getItem(sessionKey);

    const newMatchingPattern = isTreatment ? shouldAutoOpenForPath(hostname, targetPages, newPath) : null;
    const shouldOpenAfterOnboarding = isTreatment ? newMatchingPattern !== null : !alreadyOpened;

    if (!stillOnOnboarding && shouldOpenAfterOnboarding) {
      if (isSidebarAlreadyInUse()) {
        console.log('[Pathfinder] Skipping auto-open after onboarding: sidebar already in use');
      } else {
        if (isTreatment && newMatchingPattern) {
          markParentAutoOpened(hostname, newMatchingPattern);
        } else if (!isTreatment) {
          markGlobalAutoOpened(hostname);
        }
        sidebarState.setPendingOpenSource(
          isTreatment ? 'experiment_treatment_after_onboarding' : 'auto_open_after_onboarding',
          'auto-open'
        );
        attemptAutoOpen(500);
      }
    }
  };

  document.addEventListener('grafana:location-changed', checkLocationChange);

  try {
    const history = locationService.getHistory();
    if (history) {
      const unlisten = history.listen(checkLocationChange);
      (window as any).__pathfinderAutoOpenUnlisten = unlisten;
    }
  } catch (error) {
    window.addEventListener('popstate', checkLocationChange);
  }
}

/**
 * Sets up listener for navigation to target pages (treatment variant).
 */
function setupTreatmentNavigationListener(hostname: string, targetPages: string[]): void {
  const checkNavigationToTargetPage = () => {
    const newLocation = locationService.getLocation();
    const newPath = newLocation.pathname || window.location.pathname || '';

    const matchingPattern = shouldAutoOpenForPath(hostname, targetPages, newPath);

    if (matchingPattern) {
      if (isSidebarAlreadyInUse()) {
        console.log('[Pathfinder] Skipping auto-open on navigation: sidebar already in use');
      } else {
        markParentAutoOpened(hostname, matchingPattern);
        sidebarState.setPendingOpenSource('experiment_treatment_navigation', 'auto-open');
        attemptAutoOpen(300);
      }
    }
  };

  document.addEventListener('grafana:location-changed', checkNavigationToTargetPage);

  try {
    const history = locationService.getHistory();
    if (history) {
      const unlisten = history.listen(checkNavigationToTargetPage);
      (window as any).__pathfinderTreatmentNavUnlisten = unlisten;
    }
  } catch (error) {
    window.addEventListener('popstate', checkNavigationToTargetPage);
  }
}

/**
 * Sets up auto-open logic for the after-24h experiment.
 * Only triggers for treatment variant with accounts >= 24 hours old.
 */
export function setupAfter24hAutoOpen(state: ExperimentState, currentPath: string): void {
  const { after24hVariant, hostname } = state;

  if (after24hVariant !== 'treatment') {
    return;
  }

  const hasAlreadyOpened = hasAfter24hAutoOpened(hostname);
  const isOnboardingFlow = isOnboardingFlowPath(currentPath);

  // Only proceed if we haven't auto-opened in this session and not on onboarding
  if (!hasAlreadyOpened && !isOnboardingFlow) {
    isUserAccountOlderThan24Hours().then((isOldEnough) => {
      if (isOldEnough) {
        // Check again if auto-opened while we were fetching (race condition guard)
        if (hasAfter24hAutoOpened(hostname)) {
          return;
        }

        if (isSidebarAlreadyInUse()) {
          console.log('[Pathfinder] Skipping after-24h auto-open: sidebar already in use by another plugin');
          return;
        }

        markAfter24hAutoOpened(hostname);
        sidebarState.setPendingOpenSource('after_24h_experiment_treatment', 'auto-open');
        attemptAutoOpen(200);
        console.log('[Pathfinder] After-24h experiment: auto-opening for user with account >= 24 hours old');
      } else {
        console.log('[Pathfinder] After-24h experiment: user account is less than 24 hours old, skipping auto-open');
      }
    });
  }

  // If user starts on onboarding flow, listen for navigation away from it
  if (!hasAlreadyOpened && isOnboardingFlow) {
    setupAfter24hOnboardingFlowListener(hostname);
  }
}

/**
 * Sets up listener for navigation away from onboarding flow (after-24h experiment).
 */
function setupAfter24hOnboardingFlowListener(hostname: string): void {
  const checkAfter24hLocationChange = () => {
    const newLocation = locationService.getLocation();
    const newPath = newLocation.pathname || window.location.pathname || '';
    const stillOnOnboarding = isOnboardingFlowPath(newPath);
    const alreadyOpened = hasAfter24hAutoOpened(hostname);

    if (!stillOnOnboarding && !alreadyOpened) {
      isUserAccountOlderThan24Hours().then((isOldEnough) => {
        // Re-check storage after async operation
        if (hasAfter24hAutoOpened(hostname)) {
          return;
        }

        if (isOldEnough) {
          if (isSidebarAlreadyInUse()) {
            console.log('[Pathfinder] Skipping after-24h auto-open after onboarding: sidebar already in use');
            return;
          }

          markAfter24hAutoOpened(hostname);
          sidebarState.setPendingOpenSource('after_24h_experiment_treatment_after_onboarding', 'auto-open');
          attemptAutoOpen(500);
          console.log(
            '[Pathfinder] After-24h experiment: auto-opening after onboarding for user with account >= 24 hours old'
          );
        }
      });
    }
  };

  document.addEventListener('grafana:location-changed', checkAfter24hLocationChange);

  try {
    const history = locationService.getHistory();
    if (history) {
      const unlisten = history.listen(checkAfter24hLocationChange);
      (window as any).__pathfinderAfter24hNavUnlisten = unlisten;
    }
  } catch (error) {
    window.addEventListener('popstate', checkAfter24hLocationChange);
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Gets the auto-open feature flag value.
 */
export function getAutoOpenFeatureFlag(): boolean {
  return getFeatureFlagValue('pathfinder.auto-open-sidebar', false);
}

/**
 * Gets the current path from location service.
 */
export function getCurrentPath(): string {
  const location = locationService.getLocation();
  return location.pathname || window.location.pathname || '';
}
