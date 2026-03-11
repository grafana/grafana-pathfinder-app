/**
 * Experiment Utilities
 *
 * Storage helpers, path utilities, and user-related checks for experiments.
 * These are pure utility functions that don't depend on experiment orchestration.
 */

import { matchPathPattern } from '../openfeature';
import { experimentAutoOpenStorage, StorageKeys } from '../../lib/user-storage';

// ============================================================================
// STORAGE KEY HELPERS
// ============================================================================

/**
 * Storage keys used by Pathfinder for auto-open tracking
 * Uses centralized key prefixes from StorageKeys
 */
export const getStorageKeys = (hostname: string) => ({
  // localStorage - persists across sessions
  resetProcessed: `${StorageKeys.EXPERIMENT_RESET_PROCESSED_PREFIX}${hostname}`,

  // sessionStorage - cleared when browser closes
  autoOpened: `${StorageKeys.EXPERIMENT_SESSION_AUTO_OPENED_PREFIX}${hostname}`,
  // Legacy global treatment key (kept for backwards compatibility)
  treatmentOpened: `grafana-pathfinder-experiment-treatment-opened-${hostname}`,
  // Per-page treatment prefix
  treatmentPagePrefix: `${StorageKeys.EXPERIMENT_TREATMENT_PAGE_PREFIX}${hostname}-`,
});

// ============================================================================
// PATH UTILITIES
// ============================================================================

/**
 * Extract the parent path from a page pattern for app-level tracking.
 *
 * For app paths (/a/app-id/*), extracts /a/app-id so all pages within
 * an app are tracked together (e.g., all IRM pages count as one).
 *
 * For non-app paths, extracts the first segment (e.g., /dashboard).
 *
 * Examples:
 * - /a/grafana-irm-app/integrations* → /a/grafana-irm-app
 * - /a/grafana-irm-app?tab=home* → /a/grafana-irm-app
 * - /a/grafana-synthetic-monitoring-app* → /a/grafana-synthetic-monitoring-app
 * - /dashboard/snapshots* → /dashboard
 * - /alerting/list* → /alerting
 */
export function getParentPath(pattern: string): string {
  // For app paths (/a/app-id/*), extract /a/app-id
  // Stop at /, *, or ? (query string)
  if (pattern.startsWith('/a/')) {
    const match = pattern.match(/^(\/a\/[^/*?]+)/);
    return match ? match[1]! : pattern;
  }

  // For non-app paths, extract first segment (e.g., /dashboard)
  // Stop at /, *, or ? (query string)
  const match = pattern.match(/^(\/[^/*?]+)/);
  return match ? match[1]! : pattern;
}

/**
 * Get the session storage key for a specific parent path
 */
export function getTreatmentPageKey(hostname: string, parentPath: string): string {
  return `${StorageKeys.EXPERIMENT_TREATMENT_PAGE_PREFIX}${hostname}-${parentPath}`;
}

/**
 * Find which target page pattern matches the current path
 * Returns the first matching pattern or null if no match
 */
export function findMatchingTargetPage(targetPages: string[], currentPath: string): string | null {
  for (const pattern of targetPages) {
    if (matchPathPattern(pattern, currentPath)) {
      return pattern;
    }
  }
  return null;
}

// ============================================================================
// MAIN EXPERIMENT STORAGE HELPERS
// ============================================================================

/**
 * Check if a parent path has already triggered auto-open this session.
 * Uses parent path (e.g., /a/grafana-irm-app) for app-level tracking.
 */
export function hasParentAutoOpened(hostname: string, parentPath: string): boolean {
  const key = getTreatmentPageKey(hostname, parentPath);
  return sessionStorage.getItem(key) === 'true';
}

/**
 * Mark a parent path as having triggered auto-open this session.
 * Writes to both sessionStorage (sync, immediate) and Grafana user storage (async, persistent).
 * Uses parent path (e.g., /a/grafana-irm-app) for app-level tracking.
 */
export function markParentAutoOpened(hostname: string, parentPath: string): void {
  // Write to sessionStorage immediately (sync) for same-session checks
  const key = getTreatmentPageKey(hostname, parentPath);
  sessionStorage.setItem(key, 'true');

  // Also write to Grafana user storage (async) for cross-browser persistence
  // Fire and forget - don't block on this
  experimentAutoOpenStorage.markPageAutoOpened(parentPath).catch((error: unknown) => {
    console.warn('[Pathfinder] Failed to persist parent auto-open to user storage:', error);
  });
}

/**
 * Mark global auto-open as having occurred (excluded variant and 24h experiment treatment)
 * Writes to both localStorage (sync, persists across browser sessions) and Grafana user storage (async, cross-device)
 */
export function markGlobalAutoOpened(hostname: string): void {
  const keys = getStorageKeys(hostname);
  localStorage.setItem(keys.autoOpened, 'true');

  // Also write to Grafana user storage for cross-device persistence
  experimentAutoOpenStorage.markGlobalAutoOpened().catch((error: unknown) => {
    console.warn('[Pathfinder] Failed to persist global auto-open to user storage:', error);
  });
}

/**
 * Sync experiment auto-open state from Grafana user storage to local storage
 * This should be called on app initialization to restore state from previous sessions/devices
 * Returns a promise that resolves when sync is complete
 */
export async function syncExperimentStateFromUserStorage(hostname: string, targetPages: string[]): Promise<void> {
  try {
    const state = await experimentAutoOpenStorage.get();

    // Sync global auto-open state to localStorage (persists across browser sessions)
    if (state.globalAutoOpened) {
      const keys = getStorageKeys(hostname);
      localStorage.setItem(keys.autoOpened, 'true');
    }

    // Sync per-page auto-open state to sessionStorage (per-session tracking)
    for (const pagePattern of state.pagesAutoOpened) {
      const key = getTreatmentPageKey(hostname, pagePattern);
      sessionStorage.setItem(key, 'true');
    }
  } catch (error) {
    console.warn('[Pathfinder] Failed to sync experiment state from user storage:', error);
  }
}

/**
 * Reset experiment auto-open state in both storages
 * Called when resetCache flag is toggled in GOFF
 */
export async function resetExperimentState(hostname: string): Promise<void> {
  const keys = getStorageKeys(hostname);

  // Clear localStorage (global auto-open persists across sessions)
  localStorage.removeItem(keys.autoOpened);

  // Clear sessionStorage (per-page and legacy keys)
  sessionStorage.removeItem(keys.treatmentOpened);

  // Clear per-page keys from sessionStorage
  for (let i = sessionStorage.length - 1; i >= 0; i--) {
    const key = sessionStorage.key(i);
    if (key && key.startsWith(keys.treatmentPagePrefix)) {
      sessionStorage.removeItem(key);
    }
  }

  // Reset Grafana user storage
  await experimentAutoOpenStorage.reset();
}

/**
 * Check if the sidebar should auto-open for the current path.
 * Uses app-level tracking: returns the parent path (e.g., /a/grafana-irm-app)
 * if the path matches a target page and the parent hasn't auto-opened yet.
 *
 * Returns the parent path if should open, null otherwise.
 */
export function shouldAutoOpenForPath(hostname: string, targetPages: string[], currentPath: string): string | null {
  const matchingPattern = findMatchingTargetPage(targetPages, currentPath);
  if (!matchingPattern) {
    return null;
  }

  // Extract parent path for app-level tracking
  const parentPath = getParentPath(matchingPattern);

  // Check if this parent (app) has already auto-opened
  if (hasParentAutoOpened(hostname, parentPath)) {
    return null;
  }

  // Return parent path for tracking (not exact pattern)
  return parentPath;
}

// ============================================================================
// SIDEBAR UTILITIES
// ============================================================================

/**
 * Checks if any extension sidebar is already open/docked in Grafana
 * This prevents Pathfinder from forcefully taking over when another plugin (like Assistant) is in use
 *
 * @returns true if a sidebar is already docked/open, false otherwise
 */
export function isSidebarAlreadyInUse(): boolean {
  try {
    return localStorage.getItem('grafana.navigation.extensionSidebarDocked') !== null;
  } catch {
    // localStorage might be unavailable in some contexts
    return false;
  }
}

/**
 * Check if current path is the onboarding flow
 */
export function isOnboardingFlowPath(path: string): boolean {
  return path.includes('/a/grafana-setupguide-app/onboarding-flow');
}
