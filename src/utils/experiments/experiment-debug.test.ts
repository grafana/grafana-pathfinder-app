/**
 * Tests for experiment-debug module
 *
 * Tests the trimmed debug surface exposed on window.__pathfinderExperiment:
 * flag overrides + analytics exposure inspection for the highlighted-guide experiment.
 */

jest.mock('../../lib/storage-keys', () => ({
  StorageKeys: {
    EXPERIMENT_EXPOSURE_REPORTED_PREFIX: 'grafana-pathfinder-experiment-exposure-reported-',
  },
}));

const mockOverrides: Record<string, unknown> = {};

jest.mock('../openfeature', () => ({
  setFlagOverride: (flag: string, value: unknown) => {
    mockOverrides[flag] = value;
  },
  removeFlagOverride: (flag: string) => {
    delete mockOverrides[flag];
  },
  clearFlagOverrides: () => {
    Object.keys(mockOverrides).forEach((key) => delete mockOverrides[key]);
  },
  getFlagOverrides: () => ({ ...mockOverrides }),
  pathfinderFeatureFlags: {
    'pathfinder.enabled': { valueType: 'boolean', defaultValue: true },
    'pathfinder.auto-open-sidebar': { valueType: 'boolean', defaultValue: false },
    'pathfinder.highlighted-guide-experiment': { valueType: 'object', defaultValue: {} },
  },
}));

import { createExperimentDebugger } from './experiment-debug';
import type { HighlightedGuideConfig } from '../openfeature';

describe('experiment-debug', () => {
  const mockConfig: HighlightedGuideConfig = {
    variant: 'treatment',
    pages: ['/a/grafana-irm-app*'],
    guideId: 'bundled:test-guide',
    autoOpen: true,
    resetCache: false,
  };

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    jest.clearAllMocks();
    Object.keys(mockOverrides).forEach((key) => delete mockOverrides[key]);
    delete (window as any).__pathfinderExperiment;
  });

  describe('createExperimentDebugger', () => {
    it('should expose debug object on window', () => {
      createExperimentDebugger(mockConfig);

      expect((window as any).__pathfinderExperiment).toBeDefined();
    });

    it('should expose highlighted-guide config properties', () => {
      createExperimentDebugger(mockConfig);

      const debugger_ = (window as any).__pathfinderExperiment;

      expect(debugger_.config).toEqual(mockConfig);
      expect(debugger_.variant).toBe('treatment');
      expect(debugger_.loadedAt).toBeDefined();
    });

    describe('flag overrides', () => {
      it('should expose known flag names', () => {
        createExperimentDebugger(mockConfig);

        const debugger_ = (window as any).__pathfinderExperiment;
        expect(debugger_.flags).toContain('pathfinder.auto-open-sidebar');
        expect(debugger_.flags).toContain('pathfinder.highlighted-guide-experiment');
      });

      it('setOverride should store an override', () => {
        createExperimentDebugger(mockConfig);

        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

        (window as any).__pathfinderExperiment.setOverride('pathfinder.highlighted-guide-experiment', {
          variant: 'control',
          pages: [],
        });

        expect(mockOverrides['pathfinder.highlighted-guide-experiment']).toEqual({ variant: 'control', pages: [] });
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining("Override set for 'pathfinder.highlighted-guide-experiment'"),
          expect.anything()
        );
        consoleSpy.mockRestore();
      });

      it('setOverride should warn for unknown flags', () => {
        createExperimentDebugger(mockConfig);

        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

        (window as any).__pathfinderExperiment.setOverride('pathfinder.unknown-flag', true);

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining("Unknown flag 'pathfinder.unknown-flag'"),
          expect.anything()
        );
        consoleSpy.mockRestore();
      });

      it('removeOverride should remove an override', () => {
        createExperimentDebugger(mockConfig);

        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

        mockOverrides['pathfinder.highlighted-guide-experiment'] = { variant: 'control', pages: [] };
        (window as any).__pathfinderExperiment.removeOverride('pathfinder.highlighted-guide-experiment');

        expect(mockOverrides).not.toHaveProperty('pathfinder.highlighted-guide-experiment');
        consoleSpy.mockRestore();
      });

      it('clearOverrides should remove all overrides', () => {
        createExperimentDebugger(mockConfig);

        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

        mockOverrides['pathfinder.auto-open-sidebar'] = true;
        mockOverrides['pathfinder.highlighted-guide-experiment'] = { variant: 'control', pages: [] };
        (window as any).__pathfinderExperiment.clearOverrides();

        expect(Object.keys(mockOverrides)).toHaveLength(0);
        consoleSpy.mockRestore();
      });

      it('showOverrides should display active overrides', () => {
        createExperimentDebugger(mockConfig);

        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

        mockOverrides['pathfinder.highlighted-guide-experiment'] = { variant: 'control', pages: [] };
        const result = (window as any).__pathfinderExperiment.showOverrides();

        expect(result).toEqual({ 'pathfinder.highlighted-guide-experiment': { variant: 'control', pages: [] } });
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Active flag overrides'));
        consoleSpy.mockRestore();
      });

      it('showOverrides should indicate when no overrides set', () => {
        createExperimentDebugger(mockConfig);

        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

        const result = (window as any).__pathfinderExperiment.showOverrides();

        expect(result).toEqual({});
        expect(consoleSpy).toHaveBeenCalledWith('[Pathfinder] No flag overrides set.');
        consoleSpy.mockRestore();
      });
    });

    describe('analytics exposure helpers', () => {
      const hostname = window.location.hostname;
      const prefix = 'grafana-pathfinder-experiment-exposure-reported-';

      it('showExposures lists markers for the current hostname, parsing flag + variant', () => {
        localStorage.setItem(`${prefix}${hostname}:pathfinder.highlighted-guide-experiment:control`, 'true');
        localStorage.setItem(`${prefix}${hostname}:pathfinder.highlighted-guide-experiment:treatment`, 'true');
        // Marker for a different hostname should NOT appear
        localStorage.setItem(`${prefix}other.host.net:pathfinder.highlighted-guide-experiment:control`, 'true');

        createExperimentDebugger(mockConfig);
        const result = (window as any).__pathfinderExperiment.showExposures();

        expect(result).toHaveLength(2);
        expect(result).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ flag: 'pathfinder.highlighted-guide-experiment', variant: 'control' }),
            expect.objectContaining({ flag: 'pathfinder.highlighted-guide-experiment', variant: 'treatment' }),
          ])
        );
      });

      it('showExposures returns empty list and explains no exposures deduped', () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        createExperimentDebugger(mockConfig);

        const result = (window as any).__pathfinderExperiment.showExposures();

        expect(result).toEqual([]);
        expect(consoleSpy).toHaveBeenCalledWith(
          '[Pathfinder] No analytics exposures deduped for this hostname. The next non-excluded experiment evaluation will fire pathfinder_feature_flag_evaluated.'
        );
        consoleSpy.mockRestore();
      });

      it('clearExposures removes markers for the current hostname only', () => {
        const myKey1 = `${prefix}${hostname}:pathfinder.highlighted-guide-experiment:control`;
        const myKey2 = `${prefix}${hostname}:pathfinder.highlighted-guide-experiment:treatment`;
        const otherKey = `${prefix}other.host.net:pathfinder.highlighted-guide-experiment:control`;
        const unrelatedKey = 'some-other-pathfinder-key';

        localStorage.setItem(myKey1, 'true');
        localStorage.setItem(myKey2, 'true');
        localStorage.setItem(otherKey, 'true');
        localStorage.setItem(unrelatedKey, 'keep-me');

        createExperimentDebugger(mockConfig);
        const result = (window as any).__pathfinderExperiment.clearExposures();

        expect(result).toEqual({ cleared: 2 });
        expect(localStorage.getItem(myKey1)).toBeNull();
        expect(localStorage.getItem(myKey2)).toBeNull();
        expect(localStorage.getItem(otherKey)).toBe('true');
        expect(localStorage.getItem(unrelatedKey)).toBe('keep-me');
      });

      it('clearExposures is a no-op when there are no markers', () => {
        createExperimentDebugger(mockConfig);
        const result = (window as any).__pathfinderExperiment.clearExposures();
        expect(result).toEqual({ cleared: 0 });
      });
    });
  });
});
