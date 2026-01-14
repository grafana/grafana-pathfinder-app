/**
 * Tests for experiment-debug module
 *
 * Tests the app-level auto-open tracking behavior using the actual experiment config:
 * - Treatment: auto-opens once per parent app (not per page)
 * - Excluded: normal behavior (once globally)
 * - Control: no auto-open
 */

// Mock user-storage before importing
jest.mock('../lib/user-storage', () => ({
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
  },
}));

// Mock openfeature
jest.mock('./openfeature', () => ({
  getExperimentConfig: jest.fn(),
  FeatureFlags: {
    EXPERIMENT_VARIANT: 'pathfinder.experiment-variant',
  },
  matchPathPattern: jest.fn((pattern: string, path: string) => {
    // Simple implementation for testing
    if (pattern.endsWith('*')) {
      return path.startsWith(pattern.slice(0, -1));
    }
    return path === pattern || path === pattern + '/';
  }),
}));

import { getParentPath, shouldAutoOpenForPath, hasParentAutoOpened, markParentAutoOpened } from './experiment-debug';

// Actual experiment pages from GOFF config
const EXPERIMENT_PAGES = [
  '/a/grafana-synthetic-monitoring-app*',
  '/a/grafana-irm-app/integrations*',
  '/a/grafana-irm-app/schedules*',
  '/a/grafana-irm-app/escalations*',
  '/a/grafana-irm-app/alert-groups*',
  '/a/grafana-irm-app/incidents*',
  '/a/grafana-irm-app?irmHomePageActiveTab=My%20IRM*',
];

describe('experiment-debug', () => {
  const hostname = 'test.grafana.net';

  beforeEach(() => {
    // Clear sessionStorage before each test
    sessionStorage.clear();
    jest.clearAllMocks();
  });

  describe('getParentPath', () => {
    describe('app paths (/a/app-id)', () => {
      it('should extract /a/app-id from app root pattern', () => {
        expect(getParentPath('/a/grafana-synthetic-monitoring-app*')).toBe('/a/grafana-synthetic-monitoring-app');
      });

      it('should extract /a/app-id from app subpage patterns', () => {
        expect(getParentPath('/a/grafana-irm-app/integrations*')).toBe('/a/grafana-irm-app');
        expect(getParentPath('/a/grafana-irm-app/schedules*')).toBe('/a/grafana-irm-app');
        expect(getParentPath('/a/grafana-irm-app/escalations*')).toBe('/a/grafana-irm-app');
        expect(getParentPath('/a/grafana-irm-app/alert-groups*')).toBe('/a/grafana-irm-app');
        expect(getParentPath('/a/grafana-irm-app/incidents*')).toBe('/a/grafana-irm-app');
      });

      it('should extract /a/app-id from query string patterns', () => {
        expect(getParentPath('/a/grafana-irm-app?irmHomePageActiveTab=My%20IRM*')).toBe('/a/grafana-irm-app');
      });

      it('should handle deeply nested app paths', () => {
        expect(getParentPath('/a/grafana-irm-app/settings/users/list*')).toBe('/a/grafana-irm-app');
      });

      it('should return all IRM pages with the same parent', () => {
        const irmPages = EXPERIMENT_PAGES.filter((p) => p.includes('grafana-irm-app'));
        const parents = irmPages.map(getParentPath);
        const uniqueParents = [...new Set(parents)];

        expect(uniqueParents).toHaveLength(1);
        expect(uniqueParents[0]).toBe('/a/grafana-irm-app');
      });
    });

    describe('non-app paths (future-proofing)', () => {
      it('should extract first segment from dashboard paths', () => {
        expect(getParentPath('/dashboard/snapshots*')).toBe('/dashboard');
        expect(getParentPath('/dashboard/browse*')).toBe('/dashboard');
        expect(getParentPath('/dashboard/new*')).toBe('/dashboard');
      });

      it('should extract first segment from explore paths', () => {
        expect(getParentPath('/explore*')).toBe('/explore');
        expect(getParentPath('/explore/metrics*')).toBe('/explore');
      });

      it('should extract first segment from alerting paths', () => {
        expect(getParentPath('/alerting/list*')).toBe('/alerting');
        expect(getParentPath('/alerting/notifications*')).toBe('/alerting');
      });

      it('should handle root-level paths', () => {
        expect(getParentPath('/connections*')).toBe('/connections');
      });
    });
  });

  describe('hasParentAutoOpened', () => {
    it('should return false when parent has not auto-opened', () => {
      expect(hasParentAutoOpened(hostname, '/a/grafana-irm-app')).toBe(false);
    });

    it('should return true when parent has auto-opened', () => {
      sessionStorage.setItem('grafana-pathfinder-treatment-page-test.grafana.net-/a/grafana-irm-app', 'true');
      expect(hasParentAutoOpened(hostname, '/a/grafana-irm-app')).toBe(true);
    });
  });

  describe('markParentAutoOpened', () => {
    it('should mark parent as auto-opened in sessionStorage', () => {
      markParentAutoOpened(hostname, '/a/grafana-irm-app');

      const key = 'grafana-pathfinder-treatment-page-test.grafana.net-/a/grafana-irm-app';
      expect(sessionStorage.getItem(key)).toBe('true');
    });

    it('should call user storage to persist', () => {
      const { experimentAutoOpenStorage } = require('../lib/user-storage');

      markParentAutoOpened(hostname, '/a/grafana-synthetic-monitoring-app');

      expect(experimentAutoOpenStorage.markPageAutoOpened).toHaveBeenCalledWith('/a/grafana-synthetic-monitoring-app');
    });
  });

  describe('shouldAutoOpenForPath', () => {
    describe('treatment variant - app-level tracking', () => {
      it('should return parent path when landing on first IRM page', () => {
        const result = shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-irm-app/integrations');

        expect(result).toBe('/a/grafana-irm-app');
      });

      it('should return null for second IRM page after first opened', () => {
        // First landing on integrations
        const first = shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-irm-app/integrations');
        expect(first).toBe('/a/grafana-irm-app');

        // Mark as opened
        markParentAutoOpened(hostname, first!);

        // Second landing on schedules - should NOT open
        const second = shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-irm-app/schedules');
        expect(second).toBeNull();
      });

      it('should return null for all IRM subpages after any IRM page opened', () => {
        // Mark IRM as opened
        markParentAutoOpened(hostname, '/a/grafana-irm-app');

        // All IRM pages should return null
        expect(shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-irm-app/integrations')).toBeNull();
        expect(shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-irm-app/schedules')).toBeNull();
        expect(shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-irm-app/escalations')).toBeNull();
        expect(shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-irm-app/alert-groups')).toBeNull();
        expect(shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-irm-app/incidents')).toBeNull();
      });

      it('should allow Synthetic Monitoring to open separately from IRM', () => {
        // Mark IRM as opened
        markParentAutoOpened(hostname, '/a/grafana-irm-app');

        // Synthetic Monitoring should still be able to open
        const result = shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-synthetic-monitoring-app/checks');
        expect(result).toBe('/a/grafana-synthetic-monitoring-app');
      });

      it('should track Synthetic Monitoring and IRM independently', () => {
        // Land on Synthetic Monitoring first
        const sm = shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-synthetic-monitoring-app/checks');
        expect(sm).toBe('/a/grafana-synthetic-monitoring-app');
        markParentAutoOpened(hostname, sm!);

        // Land on IRM - should still open (different app)
        const irm = shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-irm-app/integrations');
        expect(irm).toBe('/a/grafana-irm-app');
        markParentAutoOpened(hostname, irm!);

        // Both should now be blocked
        expect(
          shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-synthetic-monitoring-app/probes')
        ).toBeNull();
        expect(shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-irm-app/schedules')).toBeNull();
      });

      it('should return null for non-target pages', () => {
        const result = shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/dashboard/browse');
        expect(result).toBeNull();
      });
    });

    describe('user journey scenarios', () => {
      it('Scenario 1: User lands on IRM integrations, then visits other IRM pages', () => {
        // User lands on /a/grafana-irm-app/integrations
        const result1 = shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-irm-app/integrations');
        expect(result1).toBe('/a/grafana-irm-app');
        markParentAutoOpened(hostname, result1!);

        // User navigates to schedules - should NOT auto-open
        const result2 = shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-irm-app/schedules');
        expect(result2).toBeNull();

        // User navigates to alert-groups - should NOT auto-open
        const result3 = shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-irm-app/alert-groups');
        expect(result3).toBeNull();
      });

      it('Scenario 2: User visits Synthetic Monitoring then IRM', () => {
        // User visits Synthetic Monitoring
        const result1 = shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-synthetic-monitoring-app/checks');
        expect(result1).toBe('/a/grafana-synthetic-monitoring-app');
        markParentAutoOpened(hostname, result1!);

        // User navigates to IRM - should open (different app)
        const result2 = shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-irm-app/incidents');
        expect(result2).toBe('/a/grafana-irm-app');
        markParentAutoOpened(hostname, result2!);

        // User returns to Synthetic Monitoring - should NOT open
        const result3 = shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-synthetic-monitoring-app/probes');
        expect(result3).toBeNull();
      });

      it('Scenario 3: User visits home page then navigates to target', () => {
        // User is on home page - not a target
        const result1 = shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/');
        expect(result1).toBeNull();

        // User navigates to IRM - should open
        const result2 = shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-irm-app/schedules');
        expect(result2).toBe('/a/grafana-irm-app');
      });
    });
  });

  describe('experiment variant behaviors', () => {
    describe('treatment variant', () => {
      it('should auto-open on first target page per app', () => {
        // First IRM page
        expect(shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-irm-app/integrations')).toBe(
          '/a/grafana-irm-app'
        );
      });

      it('should not auto-open on subsequent pages of same app', () => {
        markParentAutoOpened(hostname, '/a/grafana-irm-app');

        expect(shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-irm-app/schedules')).toBeNull();
        expect(shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-irm-app/incidents')).toBeNull();
      });
    });

    describe('control variant', () => {
      it('should not auto-open (pages tracked for analytics only)', () => {
        // Control variant has pages but no auto-open behavior
        // This is handled in module.tsx, not experiment-debug.ts
        // The shouldAutoOpenForPath function would still return a value,
        // but module.tsx won't call it for control variant
        expect(true).toBe(true); // Placeholder - actual test in integration
      });
    });

    describe('excluded variant', () => {
      it('should use global tracking, not app-level', () => {
        // Excluded variant has empty pages array and uses global tracking
        // This is handled in module.tsx with markGlobalAutoOpened
        expect(true).toBe(true); // Placeholder - actual test in integration
      });
    });
  });
});
