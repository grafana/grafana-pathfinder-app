import {
  checkRequirements,
  checkPostconditions,
  RequirementsCheckOptions,
  validateInteractiveRequirements,
} from './requirements-checker.utils';
import { locationService, config, hasPermission, getDataSourceSrv, getBackendSrv } from '@grafana/runtime';
import { ContextService } from '../context-engine';

// Mock dom-utils functions with default return values
// Note: sectionCompletedCheck and formValidCheck are NOT mocked - they use actual DOM
jest.mock('../lib/dom', () => {
  const actual = jest.requireActual('../lib/dom');
  return {
    ...actual,
    // Only mock these two functions that don't work well in test environment without DOM setup
    reftargetExistsCheck: jest.fn().mockResolvedValue({ requirement: 'exists-reftarget', pass: true }),
    navmenuOpenCheck: jest.fn().mockResolvedValue({ requirement: 'navmenu-open', pass: true }),
    // sectionCompletedCheck and formValidCheck use actual implementation for DOM-based tests
  };
});

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
  getBackendSrv: jest.fn(),
}));

// Mock ContextService
jest.mock('../context-engine', () => ({
  ContextService: {
    fetchPlugins: jest.fn(),
    fetchDashboardsByName: jest.fn(),
    fetchDataSources: jest.fn(),
  },
}));

describe('requirements-checker.utils', () => {
  let mockReftargetExistsCheck: jest.MockedFunction<any>;
  let mockNavmenuOpenCheck: jest.MockedFunction<any>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Get the mocked functions
    const domUtils = require('../lib/dom');
    mockReftargetExistsCheck = domUtils.reftargetExistsCheck;
    mockNavmenuOpenCheck = domUtils.navmenuOpenCheck;

    // Setup default mock DOM check functions
    mockReftargetExistsCheck.mockResolvedValue({ requirement: 'exists-reftarget', pass: true });
    mockNavmenuOpenCheck.mockResolvedValue({ requirement: 'navmenu-open', pass: true });

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
      expect(mockReftargetExistsCheck).toHaveBeenCalled();
      expect(mockNavmenuOpenCheck).toHaveBeenCalled();
    });

    it('should handle DOM-dependent requirements', async () => {
      const options: RequirementsCheckOptions = {
        requirements: 'exists-reftarget',
        refTarget: 'button[data-testid="test-button"]',
        targetAction: 'button',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(true);
      expect(mockReftargetExistsCheck).toHaveBeenCalledWith('button[data-testid="test-button"]', 'button', {
        lazyRender: undefined,
        scrollContainer: undefined,
      });
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

  describe('datasourceConfiguredCHECK', () => {
    beforeEach(() => {
      // Mock getBackendSrv
      (getBackendSrv as jest.Mock).mockReturnValue({
        post: jest.fn(),
      });
    });

    it('should test specific data source configuration', async () => {
      (ContextService.fetchDataSources as jest.Mock).mockResolvedValue([
        { id: 1, name: 'Prometheus', type: 'prometheus', uid: 'prom-uid' },
        { id: 2, name: 'Loki', type: 'loki', uid: 'loki-uid' },
      ]);

      const mockBackend = getBackendSrv();
      (mockBackend.post as jest.Mock).mockResolvedValue({ status: 'success' });

      const options: RequirementsCheckOptions = {
        requirements: 'datasource-configured:prometheus',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(true);
      expect(result.error[0].pass).toBe(true);
      expect(mockBackend.post).toHaveBeenCalledWith('/api/datasources/uid/prom-uid/test');
    });

    it('should fail when data source test fails', async () => {
      (ContextService.fetchDataSources as jest.Mock).mockResolvedValue([
        { id: 1, name: 'Prometheus', type: 'prometheus', uid: 'prom-uid' },
      ]);

      const mockBackend = getBackendSrv();
      (mockBackend.post as jest.Mock).mockResolvedValue({ status: 'error', message: 'Connection failed' });

      const options: RequirementsCheckOptions = {
        requirements: 'datasource-configured:prometheus',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(false);
      expect(result.error[0].pass).toBe(false);
      expect(result.error[0].error).toContain('test failed');
    });

    it('should fail when data source not found', async () => {
      (ContextService.fetchDataSources as jest.Mock).mockResolvedValue([
        { id: 1, name: 'Prometheus', type: 'prometheus', uid: 'prom-uid' },
      ]);

      const options: RequirementsCheckOptions = {
        requirements: 'datasource-configured:non-existent-ds',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(false);
      expect(result.error[0].pass).toBe(false);
      expect(result.error[0].error).toContain('not found');
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

  describe('pluginEnabledCHECK', () => {
    it('should check if specific plugin is enabled', async () => {
      (ContextService.fetchPlugins as jest.Mock).mockResolvedValue([
        { id: 'grafana-clock-panel', name: 'Clock Panel', enabled: true },
        { id: 'grafana-piechart-panel', name: 'Pie Chart Panel', enabled: false },
      ]);

      const options: RequirementsCheckOptions = {
        requirements: 'plugin-enabled:grafana-clock-panel',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(true);
      expect(result.error[0].pass).toBe(true);
    });

    it('should fail when plugin exists but is not enabled', async () => {
      (ContextService.fetchPlugins as jest.Mock).mockResolvedValue([
        { id: 'grafana-clock-panel', name: 'Clock Panel', enabled: true },
        { id: 'grafana-piechart-panel', name: 'Pie Chart Panel', enabled: false },
      ]);

      const options: RequirementsCheckOptions = {
        requirements: 'plugin-enabled:grafana-piechart-panel',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(false);
      expect(result.error[0].pass).toBe(false);
      expect(result.error[0].error).toContain('is installed but not enabled');
    });

    it('should fail when plugin does not exist', async () => {
      (ContextService.fetchPlugins as jest.Mock).mockResolvedValue([
        { id: 'grafana-clock-panel', name: 'Clock Panel', enabled: true },
      ]);

      const options: RequirementsCheckOptions = {
        requirements: 'plugin-enabled:non-existent-plugin',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(false);
      expect(result.error[0].pass).toBe(false);
      expect(result.error[0].error).toContain('not found');
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

  describe('isLoggedInCHECK', () => {
    it('should pass when user is logged in', async () => {
      (config as any).bootData = {
        user: { isSignedIn: true, id: 1 },
      };

      const options: RequirementsCheckOptions = {
        requirements: 'is-logged-in',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(true);
    });

    it('should fail when user is not logged in', async () => {
      (config as any).bootData = {
        user: { isSignedIn: false },
      };

      const options: RequirementsCheckOptions = {
        requirements: 'is-logged-in',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(false);
      expect(result.error[0].error).toContain('not logged in');
    });

    it('should fail when no user data available', async () => {
      (config as any).bootData = { user: null };

      const options: RequirementsCheckOptions = {
        requirements: 'is-logged-in',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(false);
    });
  });

  describe('isEditorCHECK', () => {
    it('should pass for editor role', async () => {
      (config as any).bootData = {
        user: { orgRole: 'Editor', id: 1 },
      };

      const options: RequirementsCheckOptions = {
        requirements: 'is-editor',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(true);
    });

    it('should pass for admin role (higher than editor)', async () => {
      (config as any).bootData = {
        user: { orgRole: 'Admin', id: 1 },
      };

      const options: RequirementsCheckOptions = {
        requirements: 'is-editor',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(true);
    });

    it('should pass for grafana admin', async () => {
      (config as any).bootData = {
        user: { isGrafanaAdmin: true, orgRole: 'Viewer', id: 1 },
      };

      const options: RequirementsCheckOptions = {
        requirements: 'is-editor',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(true);
    });

    it('should fail for viewer role', async () => {
      (config as any).bootData = {
        user: { orgRole: 'Viewer', id: 1 },
      };

      const options: RequirementsCheckOptions = {
        requirements: 'is-editor',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(false);
      expect(result.error[0].error).toContain('does not have editor permissions');
    });
  });

  describe('dashboardExistsCHECK', () => {
    beforeEach(() => {
      (getBackendSrv as jest.Mock).mockReturnValue({
        get: jest.fn(),
      });
    });

    it('should pass when dashboards exist', async () => {
      const mockBackend = getBackendSrv();
      (mockBackend.get as jest.Mock).mockResolvedValue([
        { id: 1, title: 'Dashboard 1' },
        { id: 2, title: 'Dashboard 2' },
      ]);

      const options: RequirementsCheckOptions = {
        requirements: 'dashboard-exists',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(true);
      expect(mockBackend.get).toHaveBeenCalledWith('/api/search', {
        type: 'dash-db',
        limit: 1,
        deleted: false,
      });
    });

    it('should fail when no dashboards exist', async () => {
      const mockBackend = getBackendSrv();
      (mockBackend.get as jest.Mock).mockResolvedValue([]);

      const options: RequirementsCheckOptions = {
        requirements: 'dashboard-exists',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(false);
      expect(result.error[0].error).toContain('No dashboards found');
    });
  });

  describe('formValidCHECK', () => {
    beforeEach(() => {
      // Clear DOM before each test
      document.body.innerHTML = '';
    });

    it('should pass when forms are valid', async () => {
      // Create a valid form
      document.body.innerHTML = `
        <form>
          <input type="text" required value="test" />
          <input type="email" required value="test@example.com" />
        </form>
      `;

      const options: RequirementsCheckOptions = {
        requirements: 'form-valid',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(true);
    });

    it('should fail when no forms exist', async () => {
      const options: RequirementsCheckOptions = {
        requirements: 'form-valid',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(false);
      expect(result.error[0].error).toContain('No forms found');
    });

    it('should fail when forms have validation errors', async () => {
      // Create a form with validation errors
      document.body.innerHTML = `
        <form>
          <input type="text" required class="error" />
          <div class="field-error">This field is required</div>
        </form>
      `;

      const options: RequirementsCheckOptions = {
        requirements: 'form-valid',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(false);
      expect(result.error[0].error).toContain('Form validation failed');
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

  describe('sectionCompletedCHECK', () => {
    beforeEach(() => {
      // Clear DOM before each test
      document.body.innerHTML = '';
    });

    it('should pass when section is completed', async () => {
      // Create a completed section
      document.body.innerHTML = `
        <div id="setup-datasource" class="completed">
          <h2>Setup Data Source</h2>
        </div>
      `;

      const options: RequirementsCheckOptions = {
        requirements: 'section-completed:setup-datasource',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(true);
    });

    it('should fail when section exists but is not completed', async () => {
      // Create a section without completed class
      document.body.innerHTML = `
        <div id="setup-datasource">
          <h2>Setup Data Source</h2>
        </div>
      `;

      const options: RequirementsCheckOptions = {
        requirements: 'section-completed:setup-datasource',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(false);
      expect(result.error[0].error).toContain('must be completed first');
    });

    it('should fail when section does not exist', async () => {
      const options: RequirementsCheckOptions = {
        requirements: 'section-completed:non-existent-section',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(false);
      expect(result.error[0].error).toContain('must be completed first');
    });
  });

  describe('renderer requirement', () => {
    it('should pass for renderer:pathfinder (always true in app)', async () => {
      const options: RequirementsCheckOptions = {
        requirements: 'renderer:pathfinder',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(true);
      expect(result.error[0].pass).toBe(true);
      expect(result.error[0].context?.renderer).toBe('pathfinder');
      expect(result.error[0].context?.context).toBe('app');
    });

    it('should fail for renderer:website (always false in app)', async () => {
      const options: RequirementsCheckOptions = {
        requirements: 'renderer:website',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(false);
      expect(result.error[0].pass).toBe(false);
      expect(result.error[0].error).toContain('website context is not available in app');
      expect(result.error[0].context?.renderer).toBe('website');
      expect(result.error[0].context?.context).toBe('app');
    });

    it('should fail for unknown renderer values', async () => {
      const options: RequirementsCheckOptions = {
        requirements: 'renderer:unknown',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(false);
      expect(result.error[0].pass).toBe(false);
      expect(result.error[0].error).toContain("Unknown renderer value: 'unknown'");
      expect(result.error[0].context?.renderer).toBe('unknown');
      expect(result.error[0].context?.supported).toEqual(['pathfinder', 'website']);
    });

    it('should handle case-insensitive renderer values', async () => {
      const options: RequirementsCheckOptions = {
        requirements: 'renderer:PATHFINDER',
      };

      const result = await checkRequirements(options);
      expect(result.pass).toBe(true);
      expect(result.error[0].pass).toBe(true);
    });
  });

  describe('unknown requirements', () => {
    it('should pass unknown requirements with warning (fail open approach)', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const options: RequirementsCheckOptions = {
        requirements: 'unknown-requirement-type',
      };

      const result = await checkRequirements(options);

      expect(result.pass).toBe(true);
      expect(result.error).toHaveLength(1);
      expect(result.error[0].requirement).toBe('unknown-requirement-type');
      expect(result.error[0].pass).toBe(true);
      expect(result.error[0].error).toContain('Warning: Unknown requirement type');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Unknown requirement type: 'unknown-requirement-type'")
      );

      consoleSpy.mockRestore();
    });

    it('should pass multiple requirements where some are unknown', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      // Set up user to pass other requirements
      (config as any).bootData = {
        user: {
          isSignedIn: true,
          isGrafanaAdmin: true,
          orgRole: 'Admin',
          id: 1,
        },
      };

      const options: RequirementsCheckOptions = {
        requirements: 'is-admin,unknown-requirement,is-logged-in',
      };

      const result = await checkRequirements(options);

      // Should pass overall because all requirements pass (including unknown with warning)
      expect(result.pass).toBe(true);
      expect(result.error).toHaveLength(3);

      // Check that the unknown requirement passed with warning
      const unknownResult = result.error.find((e) => e.requirement === 'unknown-requirement');
      expect(unknownResult?.pass).toBe(true);
      expect(unknownResult?.error).toContain('Warning: Unknown requirement type');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Unknown requirement type: 'unknown-requirement'")
      );

      consoleSpy.mockRestore();
    });
  });

  describe('checkPostconditions', () => {
    it('should pass when no postconditions are specified', async () => {
      const options: RequirementsCheckOptions = {
        requirements: '',
      };

      const result = await checkPostconditions(options);
      expect(result.pass).toBe(true);
      expect(result.error).toEqual([]);
    });

    it('should check postconditions using the same logic as requirements', async () => {
      // Configure mock for this test
      (config as any).bootData = {
        user: { isGrafanaAdmin: true, orgRole: 'Admin', isSignedIn: true, id: 1 },
      };

      const options: RequirementsCheckOptions = {
        requirements: 'is-admin,is-logged-in',
      };

      const result = await checkPostconditions(options);
      expect(result.pass).toBe(true);
      expect(result.error).toHaveLength(2);
    });

    it('should fail postconditions when requirements not met', async () => {
      (config as any).bootData = {
        user: { isGrafanaAdmin: false, orgRole: 'Viewer', isSignedIn: true, id: 1 },
      };

      const options: RequirementsCheckOptions = {
        requirements: 'is-admin',
      };

      const result = await checkPostconditions(options);
      expect(result.pass).toBe(false);
      expect(result.error[0].pass).toBe(false);
    });

    it('should handle multiple postconditions with one failing', async () => {
      (config as any).bootData = {
        user: { isGrafanaAdmin: false, orgRole: 'Editor', isSignedIn: true, id: 1 },
      };

      const options: RequirementsCheckOptions = {
        requirements: 'is-editor,is-admin', // is-editor passes, is-admin fails
      };

      const result = await checkPostconditions(options);
      expect(result.pass).toBe(false); // Overall should fail

      const editorCheck = result.error.find((e) => e.requirement === 'is-editor');
      const adminCheck = result.error.find((e) => e.requirement === 'is-admin');

      expect(editorCheck?.pass).toBe(true);
      expect(adminCheck?.pass).toBe(false);
    });

    it('should support plugin checks as postconditions', async () => {
      (ContextService.fetchPlugins as jest.Mock).mockResolvedValue([
        { id: 'grafana-clock-panel', name: 'Clock Panel', enabled: true },
      ]);

      const options: RequirementsCheckOptions = {
        requirements: 'has-plugin:grafana-clock-panel',
      };

      const result = await checkPostconditions(options);
      expect(result.pass).toBe(true);
    });

    it('should support dashboard checks as postconditions', async () => {
      (ContextService.fetchDashboardsByName as jest.Mock).mockResolvedValue([{ title: 'New Dashboard' }]);

      const options: RequirementsCheckOptions = {
        requirements: 'has-dashboard-named:New Dashboard',
      };

      const result = await checkPostconditions(options);
      expect(result.pass).toBe(true);
    });

    it('should support page location checks as postconditions', async () => {
      (locationService.getLocation as jest.Mock).mockReturnValue({
        pathname: '/d/abc123/my-dashboard',
      });

      const options: RequirementsCheckOptions = {
        requirements: 'on-page:/d/',
      };

      const result = await checkPostconditions(options);
      expect(result.pass).toBe(true);
    });
  });

  describe('validateInteractiveRequirements', () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it('should return true when no requirements are provided', () => {
      const result = validateInteractiveRequirements(
        {
          requirements: undefined,
        },
        'InteractiveStep'
      );

      expect(result).toBe(true);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should return true when requirements string is empty', () => {
      const result = validateInteractiveRequirements(
        {
          requirements: '',
        },
        'InteractiveStep'
      );

      expect(result).toBe(true);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should return true when requirements do not include exists-reftarget', () => {
      const result = validateInteractiveRequirements(
        {
          requirements: 'is-admin,has-datasources',
        },
        'InteractiveStep'
      );

      expect(result).toBe(true);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should return true when exists-reftarget is among multiple requirements and refTarget is provided', () => {
      const result = validateInteractiveRequirements(
        {
          requirements: 'is-admin,exists-reftarget,has-datasources',
          refTarget: 'button[data-testid="submit"]',
        },
        'InteractiveStep'
      );

      expect(result).toBe(true);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should return false when exists-reftarget is among multiple requirements but no refTarget is provided', () => {
      const result = validateInteractiveRequirements(
        {
          requirements: 'is-admin,exists-reftarget,has-datasources',
        },
        'InteractiveStep'
      );

      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it('should log error message with element type when validation fails', () => {
      validateInteractiveRequirements(
        {
          requirements: 'exists-reftarget',
        },
        'InteractiveMultiStep'
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[InteractiveMultiStep]'));
    });
  });
});
