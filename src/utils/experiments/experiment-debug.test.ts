/**
 * Tests for experiment-debug module
 *
 * Tests the debug surface exposed on window.__pathfinderExperiment:
 * analytics exposure inspection for the highlighted-guide experiment.
 */

jest.mock('../../lib/storage-keys', () => ({
  StorageKeys: {
    EXPERIMENT_EXPOSURE_REPORTED_PREFIX: 'grafana-pathfinder-experiment-exposure-reported-',
  },
}));

jest.mock('../openfeature', () => ({
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

    it('should expose known flag names', () => {
      createExperimentDebugger(mockConfig);

      const debugger_ = (window as any).__pathfinderExperiment;
      expect(debugger_.flags).toContain('pathfinder.auto-open-sidebar');
      expect(debugger_.flags).toContain('pathfinder.highlighted-guide-experiment');
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
