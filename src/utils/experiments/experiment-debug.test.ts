/**
 * Tests for experiment-debug module
 *
 * Tests the debug surface exposed on window.__pathfinderExperiment:
 * analytics exposure inspection and the auto-open guide experiment's markers.
 */

jest.mock('../../lib/storage-keys', () => ({
  StorageKeys: {
    EXPERIMENT_EXPOSURE_REPORTED_PREFIX: 'grafana-pathfinder-experiment-exposure-reported-',
    AUTO_OPEN_GUIDE_SHOWN_PREFIX: 'grafana-pathfinder-auto-open-guide-shown-',
    AUTO_OPEN_GUIDE_VISIT_PREFIX: 'grafana-pathfinder-auto-open-guide-visit-',
  },
}));

jest.mock('../openfeature', () => ({
  pathfinderFeatureFlags: {
    'pathfinder.enabled': { valueType: 'boolean', defaultValue: true },
    'pathfinder.auto-open-sidebar': { valueType: 'boolean', defaultValue: false },
    'pathfinder.interactive-learning-banner-experiment': { valueType: 'object', defaultValue: {} },
  },
}));

import { createExperimentDebugger } from './experiment-debug';
import { setAutoOpenGuideEnrollment } from './auto-open-guide/state';

describe('experiment-debug', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    jest.clearAllMocks();
    delete (window as any).__pathfinderExperiment;
    setAutoOpenGuideEnrollment(null);
  });

  describe('createExperimentDebugger', () => {
    it('should expose debug object on window', () => {
      createExperimentDebugger();

      expect((window as any).__pathfinderExperiment).toBeDefined();
    });

    it('reads the auto-open guide arm lazily, so a later activation shows up', () => {
      createExperimentDebugger();
      const debugger_ = (window as any).__pathfinderExperiment;

      expect(debugger_.autoOpenGuide()).toEqual({ variant: 'not-enrolled', shown: [] });

      setAutoOpenGuideEnrollment({ variant: 'control', experiences: [] });
      expect(debugger_.autoOpenGuide().variant).toBe('control');
    });

    it('lists and clears auto-open guide markers for the current hostname only', () => {
      const prefix = 'grafana-pathfinder-auto-open-guide-shown-';
      localStorage.setItem(`${prefix}${window.location.hostname}:bundled:first-dashboard`, 'true');
      localStorage.setItem(`${prefix}other.host.net:bundled:first-dashboard`, 'true');
      jest.spyOn(console, 'log').mockImplementation();
      createExperimentDebugger();
      const debugger_ = (window as any).__pathfinderExperiment;

      expect(debugger_.autoOpenGuide().shown).toEqual(['bundled:first-dashboard']);
      sessionStorage.setItem(
        `grafana-pathfinder-auto-open-guide-visit-${window.location.hostname}`,
        'bundled:first-dashboard'
      );
      expect(debugger_.clearAutoOpenGuideMarkers()).toEqual({ cleared: 1 });
      expect(sessionStorage.getItem(`grafana-pathfinder-auto-open-guide-visit-${window.location.hostname}`)).toBeNull();
      expect(debugger_.autoOpenGuide().shown).toEqual([]);
      expect(localStorage.getItem(`${prefix}other.host.net:bundled:first-dashboard`)).toBe('true');
    });

    it('should expose known flag names', () => {
      createExperimentDebugger();

      const debugger_ = (window as any).__pathfinderExperiment;
      expect(debugger_.flags).toContain('pathfinder.auto-open-sidebar');
      expect(debugger_.flags).toContain('pathfinder.interactive-learning-banner-experiment');
    });

    describe('analytics exposure helpers', () => {
      const hostname = window.location.hostname;
      const prefix = 'grafana-pathfinder-experiment-exposure-reported-';

      it('showExposures lists markers for the current hostname, parsing flag + variant', () => {
        localStorage.setItem(`${prefix}${hostname}:pathfinder.interactive-learning-banner-experiment:control`, 'true');
        localStorage.setItem(
          `${prefix}${hostname}:pathfinder.interactive-learning-banner-experiment:treatment`,
          'true'
        );
        // Marker for a different hostname should NOT appear
        localStorage.setItem(
          `${prefix}other.host.net:pathfinder.interactive-learning-banner-experiment:control`,
          'true'
        );

        createExperimentDebugger();
        const result = (window as any).__pathfinderExperiment.showExposures();

        expect(result).toHaveLength(2);
        expect(result).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ flag: 'pathfinder.interactive-learning-banner-experiment', variant: 'control' }),
            expect.objectContaining({
              flag: 'pathfinder.interactive-learning-banner-experiment',
              variant: 'treatment',
            }),
          ])
        );
      });

      it('showExposures returns empty list and explains no exposures deduped', () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        createExperimentDebugger();

        const result = (window as any).__pathfinderExperiment.showExposures();

        expect(result).toEqual([]);
        expect(consoleSpy).toHaveBeenCalledWith(
          '[Pathfinder] No analytics exposures deduped for this hostname. The next non-excluded experiment evaluation will fire pathfinder_feature_flag_evaluated.'
        );
        consoleSpy.mockRestore();
      });

      it('clearExposures removes markers for the current hostname only', () => {
        const myKey1 = `${prefix}${hostname}:pathfinder.interactive-learning-banner-experiment:control`;
        const myKey2 = `${prefix}${hostname}:pathfinder.interactive-learning-banner-experiment:treatment`;
        const otherKey = `${prefix}other.host.net:pathfinder.interactive-learning-banner-experiment:control`;
        const unrelatedKey = 'some-other-pathfinder-key';

        localStorage.setItem(myKey1, 'true');
        localStorage.setItem(myKey2, 'true');
        localStorage.setItem(otherKey, 'true');
        localStorage.setItem(unrelatedKey, 'keep-me');

        createExperimentDebugger();
        const result = (window as any).__pathfinderExperiment.clearExposures();

        expect(result).toEqual({ cleared: 2 });
        expect(localStorage.getItem(myKey1)).toBeNull();
        expect(localStorage.getItem(myKey2)).toBeNull();
        expect(localStorage.getItem(otherKey)).toBe('true');
        expect(localStorage.getItem(unrelatedKey)).toBe('keep-me');
      });

      it('clearExposures is a no-op when there are no markers', () => {
        createExperimentDebugger();
        const result = (window as any).__pathfinderExperiment.clearExposures();
        expect(result).toEqual({ cleared: 0 });
      });
    });
  });
});
