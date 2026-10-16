/**
 * Grafana API checks: data sources, plugins, dashboards, permissions, roles, login.
 *
 * Extracted from `requirements-checker.utils.ts` so each category lives next
 * to its peers and the router stays small.
 */

import { hasPermission } from '@grafana/runtime';
import { getDataSourceApi, listDataSources } from '../../lib/datasource/datasource-registry';
import { fetchDataSources, fetchPluginPresence, fetchDashboardsByName } from '../../lib/grafana-api';
import type { CheckResultError } from '../../types/requirements.types';
import {
  currentUser,
  currentUserIsAdmin,
  currentUserIsEditor,
  ensureCurrentUser,
  isCurrentUserRoleKnown,
} from '../../utils/current-user-role';

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
      verdict: 'unavailable',
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
    await ensureCurrentUser();
    const user = currentUser();
    if (!user.available) {
      return {
        requirement: check,
        pass: false,
        error: 'User information not available',
        context: null,
      };
    }
    if (!isCurrentUserRoleKnown()) {
      return {
        verdict: 'unavailable',
        requirement: check,
        pass: false,
        error: 'Your Grafana role could not be read',
        context: null,
      };
    }

    const requiredRole = check.replace('has-role:', '').toLowerCase();
    let hasRole = false;

    switch (requiredRole) {
      case 'admin':
      case 'grafana-admin':
        hasRole = currentUserIsAdmin();
        break;
      case 'editor':
        hasRole = currentUserIsEditor();
        break;
      case 'viewer':
        hasRole = !!user.role;
        break;
      default:
        hasRole = user.role?.toLowerCase() === requiredRole;
    }

    return {
      requirement: check,
      pass: hasRole,
      error: hasRole
        ? undefined
        : `User role '${user.role || 'none'}' does not meet requirement '${requiredRole}' (isGrafanaAdmin: ${user.isGrafanaAdmin})`,
      context: {
        orgRole: user.role,
        isGrafanaAdmin: user.isGrafanaAdmin,
        requiredRole,
        userId: user.id,
      },
    };
  } catch (error) {
    return {
      verdict: 'unavailable',
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
    const dsRequirement = check.replace('has-datasource:', '').toLowerCase();

    const dataSources = await listDataSources();
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
      verdict: 'unavailable',
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
    const { installed } = await fetchPluginPresence(pluginId);

    return {
      requirement: check,
      pass: installed,
      error: installed ? undefined : `Plugin '${pluginId}' is not installed or enabled`,
      context: {
        searched: pluginId,
        suggestion: installed ? undefined : 'Check your Grafana plugin management page',
      },
    };
  } catch (error) {
    return {
      verdict: 'unavailable',
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
    const dashboards = await fetchDashboardsByName(dashboardName, { throwOnError: true });
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
      verdict: 'unavailable',
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
    const user = currentUser();
    const hasUser = user.available;
    const isLoggedIn = hasUser && user.isSignedIn;

    return {
      requirement: check,
      pass: isLoggedIn,
      error: isLoggedIn ? undefined : 'User is not logged in',
      context: {
        hasUser,
        isSignedIn: hasUser ? user.isSignedIn : undefined,
        userId: user.id,
      },
    };
  } catch (error) {
    return {
      verdict: 'unavailable',
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
    await ensureCurrentUser();
    const user = currentUser();
    if (!user.available) {
      return {
        requirement: check,
        pass: false,
        error: 'User information not available',
        context: null,
      };
    }
    if (!isCurrentUserRoleKnown()) {
      return {
        verdict: 'unavailable',
        requirement: check,
        pass: false,
        error: 'Your Grafana role could not be read',
        context: null,
      };
    }
    const isEditor = currentUserIsEditor();

    return {
      requirement: check,
      pass: isEditor,
      error: isEditor ? undefined : `User role '${user.role || 'none'}' does not have editor permissions`,
      context: {
        orgRole: user.role,
        isGrafanaAdmin: user.isGrafanaAdmin,
        userId: user.id,
      },
    };
  } catch (error) {
    return {
      verdict: 'unavailable',
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
    const dataSources = await fetchDataSources({ throwOnError: true });
    return {
      requirement: check,
      pass: dataSources.length > 0,
      error: dataSources.length > 0 ? undefined : 'No data sources found',
      context: { count: dataSources.length, types: dataSources.map((ds) => ds.type) },
    };
  } catch (error) {
    return {
      verdict: 'unavailable',
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
    const { installed, enabled } = await fetchPluginPresence(pluginId);

    if (!installed) {
      return {
        requirement: check,
        pass: false,
        error: `Plugin '${pluginId}' not found`,
        context: {
          searched: pluginId,
          suggestion: `Plugin '${pluginId}' is not installed. Install it first, then enable it.`,
        },
      };
    }

    return {
      requirement: check,
      pass: enabled,
      error: enabled ? undefined : `Plugin '${pluginId}' is installed but not enabled`,
      context: {
        searched: pluginId,
        pluginFound: true,
        isEnabled: enabled,
        suggestion: enabled
          ? undefined
          : `Plugin '${pluginId}' is installed but disabled. Enable it in Grafana plugin settings.`,
      },
    };
  } catch (error) {
    return {
      verdict: 'unavailable',
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
    const dashboards = await fetchDashboardsByName('', { throwOnError: true });
    const hasDashboards = dashboards.length > 0;

    return {
      requirement: check,
      pass: hasDashboards,
      error: hasDashboards ? undefined : 'No dashboards found in the system',
      context: {
        dashboardCount: dashboards.length,
      },
    };
  } catch (error) {
    return {
      verdict: 'unavailable',
      requirement: check,
      pass: false,
      error: `Dashboard existence check failed: ${error}`,
      context: { error },
    };
  }
}

/**
 * Data source connection test. Stronger than `hasDataSourceCheck` — verifies
 * the data source's health endpoint reports OK, not just that it's listed.
 */
function describeTestFailure(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  if (!(error instanceof Error) && typeof message === 'string' && message) {
    return message;
  }
  return String(error);
}

export async function datasourceConfiguredCheck(check: string): Promise<CheckResultError> {
  try {
    const dsRequirement = check.replace('datasource-configured:', '').toLowerCase();
    const dataSources = await fetchDataSources({ throwOnError: true });

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
      // Backend data sources reject when the health check fails, so the non-OK
      // branch below only covers data sources that resolve with an error status.
      const healthResult = await (await getDataSourceApi(targetDataSource.uid)).testDatasource();

      const isConfigured = healthResult?.status === 'success' || healthResult?.status === 'OK';

      return {
        requirement: check,
        pass: isConfigured,
        error: isConfigured
          ? undefined
          : `Data source '${targetDataSource.name}' health check failed: ${healthResult?.message || 'Unknown error'}`,
        context: {
          searched: dsRequirement,
          testedDataSource: {
            id: targetDataSource.id,
            name: targetDataSource.name,
            type: targetDataSource.type,
          },
          testResult: healthResult?.status || 'unknown',
          suggestion: isConfigured
            ? undefined
            : `Data source '${targetDataSource.name}' exists but configuration test failed. Check connection settings.`,
        },
      };
    } catch (testError) {
      // If test fails, it might still be configured but unreachable
      const testErrorText = describeTestFailure(testError);
      return {
        verdict: 'unavailable',
        requirement: check,
        pass: false,
        error: `Data source configuration test failed: ${testErrorText}`,
        context: {
          searched: dsRequirement,
          testedDataSource: {
            id: targetDataSource.id,
            name: targetDataSource.name,
            type: targetDataSource.type,
          },
          testError: testErrorText,
          suggestion: `Test API call failed for '${targetDataSource.name}'. Check data source permissions and connectivity.`,
        },
      };
    }
  } catch (error) {
    return {
      verdict: 'unavailable',
      requirement: check,
      pass: false,
      error: `Data source configuration check failed: ${error}`,
      context: { error },
    };
  }
}
