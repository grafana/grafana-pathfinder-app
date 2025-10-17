/**
 * Dev mode utility for per-user developer features
 *
 * Dev mode enables developer/testing features like the SelectorDebugPanel.
 * It's stored in localStorage to be per-user/per-browser, not instance-wide.
 */

const DEV_MODE_KEY = 'grafana-pathfinder-dev-mode';

/**
 * Check if dev mode is enabled for the current user
 * Can be enabled via:
 * 1. localStorage setting (persistent per-user)
 * 2. URL parameter ?dev=true (temporary)
 */
export const isDevModeEnabled = (): boolean => {
  // Check URL parameter first (temporary override)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('dev') === 'true') {
    return true;
  }

  // Check localStorage (persistent per-user setting)
  try {
    return localStorage.getItem(DEV_MODE_KEY) === 'true';
  } catch (e) {
    console.warn('Failed to read dev mode from localStorage:', e);
    return false;
  }
};

/**
 * Enable dev mode for the current user
 */
export const enableDevMode = (): void => {
  try {
    localStorage.setItem(DEV_MODE_KEY, 'true');
  } catch (e) {
    console.error('Failed to enable dev mode in localStorage:', e);
  }
};

/**
 * Disable dev mode for the current user
 */
export const disableDevMode = (): void => {
  try {
    localStorage.removeItem(DEV_MODE_KEY);
  } catch (e) {
    console.error('Failed to disable dev mode in localStorage:', e);
  }
};

/**
 * Toggle dev mode for the current user
 */
export const toggleDevMode = (): boolean => {
  const newValue = !isDevModeEnabled();
  if (newValue) {
    enableDevMode();
  } else {
    disableDevMode();
  }
  return newValue;
};

