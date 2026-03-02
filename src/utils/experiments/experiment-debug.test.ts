/**
 * Tests for experiment-debug module
 *
 * Tests the debug utilities exposed on window.__pathfinderExperiment
 */

// Mock user-storage
jest.mock('../../lib/user-storage', () => ({
  experimentAutoOpenStorage: {
    markPageAutoOpened: jest.fn().mockResolvedValue(undefined),
    markGlobalAutoOpened: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue({ pagesAutoOpened: [], globalAutoOpened: false }),
    reset: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  },
  StorageKeys: {
    EXPERIMENT_TREATMENT_PAGE_PREFIX: 'grafana-pathfinder-treatment-page-',
    EXPERIMENT_SESSION_AUTO_OPENED_PREFIX: 'grafana-interactive-learning-panel-auto-opened-',
    EXPERIMENT_RESET_PROCESSED_PREFIX: 'grafana-pathfinder-pop-open-reset-processed-',
    AFTER_24H_SESSION_AUTO_OPENED_PREFIX: 'grafana-pathfinder-after-24h-auto-opened-',
    AFTER_24H_RESET_PROCESSED_PREFIX: 'grafana-pathfinder-after-24h-reset-processed-',
  },
}));

// Mock openfeature
const mockGetExperimentConfig = jest.fn();

jest.mock('../openfeature', () => ({
  getExperimentConfig: () => mockGetExperimentConfig(),
}));

import { createExperimentDebugger, logExperimentConfig } from './experiment-debug';
import type { ExperimentConfig } from '../openfeature';

describe('experiment-debug', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    jest.clearAllMocks();

    // Clear any existing debugger
    delete (window as any).__pathfinderExperiment;
  });

  describe('createExperimentDebugger', () => {
    const mockConfig: ExperimentConfig = {
      variant: 'treatment',
      pages: ['/a/grafana-irm-app*'],
      resetCache: false,
    };

    it('should expose debug object on window', () => {
      createExperimentDebugger(mockConfig);

      expect((window as any).__pathfinderExperiment).toBeDefined();
    });

    it('should expose config properties', () => {
      createExperimentDebugger(mockConfig);

      const debugger_ = (window as any).__pathfinderExperiment;

      expect(debugger_.config).toEqual(mockConfig);
      expect(debugger_.variant).toBe('treatment');
      expect(debugger_.loadedAt).toBeDefined();
    });

    describe('refetch', () => {
      it('should refetch config from GOFF', () => {
        createExperimentDebugger(mockConfig);
        mockGetExperimentConfig.mockReturnValue({
          variant: 'control',
          pages: [],
          resetCache: true,
        });

        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

        const result = (window as any).__pathfinderExperiment.refetch();

        expect(result).toEqual({
          variant: 'control',
          pages: [],
          resetCache: true,
        });
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[Pathfinder] Experiment config comparison:'));
        consoleSpy.mockRestore();
      });

      it('should rate limit refetch calls', () => {
        createExperimentDebugger(mockConfig);
        mockGetExperimentConfig.mockReturnValue(mockConfig);

        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

        // First call should work
        const result1 = (window as any).__pathfinderExperiment.refetch();
        expect(result1).toBeDefined();

        // Second call should be rate limited
        const result2 = (window as any).__pathfinderExperiment.refetch();
        expect(result2).toBeNull();
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Refetch rate limited'));

        consoleSpy.mockRestore();
      });
    });

    describe('clearCache', () => {
      it('should clear all storage', async () => {
        createExperimentDebugger(mockConfig);

        // Set some storage values using the actual hostname from window.location
        const actualHostname = window.location.hostname;
        const keys = {
          resetProcessed: `grafana-pathfinder-pop-open-reset-processed-${actualHostname}`,
          autoOpened: `grafana-interactive-learning-panel-auto-opened-${actualHostname}`,
        };
        localStorage.setItem(keys.resetProcessed, 'true');
        sessionStorage.setItem(keys.autoOpened, 'true');

        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

        const result = await (window as any).__pathfinderExperiment.clearCache();

        expect(result.cleared).toBe(true);
        expect(localStorage.getItem(keys.resetProcessed)).toBeNull();
        expect(sessionStorage.getItem(keys.autoOpened)).toBeNull();
        consoleSpy.mockRestore();
      });

      it('should clear per-page treatment keys', async () => {
        createExperimentDebugger(mockConfig);

        const actualHostname = window.location.hostname;
        const prefix = `grafana-pathfinder-treatment-page-${actualHostname}-`;
        sessionStorage.setItem(`${prefix}/a/grafana-irm-app`, 'true');
        sessionStorage.setItem(`${prefix}/a/grafana-synthetic-monitoring-app`, 'true');

        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

        const result = await (window as any).__pathfinderExperiment.clearCache();

        expect(result.perPageKeysCleared).toBe(2);
        expect(sessionStorage.getItem(`${prefix}/a/grafana-irm-app`)).toBeNull();
        expect(sessionStorage.getItem(`${prefix}/a/grafana-synthetic-monitoring-app`)).toBeNull();
        consoleSpy.mockRestore();
      });

      it('should clear after-24h session storage', async () => {
        createExperimentDebugger(mockConfig);

        const actualHostname = window.location.hostname;
        const after24hKey = `grafana-pathfinder-after-24h-auto-opened-${actualHostname}`;
        sessionStorage.setItem(after24hKey, 'true');

        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

        await (window as any).__pathfinderExperiment.clearCache();

        expect(sessionStorage.getItem(after24hKey)).toBeNull();
        consoleSpy.mockRestore();
      });

      it('should call experimentAutoOpenStorage.clear', async () => {
        const { experimentAutoOpenStorage } = require('../../lib/user-storage');

        createExperimentDebugger(mockConfig);

        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

        await (window as any).__pathfinderExperiment.clearCache();

        expect(experimentAutoOpenStorage.clear).toHaveBeenCalled();
        consoleSpy.mockRestore();
      });
    });

    describe('showCache', () => {
      it('should show current storage state', async () => {
        createExperimentDebugger(mockConfig);

        const actualHostname = window.location.hostname;
        const keys = {
          resetProcessed: `grafana-pathfinder-pop-open-reset-processed-${actualHostname}`,
          autoOpened: `grafana-interactive-learning-panel-auto-opened-${actualHostname}`,
        };
        localStorage.setItem(keys.resetProcessed, 'true');
        sessionStorage.setItem(keys.autoOpened, 'true');

        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

        const result = await (window as any).__pathfinderExperiment.showCache();

        expect(result.localStorage.resetProcessed).toBe('true');
        expect(result.sessionStorage.autoOpened).toBe('true');
        consoleSpy.mockRestore();
      });

      it('should show per-page keys', async () => {
        createExperimentDebugger(mockConfig);

        const actualHostname = window.location.hostname;
        const prefix = `grafana-pathfinder-treatment-page-${actualHostname}-`;
        sessionStorage.setItem(`${prefix}/a/grafana-irm-app`, 'true');

        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

        const result = await (window as any).__pathfinderExperiment.showCache();

        expect(result.perPageKeys[`${prefix}/a/grafana-irm-app`]).toBe('true');
        consoleSpy.mockRestore();
      });

      it('should show after-24h state', async () => {
        createExperimentDebugger(mockConfig);

        const actualHostname = window.location.hostname;
        const after24hKey = `grafana-pathfinder-after-24h-auto-opened-${actualHostname}`;
        sessionStorage.setItem(after24hKey, 'true');

        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

        const result = await (window as any).__pathfinderExperiment.showCache();

        expect(result.sessionStorage.after24hAutoOpened).toBe('true');
        consoleSpy.mockRestore();
      });
    });

    it('should expose storage keys for reference', () => {
      createExperimentDebugger(mockConfig);

      const debugger_ = (window as any).__pathfinderExperiment;
      const actualHostname = window.location.hostname;

      expect(debugger_.storageKeys).toBeDefined();
      expect(debugger_.storageKeys.resetProcessed).toContain(actualHostname);
      expect(debugger_.storageKeys.autoOpened).toContain(actualHostname);
    });
  });

  describe('logExperimentConfig', () => {
    it('should log config with all fields', () => {
      const config: ExperimentConfig = {
        variant: 'treatment',
        pages: ['/a/grafana-irm-app*', '/a/grafana-synthetic-monitoring-app*'],
        resetCache: true,
      };

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      logExperimentConfig(config);

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Pathfinder] Experiment config loaded: variant="treatment", pages=["/a/grafana-irm-app*","/a/grafana-synthetic-monitoring-app*"], resetCache=true'
      );
      consoleSpy.mockRestore();
    });

    it('should log config with empty pages', () => {
      const config: ExperimentConfig = {
        variant: 'excluded',
        pages: [],
        resetCache: false,
      };

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      logExperimentConfig(config);

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Pathfinder] Experiment config loaded: variant="excluded", pages=[], resetCache=false'
      );
      consoleSpy.mockRestore();
    });
  });
});
