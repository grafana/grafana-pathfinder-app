/**
 * Pure requirements checking utilities
 * Extracted from interactive.hook.ts to eliminate mock element anti-pattern
 *
 * This module handles requirements checking without DOM manipulation,
 * focusing on API calls, configuration checks, and Grafana state validation.
 */

import { locationService, config, hasPermission, getDataSourceSrv, getBackendSrv } from '@grafana/runtime';
import { ContextService } from './context';
import { reftargetExistsCHECK, navmenuOpenCHECK } from './dom-utils';

// Re-export types for convenience
export interface RequirementsCheckResult {
  requirements: string;
  pass: boolean;
  error: CheckResultError[];
}

export interface CheckResultError {
  requirement: string;
  pass: boolean;
  error?: string;
  context?: any;
  canFix?: boolean;
  fixType?: string;
  targetHref?: string;
}

export interface RequirementsCheckOptions {
  requirements: string;
  targetAction?: string;
  refTarget?: string;
  targetValue?: string;
  stepId?: string;
}

/**
 * Core requirements checking function (pure implementation)
 * Replaces the mock element anti-pattern with direct string-based checking
 */
type CheckMode = 'pre' | 'post';

interface CheckContext {
  targetAction?: string;
  refTarget?: string;
}

async function routeUnifiedCheck(check: string, ctx: CheckContext): Promise<CheckResultError> {
  const { targetAction = 'button', refTarget = '' } = ctx;

  // DOM-dependent checks
  if (check === 'exists-reftarget') {
    return reftargetExistsCHECK(refTarget, targetAction);
  }
  if (check === 'navmenu-open') {
    return navmenuOpenCHECK();
  }

  // Pure requirement checks
  if (check === 'has-datasources') {
    return hasDatasourcesCHECK(check);
  }
  if (check === 'is-admin') {
    return isAdminCHECK(check);
  }
  if (check === 'is-logged-in') {
    return isLoggedInCHECK(check);
  }
  if (check === 'is-editor') {
    return isEditorCHECK(check);
  }
  if (check.startsWith('has-permission:')) {
    return hasPermissionCHECK(check);
  }
  if (check.startsWith('has-role:')) {
    return hasRoleCHECK(check);
  }

  // Data source and plugin checks
  if (check.startsWith('has-datasource:')) {
    return hasDataSourceCHECK(check);
  }
  if (check === 'datasource-configured') {
    return datasourceConfiguredCHECK(check);
  }
  if (check.startsWith('has-plugin:')) {
    return hasPluginCHECK(check);
  }
  if (check === 'plugin-enabled') {
    return pluginEnabledCHECK(check);
  }
  if (check.startsWith('has-dashboard-named:')) {
    return hasDashboardNamedCHECK(check);
  }
  if (check === 'dashboard-exists') {
    return dashboardExistsCHECK(check);
  }

  // Location and navigation checks
  if (check.startsWith('on-page:')) {
    return onPageCHECK(check);
  }

  // Feature and environment checks
  if (check.startsWith('has-feature:')) {
    return hasFeatureCHECK(check);
  }
  if (check.startsWith('in-environment:')) {
    return inEnvironmentCHECK(check);
  }
  if (check.startsWith('min-version:')) {
    return minVersionCHECK(check);
  }

  // Section dependency checks
  if (check.startsWith('section-completed:')) {
    return sectionCompletedCHECK(check);
  }

  // UI state checks
  if (check === 'form-valid') {
    return formValidCHECK(check);
  }

  // Unknown token - this should fail, not pass
  return {
    requirement: check,
    pass: false,
    error: `Unknown requirement type: '${check}'. Check the requirement syntax and ensure it's supported.`,
  };
}

async function runUnifiedChecks(
  checksString: string,
  mode: CheckMode,
  ctx: CheckContext
): Promise<RequirementsCheckResult> {
  const checks: string[] = checksString
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  const results = await Promise.all(checks.map((check) => routeUnifiedCheck(check, ctx)));

  return {
    requirements: checksString,
    pass: results.every((r) => r.pass),
    error: results,
  };
}

export async function checkRequirements(options: RequirementsCheckOptions): Promise<RequirementsCheckResult> {
  const { requirements, targetAction = 'button', refTarget = '' } = options;
  if (!requirements) {
    return {
      requirements: requirements || '',
      pass: true,
      error: [],
    };
  }
  return runUnifiedChecks(requirements, 'pre', { targetAction, refTarget });
}

/**
 * Post-action verification checker
 * Similar to checkRequirements, but semantically intended for verifying outcomes AFTER an action.
 * Uses the same underlying pure checks where applicable (e.g., has-plugin, has-datasource, has-dashboard-named, on-page).
 * Excludes pre-action gating like navmenu-open and existence checks that are about enabling interactions.
 */
export async function checkPostconditions(options: RequirementsCheckOptions): Promise<RequirementsCheckResult> {
  const { requirements: verifyString, targetAction = 'button', refTarget = '' } = options;
  if (!verifyString) {
    return {
      requirements: verifyString || '',
      pass: true,
      error: [],
    };
  }
  return runUnifiedChecks(verifyString, 'post', { targetAction, refTarget });
}

/**
 * ============================================================================
 * PURE REQUIREMENTS CHECKING FUNCTIONS
 * These functions only use APIs, configuration, and Grafana state - no DOM
 * ============================================================================
 */

// Enhanced permission checking using Grafana's permission system
async function hasPermissionCHECK(check: string): Promise<CheckResultError> {
  try {
    const permission = check.replace('has-permission:', '');
    const hasAccess = hasPermission(permission);

    return {
      requirement: check,
      pass: hasAccess,
      error: hasAccess ? undefined : `Missing permission: ${permission}`,
    };
  } catch (error) {
    return {
      requirement: check,
      pass: false,
      error: `Permission check failed: ${error}`,
    };
  }
}

// Enhanced user role checking using config.bootData.user
async function hasRoleCHECK(check: string): Promise<CheckResultError> {
  try {
    const user = config.bootData?.user;
    if (!user) {
      return {
        requirement: check,
        pass: false,
        error: 'User information not available',
      };
    }

    const requiredRole = check.replace('has-role:', '').toLowerCase();
    let hasRole = false;

    switch (requiredRole) {
      case 'admin':
      case 'grafana-admin':
        // Consistent with isAdminCHECK - check both isGrafanaAdmin and orgRole
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
    };
  }
}

// Enhanced data source checking using DataSourceSrv
async function hasDataSourceCHECK(check: string): Promise<CheckResultError> {
  try {
    const dataSourceSrv = getDataSourceSrv();
    const dsRequirement = check.replace('has-datasource:', '').toLowerCase();

    const dataSources = dataSourceSrv.getList();
    let found = false;
    let matchType = '';

    // Check for exact matches in name, uid, or type
    for (const ds of dataSources) {
      if (ds.name.toLowerCase() === dsRequirement) {
        found = true;
        matchType = 'name';
        break;
      }
      if (ds.uid.toLowerCase() === dsRequirement) {
        found = true;
        matchType = 'uid';
        break;
      }
      if (ds.type.toLowerCase() === dsRequirement) {
        found = true;
        matchType = 'type';
        break;
      }
    }

    return {
      requirement: check,
      pass: found,
      error: found ? undefined : `No data source found with name/uid/type: ${dsRequirement}`,
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

// Plugin availability checking using /api/plugins endpoint
async function hasPluginCHECK(check: string): Promise<CheckResultError> {
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
        availablePlugins: plugins.map((p) => p.id).slice(0, 10), // Limit to avoid huge context
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

// Dashboard availability checking using /api/search endpoint
async function hasDashboardNamedCHECK(check: string): Promise<CheckResultError> {
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
        foundDashboards: dashboards.map((d) => d.title).slice(0, 5), // Limit results
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

// Location/URL checking using locationService
async function onPageCHECK(check: string): Promise<CheckResultError> {
  try {
    const location = locationService.getLocation();
    const requiredPath = check.replace('on-page:', '');
    const currentPath = location.pathname;
    const matches = currentPath.includes(requiredPath) || currentPath === requiredPath;

    return {
      requirement: check,
      pass: matches,
      error: matches ? undefined : `Current page '${currentPath}' does not match required path '${requiredPath}'`,
    };
  } catch (error) {
    return {
      requirement: check,
      pass: false,
      error: `Page check failed: ${error}`,
    };
  }
}

// Feature toggle checking
async function hasFeatureCHECK(check: string): Promise<CheckResultError> {
  try {
    const featureName = check.replace('has-feature:', '');
    const featureToggles = config.featureToggles as Record<string, boolean> | undefined;
    const isEnabled = featureToggles && featureToggles[featureName];

    return {
      requirement: check,
      pass: !!isEnabled,
      error: isEnabled ? undefined : `Feature toggle '${featureName}' is not enabled`,
    };
  } catch (error) {
    return {
      requirement: check,
      pass: false,
      error: `Feature check failed: ${error}`,
    };
  }
}

// Environment checking
async function inEnvironmentCHECK(check: string): Promise<CheckResultError> {
  try {
    const requiredEnv = check.replace('in-environment:', '').toLowerCase();
    const currentEnv = config.buildInfo?.env?.toLowerCase() || 'unknown';

    return {
      requirement: check,
      pass: currentEnv === requiredEnv,
      error:
        currentEnv === requiredEnv
          ? undefined
          : `Current environment '${currentEnv}' does not match required '${requiredEnv}'`,
    };
  } catch (error) {
    return {
      requirement: check,
      pass: false,
      error: `Environment check failed: ${error}`,
    };
  }
}

// Version checking
async function minVersionCHECK(check: string): Promise<CheckResultError> {
  try {
    const requiredVersion = check.replace('min-version:', '');
    const currentVersion = config.buildInfo?.version || '0.0.0';

    const parseVersion = (v: string) => v.split('.').map((n) => parseInt(n, 10));
    const [reqMajor, reqMinor, reqPatch] = parseVersion(requiredVersion);
    const [curMajor, curMinor, curPatch] = parseVersion(currentVersion);

    const meetsRequirement =
      curMajor > reqMajor ||
      (curMajor === reqMajor && curMinor > reqMinor) ||
      (curMajor === reqMajor && curMinor === reqMinor && curPatch >= reqPatch);

    return {
      requirement: check,
      pass: meetsRequirement,
      error: meetsRequirement
        ? undefined
        : `Current version '${currentVersion}' does not meet minimum requirement '${requiredVersion}'`,
    };
  } catch (error) {
    return {
      requirement: check,
      pass: false,
      error: `Version check failed: ${error}`,
    };
  }
}

// Admin status checking
async function isAdminCHECK(check: string): Promise<CheckResultError> {
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

    // Check both isGrafanaAdmin and orgRole for comprehensive admin detection
    const isAdmin = user.isGrafanaAdmin === true || user.orgRole === 'Admin';

    return {
      requirement: check,
      pass: isAdmin,
      error: isAdmin
        ? undefined
        : `User role '${user.orgRole || 'none'}' is not admin (isGrafanaAdmin: ${user.isGrafanaAdmin})`,
      context: {
        orgRole: user.orgRole,
        isGrafanaAdmin: user.isGrafanaAdmin,
        userId: user.id,
        login: user.login,
      },
    };
  } catch (error) {
    return {
      requirement: check,
      pass: false,
      error: `Admin check failed: ${error}`,
      context: { error },
    };
  }
}

// Login status checking
async function isLoggedInCHECK(check: string): Promise<CheckResultError> {
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

// Editor role checking (specific shorthand for editor permissions)
async function isEditorCHECK(check: string): Promise<CheckResultError> {
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

// Data sources availability checking
async function hasDatasourcesCHECK(check: string): Promise<CheckResultError> {
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

// Section completion checking - simple DOM-based approach
async function sectionCompletedCHECK(check: string): Promise<CheckResultError> {
  try {
    const sectionId = check.replace('section-completed:', '');

    // Check if the section exists in DOM and has completed class
    const sectionElement = document.getElementById(sectionId);
    const isCompleted = sectionElement?.classList.contains('completed') || false;

    return {
      requirement: check,
      pass: isCompleted,
      error: isCompleted ? undefined : `Section '${sectionId}' must be completed first`,
      context: { sectionId, found: !!sectionElement, hasCompletedClass: isCompleted },
    };
  } catch (error) {
    console.error('Section completion check error:', error);
    return {
      requirement: check,
      pass: false,
      error: `Section completion check failed: ${error}`,
      context: { error },
    };
  }
}

/**
 * ============================================================================
 * NEW REQUIREMENTS IMPLEMENTATIONS
 * ============================================================================
 */

// Plugin enabled status checking - different from has-plugin (checks if enabled)
async function pluginEnabledCHECK(check: string): Promise<CheckResultError> {
  try {
    const plugins = await ContextService.fetchPlugins();

    // Find plugins that are enabled
    const enabledPlugins = plugins.filter((plugin) => plugin.enabled);
    const hasEnabledPlugins = enabledPlugins.length > 0;

    return {
      requirement: check,
      pass: hasEnabledPlugins,
      error: hasEnabledPlugins ? undefined : 'No enabled plugins found',
      context: {
        totalPlugins: plugins.length,
        enabledCount: enabledPlugins.length,
        disabledCount: plugins.length - enabledPlugins.length,
        enabledPlugins: enabledPlugins.map((p) => p.id).slice(0, 10), // Limit to avoid huge context
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

// Dashboard exists checking - generic dashboard existence (different from named search)
async function dashboardExistsCHECK(check: string): Promise<CheckResultError> {
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

// Data source configured checking - uses test functionality to verify configuration
async function datasourceConfiguredCHECK(check: string): Promise<CheckResultError> {
  try {
    const dataSources = await ContextService.fetchDataSources();

    if (dataSources.length === 0) {
      return {
        requirement: check,
        pass: false,
        error: 'No data sources configured',
        context: { count: 0 },
      };
    }

    // Test the first available data source to see if it's properly configured
    const firstDataSource = dataSources[0];

    try {
      // Use the data source test API
      const testResult = await getBackendSrv().post(`/api/datasources/${firstDataSource.id}/test`);

      const isConfigured = testResult && (testResult.status === 'success' || testResult.message !== 'error');

      return {
        requirement: check,
        pass: isConfigured,
        error: isConfigured
          ? undefined
          : `Data source '${firstDataSource.name}' test failed: ${testResult?.message || 'Unknown error'}`,
        context: {
          testedDataSource: {
            id: firstDataSource.id,
            name: firstDataSource.name,
            type: firstDataSource.type,
          },
          testResult: testResult?.status || 'unknown',
          totalDataSources: dataSources.length,
        },
      };
    } catch (testError) {
      // If test fails, it might still be configured but unreachable
      return {
        requirement: check,
        pass: false,
        error: `Data source configuration test failed: ${testError}`,
        context: {
          testedDataSource: {
            id: firstDataSource.id,
            name: firstDataSource.name,
            type: firstDataSource.type,
          },
          testError: String(testError),
          totalDataSources: dataSources.length,
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

// Form validation checking - generic form validation state
async function formValidCHECK(check: string): Promise<CheckResultError> {
  try {
    // Look for common form validation indicators in the DOM
    const forms = document.querySelectorAll('form');

    if (forms.length === 0) {
      return {
        requirement: check,
        pass: false,
        error: 'No forms found on the page',
        context: { formCount: 0 },
      };
    }

    let hasValidForms = true;
    let validationErrors: string[] = [];

    // Check each form for validation state
    forms.forEach((form, index) => {
      // Look for common validation error indicators
      const errorElements = form.querySelectorAll('.error, .invalid, [aria-invalid="true"], .has-error, .field-error');
      const requiredEmptyFields = form.querySelectorAll(
        'input[required]:invalid, select[required]:invalid, textarea[required]:invalid'
      );

      if (errorElements.length > 0) {
        hasValidForms = false;
        validationErrors.push(`Form ${index + 1}: Has ${errorElements.length} validation errors`);
      }

      if (requiredEmptyFields.length > 0) {
        hasValidForms = false;
        validationErrors.push(`Form ${index + 1}: Has ${requiredEmptyFields.length} required empty fields`);
      }
    });

    return {
      requirement: check,
      pass: hasValidForms,
      error: hasValidForms ? undefined : `Form validation failed: ${validationErrors.join(', ')}`,
      context: {
        formCount: forms.length,
        validationErrors,
        hasValidForms,
      },
    };
  } catch (error) {
    return {
      requirement: check,
      pass: false,
      error: `Form validation check failed: ${error}`,
      context: { error },
    };
  }
}
