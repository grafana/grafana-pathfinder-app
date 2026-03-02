/**
 * Tests for experiment-utils module
 *
 * Tests storage helpers, path utilities, and user-related checks for experiments.
 */

// Mock @grafana/runtime
jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
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

// Mock openfeature
jest.mock('../openfeature', () => ({
  matchPathPattern: jest.fn((pattern: string, path: string) => {
    if (pattern.endsWith('*')) {
      return path.startsWith(pattern.slice(0, -1));
    }
    return path === pattern || path === pattern + '/';
  }),
}));

import { getBackendSrv } from '@grafana/runtime';

import {
  getParentPath,
  getTreatmentPageKey,
  findMatchingTargetPage,
  hasParentAutoOpened,
  markParentAutoOpened,
  markGlobalAutoOpened,
  shouldAutoOpenForPath,
  hasAfter24hAutoOpened,
  markAfter24hAutoOpened,
  resetAfter24hExperimentState,
  isUserAccountOlderThan24Hours,
  isSidebarAlreadyInUse,
  isOnboardingFlowPath,
  getStorageKeys,
  getAfter24hStorageKeys,
  syncExperimentStateFromUserStorage,
  resetExperimentState,
} from './experiment-utils';

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

describe('experiment-utils', () => {
  const hostname = 'test.grafana.net';

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    jest.clearAllMocks();
  });

  describe('getStorageKeys', () => {
    it('should return storage keys with hostname', () => {
      const keys = getStorageKeys(hostname);

      expect(keys.resetProcessed).toBe(`grafana-pathfinder-pop-open-reset-processed-${hostname}`);
      expect(keys.autoOpened).toBe(`grafana-interactive-learning-panel-auto-opened-${hostname}`);
      expect(keys.treatmentPagePrefix).toBe(`grafana-pathfinder-treatment-page-${hostname}-`);
    });
  });

  describe('getAfter24hStorageKeys', () => {
    it('should return after-24h storage keys with hostname', () => {
      const keys = getAfter24hStorageKeys(hostname);

      expect(keys.resetProcessed).toBe(`grafana-pathfinder-after-24h-reset-processed-${hostname}`);
      expect(keys.autoOpened).toBe(`grafana-pathfinder-after-24h-auto-opened-${hostname}`);
    });
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

  describe('getTreatmentPageKey', () => {
    it('should return correct key for parent path', () => {
      const key = getTreatmentPageKey(hostname, '/a/grafana-irm-app');
      expect(key).toBe(`grafana-pathfinder-treatment-page-${hostname}-/a/grafana-irm-app`);
    });
  });

  describe('findMatchingTargetPage', () => {
    it('should return matching pattern', () => {
      const result = findMatchingTargetPage(EXPERIMENT_PAGES, '/a/grafana-irm-app/integrations');
      expect(result).toBe('/a/grafana-irm-app/integrations*');
    });

    it('should return null for non-matching path', () => {
      const result = findMatchingTargetPage(EXPERIMENT_PAGES, '/dashboard/browse');
      expect(result).toBeNull();
    });
  });

  describe('hasParentAutoOpened', () => {
    it('should return false when parent has not auto-opened', () => {
      expect(hasParentAutoOpened(hostname, '/a/grafana-irm-app')).toBe(false);
    });

    it('should return true when parent has auto-opened', () => {
      sessionStorage.setItem(`grafana-pathfinder-treatment-page-${hostname}-/a/grafana-irm-app`, 'true');
      expect(hasParentAutoOpened(hostname, '/a/grafana-irm-app')).toBe(true);
    });
  });

  describe('markParentAutoOpened', () => {
    it('should mark parent as auto-opened in sessionStorage', () => {
      markParentAutoOpened(hostname, '/a/grafana-irm-app');

      const key = `grafana-pathfinder-treatment-page-${hostname}-/a/grafana-irm-app`;
      expect(sessionStorage.getItem(key)).toBe('true');
    });

    it('should call user storage to persist', () => {
      const { experimentAutoOpenStorage } = require('../../lib/user-storage');

      markParentAutoOpened(hostname, '/a/grafana-synthetic-monitoring-app');

      expect(experimentAutoOpenStorage.markPageAutoOpened).toHaveBeenCalledWith('/a/grafana-synthetic-monitoring-app');
    });
  });

  describe('markGlobalAutoOpened', () => {
    it('should mark global auto-open in sessionStorage', () => {
      markGlobalAutoOpened(hostname);

      const keys = getStorageKeys(hostname);
      expect(sessionStorage.getItem(keys.autoOpened)).toBe('true');
    });

    it('should call user storage to persist', () => {
      const { experimentAutoOpenStorage } = require('../../lib/user-storage');

      markGlobalAutoOpened(hostname);

      expect(experimentAutoOpenStorage.markGlobalAutoOpened).toHaveBeenCalled();
    });
  });

  describe('shouldAutoOpenForPath', () => {
    describe('treatment variant - app-level tracking', () => {
      it('should return parent path when landing on first IRM page', () => {
        const result = shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-irm-app/integrations');

        expect(result).toBe('/a/grafana-irm-app');
      });

      it('should return null for second IRM page after first opened', () => {
        const first = shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-irm-app/integrations');
        expect(first).toBe('/a/grafana-irm-app');

        markParentAutoOpened(hostname, first!);

        const second = shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-irm-app/schedules');
        expect(second).toBeNull();
      });

      it('should return null for all IRM subpages after any IRM page opened', () => {
        markParentAutoOpened(hostname, '/a/grafana-irm-app');

        expect(shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-irm-app/integrations')).toBeNull();
        expect(shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-irm-app/schedules')).toBeNull();
        expect(shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-irm-app/escalations')).toBeNull();
        expect(shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-irm-app/alert-groups')).toBeNull();
        expect(shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-irm-app/incidents')).toBeNull();
      });

      it('should allow Synthetic Monitoring to open separately from IRM', () => {
        markParentAutoOpened(hostname, '/a/grafana-irm-app');

        const result = shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-synthetic-monitoring-app/checks');
        expect(result).toBe('/a/grafana-synthetic-monitoring-app');
      });

      it('should track Synthetic Monitoring and IRM independently', () => {
        const sm = shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-synthetic-monitoring-app/checks');
        expect(sm).toBe('/a/grafana-synthetic-monitoring-app');
        markParentAutoOpened(hostname, sm!);

        const irm = shouldAutoOpenForPath(hostname, EXPERIMENT_PAGES, '/a/grafana-irm-app/integrations');
        expect(irm).toBe('/a/grafana-irm-app');
        markParentAutoOpened(hostname, irm!);

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
  });

  describe('after-24h experiment storage', () => {
    describe('hasAfter24hAutoOpened', () => {
      it('should return false when not auto-opened', () => {
        expect(hasAfter24hAutoOpened(hostname)).toBe(false);
      });

      it('should return true when auto-opened', () => {
        const keys = getAfter24hStorageKeys(hostname);
        sessionStorage.setItem(keys.autoOpened, 'true');
        expect(hasAfter24hAutoOpened(hostname)).toBe(true);
      });
    });

    describe('markAfter24hAutoOpened', () => {
      it('should mark as auto-opened in sessionStorage', () => {
        markAfter24hAutoOpened(hostname);

        const keys = getAfter24hStorageKeys(hostname);
        expect(sessionStorage.getItem(keys.autoOpened)).toBe('true');
      });
    });

    describe('resetAfter24hExperimentState', () => {
      it('should clear session storage', () => {
        markAfter24hAutoOpened(hostname);
        expect(hasAfter24hAutoOpened(hostname)).toBe(true);

        resetAfter24hExperimentState(hostname);
        expect(hasAfter24hAutoOpened(hostname)).toBe(false);
      });
    });
  });

  describe('isUserAccountOlderThan24Hours', () => {
    it('should return true for account older than 24 hours', async () => {
      const mockGet = jest.fn().mockResolvedValue({
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      });
      (getBackendSrv as jest.Mock).mockReturnValue({ get: mockGet });

      const result = await isUserAccountOlderThan24Hours();

      expect(result).toBe(true);
      expect(mockGet).toHaveBeenCalledWith('/api/user');
    });

    it('should return false for account younger than 24 hours', async () => {
      const mockGet = jest.fn().mockResolvedValue({
        createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
      });
      (getBackendSrv as jest.Mock).mockReturnValue({ get: mockGet });

      const result = await isUserAccountOlderThan24Hours();

      expect(result).toBe(false);
    });

    it('should return false when createdAt is not available', async () => {
      const mockGet = jest.fn().mockResolvedValue({});
      (getBackendSrv as jest.Mock).mockReturnValue({ get: mockGet });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const result = await isUserAccountOlderThan24Hours();

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith('[Pathfinder] User createdAt not available');
      consoleSpy.mockRestore();
    });

    it('should return false on API error', async () => {
      const mockGet = jest.fn().mockRejectedValue(new Error('API error'));
      (getBackendSrv as jest.Mock).mockReturnValue({ get: mockGet });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const result = await isUserAccountOlderThan24Hours();

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith('[Pathfinder] Failed to fetch user creation time:', expect.any(Error));
      consoleSpy.mockRestore();
    });

    it('should return true for account exactly 24 hours old', async () => {
      const mockGet = jest.fn().mockResolvedValue({
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      });
      (getBackendSrv as jest.Mock).mockReturnValue({ get: mockGet });

      const result = await isUserAccountOlderThan24Hours();

      expect(result).toBe(true);
    });
  });

  describe('isSidebarAlreadyInUse', () => {
    it('should return false when no sidebar is docked', () => {
      expect(isSidebarAlreadyInUse()).toBe(false);
    });

    it('should return true when sidebar is docked', () => {
      localStorage.setItem('grafana.navigation.extensionSidebarDocked', JSON.stringify({ pluginId: 'some-plugin' }));
      expect(isSidebarAlreadyInUse()).toBe(true);
    });
  });

  describe('isOnboardingFlowPath', () => {
    it('should return true for onboarding flow path', () => {
      expect(isOnboardingFlowPath('/a/grafana-setupguide-app/onboarding-flow')).toBe(true);
      expect(isOnboardingFlowPath('/a/grafana-setupguide-app/onboarding-flow/step-1')).toBe(true);
    });

    it('should return false for non-onboarding paths', () => {
      expect(isOnboardingFlowPath('/dashboard/browse')).toBe(false);
      expect(isOnboardingFlowPath('/a/grafana-irm-app/integrations')).toBe(false);
    });
  });

  describe('syncExperimentStateFromUserStorage', () => {
    it('should sync global auto-open state', async () => {
      const { experimentAutoOpenStorage } = require('../../lib/user-storage');
      experimentAutoOpenStorage.get.mockResolvedValue({
        pagesAutoOpened: [],
        globalAutoOpened: true,
      });

      await syncExperimentStateFromUserStorage(hostname, []);

      const keys = getStorageKeys(hostname);
      expect(sessionStorage.getItem(keys.autoOpened)).toBe('true');
    });

    it('should sync per-page auto-open state', async () => {
      const { experimentAutoOpenStorage } = require('../../lib/user-storage');
      experimentAutoOpenStorage.get.mockResolvedValue({
        pagesAutoOpened: ['/a/grafana-irm-app'],
        globalAutoOpened: false,
      });

      await syncExperimentStateFromUserStorage(hostname, EXPERIMENT_PAGES);

      expect(hasParentAutoOpened(hostname, '/a/grafana-irm-app')).toBe(true);
    });
  });

  describe('resetExperimentState', () => {
    it('should clear sessionStorage and user storage', async () => {
      const { experimentAutoOpenStorage } = require('../../lib/user-storage');

      markGlobalAutoOpened(hostname);
      markParentAutoOpened(hostname, '/a/grafana-irm-app');

      const keys = getStorageKeys(hostname);
      expect(sessionStorage.getItem(keys.autoOpened)).toBe('true');

      await resetExperimentState(hostname);

      expect(sessionStorage.getItem(keys.autoOpened)).toBeNull();
      expect(experimentAutoOpenStorage.reset).toHaveBeenCalled();
    });
  });
});
