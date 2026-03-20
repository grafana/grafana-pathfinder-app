/**
 * Terminal panel storage utilities
 *
 * localStorage: UI state (open/closed, height) - persists across sessions
 * sessionStorage: Connection state and scrollback - tab-scoped, cleared on close
 */

const STORAGE_PREFIX = 'pathfinder-coda-terminal';

const KEYS = {
  isOpen: `${STORAGE_PREFIX}-is-open`,
  height: `${STORAGE_PREFIX}-height`,
} as const;

const SESSION_KEYS = {
  wasConnected: `${STORAGE_PREFIX}-was-connected`,
  scrollback: `${STORAGE_PREFIX}-scrollback`,
  lastVmOpts: `${STORAGE_PREFIX}-last-vm-opts`,
} as const;

const MAX_SCROLLBACK_SIZE = 100_000; // ~100KB limit for sessionStorage

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

/**
 * Get whether the terminal was connected before page refresh.
 * Uses sessionStorage so it's tab-scoped and cleared when browser closes.
 */
export const getWasConnected = (): boolean => {
  try {
    return sessionStorage.getItem(SESSION_KEYS.wasConnected) === 'true';
  } catch {
    return false;
  }
};

/**
 * Set whether the terminal is currently connected.
 * Called on successful connection and cleared on explicit disconnect.
 */
export const setWasConnected = (connected: boolean): void => {
  try {
    if (connected) {
      sessionStorage.setItem(SESSION_KEYS.wasConnected, 'true');
    } else {
      sessionStorage.removeItem(SESSION_KEYS.wasConnected);
    }
  } catch {
    // Ignore storage errors
  }
};

/**
 * Persisted VM connection options so auto-reconnect can restore the same
 * template / app / scenario after a page refresh.
 */
interface StoredVmOpts {
  template?: string;
  app?: string;
  scenario?: string;
}

export const getLastVmOpts = (): StoredVmOpts | undefined => {
  try {
    const raw = sessionStorage.getItem(SESSION_KEYS.lastVmOpts);
    if (raw) {
      return JSON.parse(raw) as StoredVmOpts;
    }
  } catch {
    // Ignore parse errors
  }
  return undefined;
};

export const setLastVmOpts = (opts: StoredVmOpts | undefined): void => {
  try {
    if (opts && (opts.template || opts.app || opts.scenario)) {
      sessionStorage.setItem(SESSION_KEYS.lastVmOpts, JSON.stringify(opts));
    } else {
      sessionStorage.removeItem(SESSION_KEYS.lastVmOpts);
    }
  } catch {
    // Ignore storage errors
  }
};

/**
 * Get saved terminal scrollback content for restoration after reconnect.
 */
export const getScrollback = (): string | null => {
  try {
    return sessionStorage.getItem(SESSION_KEYS.scrollback);
  } catch {
    return null;
  }
};

/**
 * Save terminal scrollback content (serialized via xterm serialize addon).
 * Truncates if content exceeds size limit.
 */
export const setScrollback = (content: string): void => {
  try {
    if (content.length > MAX_SCROLLBACK_SIZE) {
      // Truncate from the beginning (keep most recent output)
      const truncated = content.slice(-MAX_SCROLLBACK_SIZE);
      sessionStorage.setItem(SESSION_KEYS.scrollback, truncated);
    } else {
      sessionStorage.setItem(SESSION_KEYS.scrollback, content);
    }
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }
};

/**
 * Clear saved scrollback content.
 */
export const clearScrollback = (): void => {
  try {
    sessionStorage.removeItem(SESSION_KEYS.scrollback);
  } catch {
    // Ignore storage errors
  }
};

/**
 * Clear all session-scoped terminal storage (connection state, scrollback).
 */
export const clearSessionStorage = (): void => {
  try {
    sessionStorage.removeItem(SESSION_KEYS.wasConnected);
    sessionStorage.removeItem(SESSION_KEYS.scrollback);
    sessionStorage.removeItem(SESSION_KEYS.lastVmOpts);
  } catch {
    // Ignore storage errors
  }
};

// Export constants for use in components
export { DEFAULT_HEIGHT, MIN_HEIGHT, MAX_HEIGHT };
