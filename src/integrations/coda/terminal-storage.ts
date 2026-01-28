/**
 * Terminal panel localStorage persistence utilities
 *
 * Stores UI state (open/closed, height) for the terminal panel.
 * No sensitive data is stored - only visual preferences.
 */

const STORAGE_PREFIX = 'pathfinder-coda-terminal';

const KEYS = {
  isOpen: `${STORAGE_PREFIX}-is-open`,
  height: `${STORAGE_PREFIX}-height`,
} as const;

// Default values
const DEFAULT_HEIGHT = 200; // pixels
const MIN_HEIGHT = 100;
const MAX_HEIGHT = 600;

/**
 * Get whether the terminal panel is open
 */
export const getTerminalOpen = (): boolean => {
  try {
    const stored = localStorage.getItem(KEYS.isOpen);
    return stored === 'true';
  } catch {
    return false;
  }
};

/**
 * Set whether the terminal panel is open
 */
export const setTerminalOpen = (isOpen: boolean): void => {
  try {
    localStorage.setItem(KEYS.isOpen, String(isOpen));
  } catch {
    // Ignore storage errors
  }
};

/**
 * Get the terminal panel height in pixels
 */
export const getTerminalHeight = (): number => {
  try {
    const stored = localStorage.getItem(KEYS.height);
    if (stored) {
      const height = parseInt(stored, 10);
      if (!isNaN(height) && height >= MIN_HEIGHT && height <= MAX_HEIGHT) {
        return height;
      }
    }
    return DEFAULT_HEIGHT;
  } catch {
    return DEFAULT_HEIGHT;
  }
};

/**
 * Set the terminal panel height in pixels
 */
export const setTerminalHeight = (height: number): void => {
  try {
    // Clamp to valid range
    const clampedHeight = Math.min(Math.max(height, MIN_HEIGHT), MAX_HEIGHT);
    localStorage.setItem(KEYS.height, String(clampedHeight));
  } catch {
    // Ignore storage errors
  }
};

/**
 * Clear all terminal storage
 */
export const clearTerminalStorage = (): void => {
  try {
    localStorage.removeItem(KEYS.isOpen);
    localStorage.removeItem(KEYS.height);
  } catch {
    // Ignore storage errors
  }
};

// Export constants for use in components
export { DEFAULT_HEIGHT, MIN_HEIGHT, MAX_HEIGHT };
