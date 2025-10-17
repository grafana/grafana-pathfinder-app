/**
 * Dev mode utility for per-user developer features
 *
 * Dev mode enables developer/testing features like the SelectorDebugPanel.
 * It's stored in localStorage to be per-user/per-browser, not instance-wide.
 */

const DEV_MODE_KEY = 'grafana-pathfinder-dev-mode';

/**
 * Check if dev mode is enabled for the current user
 * Only checks localStorage - the toggle in config is the ONLY way to enable/disable
 */
export const isDevModeEnabled = (): boolean => {
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
 * @returns The new state of dev mode
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
