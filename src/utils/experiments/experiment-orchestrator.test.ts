/**
 * Tests for experiment-orchestrator module
 *
 * Tests the high-level orchestration logic for experiments:
 * - Experiment initialization
 * - Sidebar mounting decisions
 * - Auto-open triggering
 */

// Mock plugin.json
jest.mock('../../plugin.json', () => ({
  id: 'grafana-pathfinder-app',
}));

// Mock @grafana/runtime
const mockPublish = jest.fn();
const mockGetLocation = jest.fn().mockReturnValue({ pathname: '/dashboard' });
const mockGetHistory = jest.fn().mockReturnValue({ listen: jest.fn() });

jest.mock('@grafana/runtime', () => ({
  getAppEvents: jest.fn(() => ({
    publish: mockPublish,
  })),
  locationService: {
    getLocation: () => mockGetLocation(),
    getHistory: () => mockGetHistory(),
  },
}));

// Mock user-storage
jest.mock('../../lib/user-storage', () => ({
  experimentAutoOpenStorage: {
    markPageAutoOpened: jest.fn().mockResolvedValue(undefined),
    markGlobalAutoOpened: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue({ pagesAutoOpened: [], globalAutoOpened: false }),
    reset: jest.fn().mockResolvedValue(undefined),
  },
  StorageKeys: {
    EXPERIMENT_TREATMENT_PAGE_PREFIX: 'grafana-pathfinder-treatment-page-',
    EXPERIMENT_SESSION_AUTO_OPENED_PREFIX: 'grafana-interactive-learning-panel-auto-opened-',
    EXPERIMENT_RESET_PROCESSED_PREFIX: 'grafana-pathfinder-pop-open-reset-processed-',
    AFTER_24H_SESSION_AUTO_OPENED_PREFIX: 'grafana-pathfinder-after-24h-auto-opened-',
    AFTER_24H_RESET_PROCESSED_PREFIX: 'grafana-pathfinder-after-24h-reset-processed-',
  },
}));

// Mock sidebar state
jest.mock('../../global-state/sidebar', () => ({
  sidebarState: {
    setPendingOpenSource: jest.fn(),
  },
}));

// Mock openfeature - declare functions first to avoid hoisting issues
const mockGetExperimentConfig = jest.fn();
const mockGetFeatureFlagValue = jest.fn();

jest.mock('../openfeature', () => ({
  getExperimentConfig: () => mockGetExperimentConfig(),
  getFeatureFlagValue: (flag: string, defaultValue: boolean) => mockGetFeatureFlagValue(flag, defaultValue),
  matchPathPattern: (pattern: string, path: string) => {
    if (pattern.endsWith('*')) {
      return path.startsWith(pattern.slice(0, -1));
    }
    return path === pattern || path === pattern + '/';
  },
}));

// Mock experiment-utils
jest.mock('./experiment-utils', () => {
  const actual = jest.requireActual('./experiment-utils');
  return {
    ...actual,
    isUserAccountOlderThan24Hours: jest.fn(),
  };
});

import {
  initializeExperiments,
  shouldMountSidebar,
  attemptAutoOpen,
  getAutoOpenFeatureFlag,
  getCurrentPath,
} from './experiment-orchestrator';
import { isUserAccountOlderThan24Hours } from './experiment-utils';

describe('experiment-orchestrator', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    jest.clearAllMocks();

    // Default mock values
    mockGetExperimentConfig.mockReturnValue({
      variant: 'excluded',
      pages: [],
      resetCache: false,
    });
    mockGetFeatureFlagValue.mockReturnValue(false);
    mockGetLocation.mockReturnValue({ pathname: '/dashboard' });
  });

  describe('initializeExperiments', () => {
    it('should return experiment state with main config', () => {
      mockGetExperimentConfig
        .mockReturnValueOnce({
          variant: 'treatment',
          pages: ['/a/grafana-irm-app*'],
          resetCache: false,
        })
        .mockReturnValueOnce({
          variant: 'excluded',
          pages: [],
          resetCache: false,
        });

      const state = initializeExperiments();

      expect(state.mainVariant).toBe('treatment');
      expect(state.targetPages).toEqual(['/a/grafana-irm-app*']);
      expect(state.after24hVariant).toBe('excluded');
    });

    it('should handle resetCache for main experiment', () => {
      mockGetExperimentConfig
        .mockReturnValueOnce({
          variant: 'treatment',
          pages: [],
          resetCache: true,
        })
        .mockReturnValueOnce({
          variant: 'excluded',
          pages: [],
          resetCache: false,
        });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      initializeExperiments();

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Pathfinder] Pop-open reset triggered: cleared auto-open tracking in all storages'
      );
      consoleSpy.mockRestore();
    });

    it('should handle resetCache for after-24h experiment', () => {
      mockGetExperimentConfig
        .mockReturnValueOnce({
          variant: 'excluded',
          pages: [],
          resetCache: false,
        })
        .mockReturnValueOnce({
          variant: 'treatment',
          pages: [],
          resetCache: true,
        });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      initializeExperiments();

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Pathfinder] After-24h pop-open reset triggered: cleared auto-open tracking'
      );
      consoleSpy.mockRestore();
    });

    it('should log experiment configs', () => {
      mockGetExperimentConfig
        .mockReturnValueOnce({
          variant: 'treatment',
          pages: ['/a/grafana-irm-app*'],
          resetCache: false,
        })
        .mockReturnValueOnce({
          variant: 'control',
          pages: [],
          resetCache: false,
        });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      initializeExperiments();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Pathfinder] Experiment config loaded: variant="treatment"')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Pathfinder] After-24h experiment config loaded: variant="control"')
      );
      consoleSpy.mockRestore();
    });
  });

  describe('shouldMountSidebar', () => {
    it('should return true when both variants are excluded', () => {
      expect(shouldMountSidebar('excluded', 'excluded')).toBe(true);
    });

    it('should return true when both variants are treatment', () => {
      expect(shouldMountSidebar('treatment', 'treatment')).toBe(true);
    });

    it('should return false when main variant is control', () => {
      expect(shouldMountSidebar('control', 'excluded')).toBe(false);
      expect(shouldMountSidebar('control', 'treatment')).toBe(false);
    });

    it('should return false when after24h variant is control', () => {
      expect(shouldMountSidebar('excluded', 'control')).toBe(false);
      expect(shouldMountSidebar('treatment', 'control')).toBe(false);
    });

    it('should return false when both variants are control', () => {
      expect(shouldMountSidebar('control', 'control')).toBe(false);
    });

    it('should return true for mixed treatment/excluded', () => {
      expect(shouldMountSidebar('treatment', 'excluded')).toBe(true);
      expect(shouldMountSidebar('excluded', 'treatment')).toBe(true);
    });
  });

  describe('attemptAutoOpen', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should publish open-extension-sidebar event after delay', () => {
      attemptAutoOpen(200);

      expect(mockPublish).not.toHaveBeenCalled();

      jest.advanceTimersByTime(200);

      expect(mockPublish).toHaveBeenCalledWith({
        type: 'open-extension-sidebar',
        payload: {
          pluginId: 'grafana-pathfinder-app',
          componentTitle: 'Interactive learning',
        },
      });
    });

    it('should use default delay of 200ms', () => {
      attemptAutoOpen();

      jest.advanceTimersByTime(199);
      expect(mockPublish).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(mockPublish).toHaveBeenCalled();
    });

    it('should handle publish errors gracefully', () => {
      mockPublish.mockImplementation(() => {
        throw new Error('Publish failed');
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      attemptAutoOpen(0);
      jest.advanceTimersByTime(0);

      expect(consoleSpy).toHaveBeenCalledWith('Failed to auto-open Interactive learning panel:', expect.any(Error));
      consoleSpy.mockRestore();
    });
  });

  describe('getAutoOpenFeatureFlag', () => {
    it('should return feature flag value', () => {
      mockGetFeatureFlagValue.mockReturnValue(true);

      const result = getAutoOpenFeatureFlag();

      expect(result).toBe(true);
      expect(mockGetFeatureFlagValue).toHaveBeenCalledWith('pathfinder.auto-open-sidebar', false);
    });

    it('should return false by default', () => {
      mockGetFeatureFlagValue.mockReturnValue(false);

      const result = getAutoOpenFeatureFlag();

      expect(result).toBe(false);
    });
  });

  describe('getCurrentPath', () => {
    it('should return pathname from location service', () => {
      mockGetLocation.mockReturnValue({ pathname: '/a/grafana-irm-app/integrations' });

      const result = getCurrentPath();

      expect(result).toBe('/a/grafana-irm-app/integrations');
    });

    it('should fallback to window.location.pathname when locationService returns null', () => {
      mockGetLocation.mockReturnValue({ pathname: null });

      const result = getCurrentPath();

      // Falls back to window.location.pathname which is "/" in JSDOM
      expect(result).toBe('/');
    });
  });

  describe('after-24h auto-open', () => {
    it('should check user account age for treatment variant', async () => {
      (isUserAccountOlderThan24Hours as jest.Mock).mockResolvedValue(true);

      mockGetExperimentConfig
        .mockReturnValueOnce({
          variant: 'excluded',
          pages: [],
          resetCache: false,
        })
        .mockReturnValueOnce({
          variant: 'treatment',
          pages: [],
          resetCache: false,
        });

      const state = initializeExperiments();

      expect(state.after24hVariant).toBe('treatment');
    });
  });
});
