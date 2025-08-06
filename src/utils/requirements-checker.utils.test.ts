import { checkRequirements, RequirementsCheckOptions } from './requirements-checker.utils';
import { locationService, config, hasPermission, getDataSourceSrv } from '@grafana/runtime';
import { ContextService } from './context';

// Mock dom-utils functions
jest.mock('./dom-utils', () => ({
  reftargetExistsCHECK: jest.fn(),
  navmenuOpenCHECK: jest.fn(),
}));

// Mock Grafana runtime dependencies
jest.mock('@grafana/runtime', () => ({
  locationService: {
    getLocation: jest.fn(),
  },
  config: {
    bootData: {
      user: null,
    },
    buildInfo: {
      version: '10.0.0',
      env: 'production',
    },
    featureToggles: {},
  },
  hasPermission: jest.fn(),
  getDataSourceSrv: jest.fn(),
}));

// Mock ContextService
jest.mock('./context', () => ({
  ContextService: {
    fetchPlugins: jest.fn(),
    fetchDashboardsByName: jest.fn(),
    fetchDataSources: jest.fn(),
  },
}));

describe('requirements-checker.utils', () => {
  let mockReftargetExistsCHECK: jest.MockedFunction<any>;
  let mockNavmenuOpenCHECK: jest.MockedFunction<any>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Get the mocked functions
    const domUtils = require('./dom-utils');
    mockReftargetExistsCHECK = domUtils.reftargetExistsCHECK;
    mockNavmenuOpenCHECK = domUtils.navmenuOpenCHECK;

    // Setup default mock DOM check functions
    mockReftargetExistsCHECK.mockResolvedValue({ requirement: 'exists-reftarget', pass: true });
    mockNavmenuOpenCHECK.mockResolvedValue({ requirement: 'navmenu-open', pass: true });

    // Reset Grafana config mock
    (config as any).bootData = { user: null };
    (config as any).featureToggles = {};
  });

  describe('checkRequirements', () => {
    it('should pass when no requirements are specified', async () => {
      const options: RequirementsCheckOptions = {
        requirements: '',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(true);
      expect(result.error).toEqual([]);
    });

    it('should handle multiple requirements', async () => {
      const options: RequirementsCheckOptions = {
        requirements: 'exists-reftarget,navmenu-open',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(true);
      expect(mockReftargetExistsCHECK).toHaveBeenCalled();
      expect(mockNavmenuOpenCHECK).toHaveBeenCalled();
    });

    it('should handle DOM-dependent requirements', async () => {
      const options: RequirementsCheckOptions = {
        requirements: 'exists-reftarget',
        refTarget: 'button[data-testid="test-button"]',
        targetAction: 'button',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(true);
      expect(mockReftargetExistsCHECK).toHaveBeenCalledWith('button[data-testid="test-button"]', 'button');
    });
  });

  describe('hasPermissionCHECK', () => {
    it('should check for specific permissions', async () => {
      (hasPermission as jest.Mock).mockReturnValue(true);
      const options: RequirementsCheckOptions = {
        requirements: 'has-permission:datasources.read',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(true);
      expect(hasPermission).toHaveBeenCalledWith('datasources.read');
    });

    it('should fail when permission is missing', async () => {
      (hasPermission as jest.Mock).mockReturnValue(false);
      const options: RequirementsCheckOptions = {
        requirements: 'has-permission:datasources.write',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(false);
      expect(result.error[0].error).toContain('Missing permission');
    });
  });

  describe('hasRoleCHECK', () => {
    it('should check admin role', async () => {
      (config as any).bootData = {
        user: { isGrafanaAdmin: true, orgRole: 'Admin' },
      };

      const options: RequirementsCheckOptions = {
        requirements: 'has-role:admin',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(true);
    });

    it('should check editor role with inheritance', async () => {
      (config as any).bootData = {
        user: { isGrafanaAdmin: false, orgRole: 'Editor' },
      };

      const options: RequirementsCheckOptions = {
        requirements: 'has-role:editor',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(true);
    });
  });

  describe('hasDataSourceCHECK', () => {
    it('should check for specific data source', async () => {
      const mockDataSources = [{ name: 'Prometheus', uid: 'prom1', type: 'prometheus' }];
      (getDataSourceSrv as jest.Mock).mockReturnValue({
        getList: () => mockDataSources,
      });

      const options: RequirementsCheckOptions = {
        requirements: 'has-datasource:prometheus',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(true);
    });
  });

  describe('hasPluginCHECK', () => {
    it('should check for installed plugins', async () => {
      (ContextService.fetchPlugins as jest.Mock).mockResolvedValue([{ id: 'grafana-plugin' }]);

      const options: RequirementsCheckOptions = {
        requirements: 'has-plugin:grafana-plugin',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(true);
    });
  });

  describe('hasDashboardNamedCHECK', () => {
    it('should check for dashboard by name', async () => {
      (ContextService.fetchDashboardsByName as jest.Mock).mockResolvedValue([{ title: 'Test Dashboard' }]);

      const options: RequirementsCheckOptions = {
        requirements: 'has-dashboard-named:Test Dashboard',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(true);
    });
  });

  describe('onPageCHECK', () => {
    it('should check current page path', async () => {
      (locationService.getLocation as jest.Mock).mockReturnValue({
        pathname: '/dashboards',
      });

      const options: RequirementsCheckOptions = {
        requirements: 'on-page:/dashboards',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(true);
    });
  });

  describe('hasFeatureCHECK', () => {
    it('should check feature toggles', async () => {
      (config as any).featureToggles = {
        newFeature: true,
      };

      const options: RequirementsCheckOptions = {
        requirements: 'has-feature:newFeature',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(true);
    });
  });

  describe('inEnvironmentCHECK', () => {
    it('should check environment', async () => {
      const options: RequirementsCheckOptions = {
        requirements: 'in-environment:production',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(true);
    });
  });

  describe('minVersionCHECK', () => {
    it('should check version requirements', async () => {
      const options: RequirementsCheckOptions = {
        requirements: 'min-version:9.0.0',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(true);
    });

    it('should fail for higher version requirements', async () => {
      const options: RequirementsCheckOptions = {
        requirements: 'min-version:11.0.0',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(false);
      expect(result.error[0].error).toContain('does not meet minimum requirement');
    });
  });

  describe('isAdminCHECK', () => {
    it('should check admin status', async () => {
      (config as any).bootData = {
        user: { isGrafanaAdmin: true },
      };

      const options: RequirementsCheckOptions = {
        requirements: 'is-admin',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(true);
    });
  });

  describe('hasDatasourcesCHECK', () => {
    it('should check for any data sources', async () => {
      (ContextService.fetchDataSources as jest.Mock).mockResolvedValue([{ name: 'Test DS' }]);

      const options: RequirementsCheckOptions = {
        requirements: 'has-datasources',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(true);
    });

    it('should fail when no data sources exist', async () => {
      (ContextService.fetchDataSources as jest.Mock).mockResolvedValue([]);

      const options: RequirementsCheckOptions = {
        requirements: 'has-datasources',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(false);
      expect(result.error[0].error).toBe('No data sources found');
    });
  });

  describe('section-completed requirement', () => {
    it('should recognize section-completed requirement format', async () => {
      // Test that the requirement is recognized and processed
      // The actual implementation will be tested in integration tests
      const options: RequirementsCheckOptions = {
        requirements: 'section-completed:setup-datasource',
      };

      const result = await checkRequirements(options);
      // Should not throw an error and should have processed the requirement
      expect(result.requirements).toBe('section-completed:setup-datasource');
      expect(result.error).toHaveLength(1);
      expect(result.error[0].requirement).toBe('section-completed:setup-datasource');
    });
  });
});
