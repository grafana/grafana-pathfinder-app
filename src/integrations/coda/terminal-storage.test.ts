/**
 * Characterization / tripwire tests for terminal-storage.
 *
 * Pins the public contract before any routing through `UserStorage` happens:
 *   - localStorage-backed UI prefs (isOpen, height) with height clamping
 *   - sessionStorage-backed session state (wasConnected, scrollback, lastVmOpts)
 *   - scrollback truncation policy (`MAX_SCROLLBACK_SIZE` = 100_000)
 *   - JSON parse failures fall back to `undefined` rather than throw
 *   - All writes swallow `QuotaExceededError`-class failures
 */
import { StorageKeys } from '../../lib/storage-keys';

import {
  clearScrollback,
  clearSessionStorage,
  clearTerminalStorage,
  DEFAULT_HEIGHT,
  getLastVmOpts,
  getScrollback,
  getTerminalHeight,
  getTerminalOpen,
  getWasConnected,
  MAX_HEIGHT,
  MIN_HEIGHT,
  setLastVmOpts,
  setScrollback,
  setTerminalHeight,
  setTerminalOpen,
  setWasConnected,
} from './terminal-storage';

const MAX_SCROLLBACK_SIZE = 100_000;

describe('terminal-storage (UI prefs, localStorage)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  describe('terminal open/closed', () => {
    it('defaults to false when key is absent', () => {
      expect(getTerminalOpen()).toBe(false);
    });

    it('round-trips true', () => {
      setTerminalOpen(true);
      expect(localStorage.getItem(StorageKeys.CODA_TERMINAL_IS_OPEN)).toBe('true');
      expect(getTerminalOpen()).toBe(true);
    });

    it('round-trips false', () => {
      setTerminalOpen(false);
      expect(localStorage.getItem(StorageKeys.CODA_TERMINAL_IS_OPEN)).toBe('false');
      expect(getTerminalOpen()).toBe(false);
    });

    it('treats any non-"true" value as false', () => {
      localStorage.setItem(StorageKeys.CODA_TERMINAL_IS_OPEN, 'TRUE');
      expect(getTerminalOpen()).toBe(false);
    });
  });

  describe('terminal height', () => {
    it('returns DEFAULT_HEIGHT when key is absent', () => {
      expect(getTerminalHeight()).toBe(DEFAULT_HEIGHT);
    });

    it('round-trips a valid height', () => {
      setTerminalHeight(300);
      expect(getTerminalHeight()).toBe(300);
    });

    it('clamps values above MAX_HEIGHT on write', () => {
      setTerminalHeight(MAX_HEIGHT + 100);
      expect(getTerminalHeight()).toBe(MAX_HEIGHT);
    });

    it('clamps values below MIN_HEIGHT on write', () => {
      setTerminalHeight(MIN_HEIGHT - 50);
      expect(getTerminalHeight()).toBe(MIN_HEIGHT);
    });

    it('falls back to DEFAULT_HEIGHT when stored value is out of range', () => {
      localStorage.setItem(StorageKeys.CODA_TERMINAL_HEIGHT, String(MAX_HEIGHT + 1));
      expect(getTerminalHeight()).toBe(DEFAULT_HEIGHT);
    });

    it('falls back to DEFAULT_HEIGHT when stored value is not numeric', () => {
      localStorage.setItem(StorageKeys.CODA_TERMINAL_HEIGHT, 'tall');
      expect(getTerminalHeight()).toBe(DEFAULT_HEIGHT);
    });
  });

  describe('clearTerminalStorage', () => {
    it('removes only the localStorage UI keys', () => {
      setTerminalOpen(true);
      setTerminalHeight(250);
      setWasConnected(true);

      clearTerminalStorage();

      expect(localStorage.getItem(StorageKeys.CODA_TERMINAL_IS_OPEN)).toBeNull();
      expect(localStorage.getItem(StorageKeys.CODA_TERMINAL_HEIGHT)).toBeNull();
      expect(sessionStorage.getItem(StorageKeys.CODA_TERMINAL_WAS_CONNECTED)).toBe('true');
    });
  });
});

describe('terminal-storage (session state, sessionStorage)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  describe('wasConnected', () => {
    it('defaults to false when absent', () => {
      expect(getWasConnected()).toBe(false);
    });

    it('writes "true" to sessionStorage on setWasConnected(true)', () => {
      setWasConnected(true);
      expect(sessionStorage.getItem(StorageKeys.CODA_TERMINAL_WAS_CONNECTED)).toBe('true');
      expect(getWasConnected()).toBe(true);
    });

    it('removes the key on setWasConnected(false)', () => {
      setWasConnected(true);
      setWasConnected(false);
      expect(sessionStorage.getItem(StorageKeys.CODA_TERMINAL_WAS_CONNECTED)).toBeNull();
      expect(getWasConnected()).toBe(false);
    });
  });

  describe('lastVmOpts', () => {
    it('returns undefined when key is absent', () => {
      expect(getLastVmOpts()).toBeUndefined();
    });

    it('round-trips a populated opts object', () => {
      setLastVmOpts({ template: 't', app: 'a', scenario: 's' });
      expect(getLastVmOpts()).toEqual({ template: 't', app: 'a', scenario: 's' });
    });

    it('returns undefined on malformed JSON instead of throwing', () => {
      sessionStorage.setItem(StorageKeys.CODA_TERMINAL_LAST_VM_OPTS, '{not json');
      expect(() => getLastVmOpts()).not.toThrow();
      expect(getLastVmOpts()).toBeUndefined();
    });

    it('removes the key when set to undefined', () => {
      setLastVmOpts({ template: 't' });
      setLastVmOpts(undefined);
      expect(sessionStorage.getItem(StorageKeys.CODA_TERMINAL_LAST_VM_OPTS)).toBeNull();
    });

    it('removes the key when set to an empty object', () => {
      setLastVmOpts({ template: 't' });
      setLastVmOpts({});
      expect(sessionStorage.getItem(StorageKeys.CODA_TERMINAL_LAST_VM_OPTS)).toBeNull();
    });
  });

  describe('scrollback', () => {
    it('returns null when key is absent', () => {
      expect(getScrollback()).toBeNull();
    });

    it('round-trips short content untouched', () => {
      setScrollback('hello');
      expect(getScrollback()).toBe('hello');
    });

    it('truncates from the start when content exceeds MAX_SCROLLBACK_SIZE', () => {
      const oversized = 'x'.repeat(MAX_SCROLLBACK_SIZE) + 'TAIL';
      setScrollback(oversized);
      const result = getScrollback();
      expect(result).not.toBeNull();
      expect(result!.length).toBe(MAX_SCROLLBACK_SIZE);
      // Most-recent suffix preserved — the truncation slices `-MAX_SCROLLBACK_SIZE`.
      expect(result!.endsWith('TAIL')).toBe(true);
    });

    it('clearScrollback removes the key', () => {
      setScrollback('content');
      clearScrollback();
      expect(getScrollback()).toBeNull();
    });
  });

  describe('clearSessionStorage', () => {
    it('removes all session keys but leaves localStorage UI prefs intact', () => {
      setTerminalOpen(true);
      setTerminalHeight(250);
      setWasConnected(true);
      setScrollback('content');
      setLastVmOpts({ template: 't' });

      clearSessionStorage();

      expect(sessionStorage.getItem(StorageKeys.CODA_TERMINAL_WAS_CONNECTED)).toBeNull();
      expect(sessionStorage.getItem(StorageKeys.CODA_TERMINAL_SCROLLBACK)).toBeNull();
      expect(sessionStorage.getItem(StorageKeys.CODA_TERMINAL_LAST_VM_OPTS)).toBeNull();

      expect(localStorage.getItem(StorageKeys.CODA_TERMINAL_IS_OPEN)).toBe('true');
      expect(localStorage.getItem(StorageKeys.CODA_TERMINAL_HEIGHT)).toBe('250');
    });
  });
});

describe('terminal-storage (failure swallowing)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('does not throw when localStorage.setItem throws (e.g. QuotaExceededError)', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = jest.fn(() => {
      throw new Error('QuotaExceededError');
    });

    try {
      expect(() => setTerminalOpen(true)).not.toThrow();
      expect(() => setTerminalHeight(200)).not.toThrow();
      expect(() => setScrollback('x')).not.toThrow();
      expect(() => setLastVmOpts({ template: 't' })).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it('falls back to defaults when localStorage.getItem throws', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = jest.fn(() => {
      throw new Error('storage unavailable');
    });

    try {
      expect(getTerminalOpen()).toBe(false);
      expect(getTerminalHeight()).toBe(DEFAULT_HEIGHT);
      expect(getWasConnected()).toBe(false);
      expect(getScrollback()).toBeNull();
      expect(getLastVmOpts()).toBeUndefined();
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});
