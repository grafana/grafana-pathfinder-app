/**
 * Grafana API checks: data sources, plugins, dashboards, permissions, roles, login.
 *
 * Extracted from `requirements-checker.utils.ts` so each category lives next
 * to its peers and the router stays small.
 */

import { config, hasPermission, getDataSourceSrv, getBackendSrv } from '@grafana/runtime';
// eslint-disable-next-line no-restricted-imports -- [ratchet] ALLOWED_LATERAL_VIOLATIONS: requirements-manager -> context-engine
import { ContextService } from '../../context-engine';
import type { CheckResultError } from '../requirements-checker.utils';

/**
 * Permission checking via Grafana's hasPermission helper.
 */
export async function hasPermissionCheck(check: string): Promise<CheckResultError> {
  try {
    const permission = check.replace('has-permission:', '');
    const hasAccess = hasPermission(permission);

    return {
      requirement: check,
      pass: hasAccess,
      error: hasAccess ? undefined : `Missing permission: ${permission}`,
      context: { permission, hasAccess },
    };
  } catch (error) {
    return {
      requirement: check,
      pass: false,
      error: `Permission check failed: ${error}`,
      context: { error: String(error) },
    };
  }
}

/**
 * User role checking with case-insensitive support and admin/editor/viewer hierarchy.
 */
export async function hasRoleCheck(check: string): Promise<CheckResultError> {
  try {
    const user = config.bootData?.user;
    if (!user) {
      return {
        requirement: check,
        pass: false,
        error: 'User information not available',
        context: null,
      };
    }

    const requiredRole = check.replace('has-role:', '').toLowerCase();
    let hasRole = false;

    switch (requiredRole) {
      case 'admin':
      case 'grafana-admin':
        hasRole = user.isGrafanaAdmin === true || user.orgRole === 'Admin';
        break;
      case 'editor':
        hasRole = user.orgRole === 'Editor' || user.orgRole === 'Admin' || user.isGrafanaAdmin === true;
        break;
      case 'viewer':
        hasRole = !!user.orgRole; // Any role satisfies viewer requirement
        break;
      default:
        // For custom roles, do case-insensitive comparison
        hasRole = user.orgRole?.toLowerCase() === requiredRole;
    }

    return {
      requirement: check,
      pass: hasRole,
      error: hasRole
        ? undefined
        : `User role '${user.orgRole || 'none'}' does not meet requirement '${requiredRole}' (isGrafanaAdmin: ${user.isGrafanaAdmin})`,
      context: {
        orgRole: user.orgRole,
        isGrafanaAdmin: user.isGrafanaAdmin,
        requiredRole,
        userId: user.id,
      },
    };
  } catch (error) {
    return {
      requirement: check,
      pass: false,
      error: `Role check failed: ${error}`,
      context: { error: String(error) },
    };
  }
}

/**
 * Data source existence by name or type.
 */
export async function hasDataSourceCheck(check: string): Promise<CheckResultError> {
  try {
    const dataSourceSrv = getDataSourceSrv();
    const dsRequirement = check.replace('has-datasource:', '').toLowerCase();

    const dataSources = dataSourceSrv.getList();
    let found = false;
    let matchType = '';

    // Check for exact matches in name or type, then normalized type
    // Type normalization strips common prefixes/suffixes (e.g. grafana-testdata-datasource → testdata)
    for (const ds of dataSources) {
      if (ds.name.toLowerCase() === dsRequirement) {
        found = true;
        matchType = 'name';
        break;
      }
      if (ds.type.toLowerCase() === dsRequirement) {
        found = true;
        matchType = 'type';
        break;
      }
      const normalizedType = ds.type
        .toLowerCase()
        .replace(/^grafana-/, '')
        .replace(/-datasource$/, '');
      if (normalizedType === dsRequirement) {
        found = true;
        matchType = 'type-normalized';
        break;
      }
    }

    return {
      requirement: check,
      pass: found,
      error: found ? undefined : `No data source found with name/type: ${dsRequirement}`,
      context: {
        searched: dsRequirement,
        matchType: found ? matchType : null,
        available: dataSources.map((ds) => ({ name: ds.name, type: ds.type, uid: ds.uid })),
      },
    };
  } catch (error) {
    return {
      requirement: check,
      pass: false,
      error: `Data source check failed: ${error}`,
      context: { error },
    };
  }
}

/**
 * Plugin installed (may be disabled). See `pluginEnabledCheck` for the
 * "installed AND enabled" variant.
 */
export async function hasPluginCheck(check: string): Promise<CheckResultError> {
  try {
    const pluginId = check.replace('has-plugin:', '');
    const plugins = await ContextService.fetchPlugins();
    const pluginExists = plugins.some((plugin) => plugin.id === pluginId);

    return {
      requirement: check,
      pass: pluginExists,
      error: pluginExists ? undefined : `Plugin '${pluginId}' is not installed or enabled`,
      context: {
        searched: pluginId,
        totalPlugins: plugins.length,
        suggestion:
          plugins.length > 0
            ? `Check your Grafana plugin management page - ${plugins.length} plugins are available`
            : 'No plugins found - check your Grafana installation',
      },
    };
  } catch (error) {
    return {
      requirement: check,
      pass: false,
      error: `Plugin check failed: ${error}`,
      context: { error },
    };
  }
}

/**
 * Dashboard exists by exact title (case-insensitive).
 */
export async function hasDashboardNamedCheck(check: string): Promise<CheckResultError> {
  try {
    const dashboardName = check.replace('has-dashboard-named:', '');
    const dashboards = await ContextService.fetchDashboardsByName(dashboardName);
    const dashboardExists = dashboards.some(
      (dashboard) => dashboard.title.toLowerCase() === dashboardName.toLowerCase()
    );

    return {
      requirement: check,
      pass: dashboardExists,
      error: dashboardExists ? undefined : `Dashboard named '${dashboardName}' not found`,
      context: {
        searched: dashboardName,
        totalFound: dashboards.length,
        suggestion:
          dashboards.length > 0
            ? `Found ${dashboards.length} dashboards matching search, but none with exact name '${dashboardName}'. Check dashboard names in Grafana.`
            : `No dashboards found matching '${dashboardName}'. Check if the dashboard exists.`,
      },
    };
  } catch (error) {
    return {
      requirement: check,
      pass: false,
      error: `Dashboard check failed: ${error}`,
      context: { error },
    };
  }
}

/**
 * Admin shorthand. Delegates to `hasRoleCheck('has-role:admin')` so the logic
 * stays in one place.
 */
export async function isAdminCheck(check: string): Promise<CheckResultError> {
  // Just call hasRoleCheck with 'has-role:admin' to ensure identical logic
  const result = await hasRoleCheck('has-role:admin');

  // Update the requirement field to match the original check
  return {
    ...result,
    requirement: check,
  };
}

/**
 * Authenticated session check.
 */
export async function isLoggedInCheck(check: string): Promise<CheckResultError> {
  try {
    const user = config.bootData?.user;
    const isLoggedIn = !!user && !!user.isSignedIn;

    return {
      requirement: check,
      pass: isLoggedIn,
      error: isLoggedIn ? undefined : 'User is not logged in',
      context: {
        hasUser: !!user,
        isSignedIn: user?.isSignedIn,
        userId: user?.id,
      },
    };
  } catch (error) {
    return {
      requirement: check,
      pass: false,
      error: `Login check failed: ${error}`,
      context: { error },
    };
  }
}

/**
 * Editor role or higher (Admin / Grafana Admin).
 */
export async function isEditorCheck(check: string): Promise<CheckResultError> {
  try {
    const user = config.bootData?.user;
    if (!user) {
      return {
        requirement: check,
        pass: false,
        error: 'User information not available',
        context: null,
      };
    }

    // Editor or higher (Admin, Grafana Admin)
    const isEditor = user.orgRole === 'Editor' || user.orgRole === 'Admin' || user.isGrafanaAdmin === true;

    return {
      requirement: check,
      pass: isEditor,
      error: isEditor ? undefined : `User role '${user.orgRole || 'none'}' does not have editor permissions`,
      context: {
        orgRole: user.orgRole,
        isGrafanaAdmin: user.isGrafanaAdmin,
        userId: user.id,
      },
    };
  } catch (error) {
    return {
      requirement: check,
      pass: false,
      error: `Editor check failed: ${error}`,
      context: { error },
    };
  }
}

/**
 * Any data source exists. Use `hasDataSourceCheck` for "this specific one".
 */
export async function hasDatasourcesCheck(check: string): Promise<CheckResultError> {
  try {
    const dataSources = await ContextService.fetchDataSources();
    return {
      requirement: check,
      pass: dataSources.length > 0,
      error: dataSources.length > 0 ? undefined : 'No data sources found',
      context: { count: dataSources.length, types: dataSources.map((ds) => ds.type) },
    };
  } catch (error) {
    return {
      requirement: check,
      pass: false,
      error: `Failed to check data sources: ${error}`,
      context: { error },
    };
  }
}

/**
 * Plugin installed AND enabled. See `hasPluginCheck` for "installed only".
 */
export async function pluginEnabledCheck(check: string): Promise<CheckResultError> {
  try {
    const pluginId = check.replace('plugin-enabled:', '');
    const plugins = await ContextService.fetchPlugins();

    // Find the specific plugin
    const plugin = plugins.find((p) => p.id === pluginId);

    if (!plugin) {
      return {
        requirement: check,
        pass: false,
        error: `Plugin '${pluginId}' not found`,
        context: {
          searched: pluginId,
          totalPlugins: plugins.length,
          suggestion: `Plugin '${pluginId}' is not installed. Install it first, then enable it.`,
        },
      };
    }

    const isEnabled = plugin.enabled;

    return {
      requirement: check,
      pass: isEnabled,
      error: isEnabled ? undefined : `Plugin '${pluginId}' is installed but not enabled`,
      context: {
        searched: pluginId,
        pluginFound: true,
        isEnabled: plugin.enabled,
        suggestion: isEnabled
          ? undefined
          : `Plugin '${pluginId}' is installed but disabled. Enable it in Grafana plugin settings.`,
      },
    };
  } catch (error) {
    return {
      requirement: check,
      pass: false,
      error: `Plugin enabled check failed: ${error}`,
      context: { error },
    };
  }
}

/**
 * Any non-deleted dashboard exists.
 */
export async function dashboardExistsCheck(check: string): Promise<CheckResultError> {
  try {
    const dashboards = await getBackendSrv().get('/api/search', {
      type: 'dash-db',
      limit: 1, // We just need to know if any exist
      deleted: false,
    });

    const hasDashboards = dashboards && dashboards.length > 0;

    return {
      requirement: check,
      pass: hasDashboards,
      error: hasDashboards ? undefined : 'No dashboards found in the system',
      context: {
        dashboardCount: dashboards?.length || 0,
      },
    };
  } catch (error) {
    return {
      requirement: check,
      pass: false,
      error: `Dashboard existence check failed: ${error}`,
      context: { error },
    };
  }
}

/**
 * Data source connection test. Stronger than `hasDataSourceCheck` — verifies
 * the data source's `/test` endpoint returns success, not just that it's listed.
 */
export async function datasourceConfiguredCheck(check: string): Promise<CheckResultError> {
  try {
    const dsRequirement = check.replace('datasource-configured:', '').toLowerCase();
    const dataSources = await ContextService.fetchDataSources();

    if (dataSources.length === 0) {
      return {
        requirement: check,
        pass: false,
        error: 'No data sources available to test',
        context: {
          searched: dsRequirement,
          totalDataSources: 0,
          suggestion: 'Configure at least one data source first',
        },
      };
    }

    // Find the specific data source to test
    let targetDataSource = null;

    // Check for exact matches in name or type, then normalized type (same logic as hasDataSourceCheck)
    for (const ds of dataSources) {
      if (ds.name.toLowerCase() === dsRequirement || ds.type.toLowerCase() === dsRequirement) {
        targetDataSource = ds;
        break;
      }
      const normalizedType = ds.type
        .toLowerCase()
        .replace(/^grafana-/, '')
        .replace(/-datasource$/, '');
      if (normalizedType === dsRequirement) {
        targetDataSource = ds;
        break;
      }
    }

    if (!targetDataSource) {
      return {
        requirement: check,
        pass: false,
        error: `Data source '${dsRequirement}' not found`,
        context: {
          searched: dsRequirement,
          totalDataSources: dataSources.length,
          suggestion: `Data source '${dsRequirement}' not found. Check the name/type and ensure it exists.`,
        },
      };
    }

    try {
      // Use the data source test API
      const testResult = await getBackendSrv().post(`/api/datasources/uid/${targetDataSource.uid}/test`);

      const isConfigured = testResult && testResult.status === 'success';

      return {
        requirement: check,
        pass: isConfigured,
        error: isConfigured
          ? undefined
          : `Data source '${targetDataSource.name}' test failed: ${testResult?.message || 'Unknown error'}`,
        context: {
          searched: dsRequirement,
          testedDataSource: {
            id: targetDataSource.id,
            name: targetDataSource.name,
            type: targetDataSource.type,
          },
          testResult: testResult?.status || 'unknown',
          suggestion: isConfigured
            ? undefined
            : `Data source '${targetDataSource.name}' exists but configuration test failed. Check connection settings.`,
        },
      };
    } catch (testError) {
      // If test fails, it might still be configured but unreachable
      return {
        requirement: check,
        pass: false,
        error: `Data source configuration test failed: ${testError}`,
        context: {
          searched: dsRequirement,
          testedDataSource: {
            id: targetDataSource.id,
            name: targetDataSource.name,
            type: targetDataSource.type,
          },
          testError: String(testError),
          suggestion: `Test API call failed for '${targetDataSource.name}'. Check data source permissions and connectivity.`,
        },
      };
    }
  } catch (error) {
    return {
      requirement: check,
      pass: false,
      error: `Data source configuration check failed: ${error}`,
      context: { error },
    };
  }
}
