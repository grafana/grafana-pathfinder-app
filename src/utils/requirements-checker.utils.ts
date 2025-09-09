/**
 * Pure requirements checking utilities
 * Extracted from interactive.hook.ts to eliminate mock element anti-pattern
 *
 * This module handles requirements checking without DOM manipulation,
 * focusing on API calls, configuration checks, and Grafana state validation.
 */

import { locationService, config, hasPermission, getDataSourceSrv, getBackendSrv } from '@grafana/runtime';
import { ContextService } from './context';
import { reftargetExistsCheck, navmenuOpenCheck } from './dom-utils';
import { isValidRequirement } from '../types/requirements.types';

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

  // Type-safe validation with helpful developer feedback
  if (!isValidRequirement(check)) {
    console.warn(
      `⚠️ Unknown requirement type: '${check}'. Check the requirement syntax and ensure it's supported. Allowing step to proceed.`
    );

    return {
      requirement: check,
      pass: true,
      error: `Warning: Unknown requirement type '${check}' - step allowed to proceed`,
    };
  }

  // DOM-dependent checks
  if (check === 'exists-reftarget') {
    return reftargetExistsCheck(refTarget, targetAction);
  }
  if (check === 'navmenu-open') {
    return navmenuOpenCheck();
  }

  // Pure requirement checks
  if (check === 'has-datasources') {
    return hasDatasourcesCheck(check);
  }
  if (check === 'is-admin') {
    return isAdminCheck(check);
  }
  if (check === 'is-logged-in') {
    return isLoggedInCheck(check);
  }
  if (check === 'is-editor') {
    return isEditorCheck(check);
  }
  if (check.startsWith('has-permission:')) {
    return hasPermissionCheck(check);
  }
  if (check.startsWith('has-role:')) {
    return hasRoleCheck(check);
  }

  // Data source and plugin checks
  if (check.startsWith('has-datasource:')) {
    return hasDataSourceCheck(check);
  }
  if (check.startsWith('datasource-configured:')) {
    return datasourceConfiguredCheck(check);
  }
  if (check.startsWith('has-plugin:')) {
    return hasPluginCheck(check);
  }
  if (check.startsWith('plugin-enabled:')) {
    return pluginEnabledCheck(check);
  }
  if (check.startsWith('has-dashboard-named:')) {
    return hasDashboardNamedCheck(check);
  }
  if (check === 'dashboard-exists') {
    return dashboardExistsCheck(check);
  }

  // Location and navigation checks
  if (check.startsWith('on-page:')) {
    return onPageCheck(check);
  }

  // Feature and environment checks
  if (check.startsWith('has-feature:')) {
    return hasFeatureCheck(check);
  }
  if (check.startsWith('in-environment:')) {
    return inEnvironmentCheck(check);
  }
  if (check.startsWith('min-version:')) {
    return minVersionCheck(check);
  }

  // Section dependency checks
  if (check.startsWith('section-completed:')) {
    return sectionCompletedCheck(check);
  }

  // UI state checks
  if (check === 'form-valid') {
    return formValidCheck(check);
  }

  // This should never be reached due to type validation above, but keeping as fallback
  console.error(
    `Unexpected requirement type reached end of router: '${check}'. This indicates a bug in the type validation.`
  );

  return {
    requirement: check,
    pass: true,
    error: `Warning: Unexpected requirement type '${check}' - step allowed to proceed`,
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
async function hasPermissionCheck(check: string): Promise<CheckResultError> {
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
async function hasRoleCheck(check: string): Promise<CheckResultError> {
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
async function hasDataSourceCheck(check: string): Promise<CheckResultError> {
  try {
    const dataSourceSrv = getDataSourceSrv();
    const dsRequirement = check.replace('has-datasource:', '').toLowerCase();

    const dataSources = dataSourceSrv.getList();
    let found = false;
    let matchType = '';

    // Check for exact matches in name or type
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
    }

    return {
      requirement: check,
      pass: found,
      error: found ? undefined : `No data source found with name/type: ${dsRequirement}`,
      context: {
        searched: dsRequirement,
        matchType: found ? matchType : null,
        available: dataSources.map((ds) => ({ name: ds.name, type: ds.type, id: ds.id })),
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
async function hasPluginCheck(check: string): Promise<CheckResultError> {
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
        // More actionable: tell them how to find what they need
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

// Dashboard availability checking using /api/search endpoint
async function hasDashboardNamedCheck(check: string): Promise<CheckResultError> {
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

// Location/URL checking using locationService
async function onPageCheck(check: string): Promise<CheckResultError> {
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
async function hasFeatureCheck(check: string): Promise<CheckResultError> {
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
async function inEnvironmentCheck(check: string): Promise<CheckResultError> {
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
async function minVersionCheck(check: string): Promise<CheckResultError> {
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

// Admin status checking - delegates to hasRoleCheck for consistency
async function isAdminCheck(check: string): Promise<CheckResultError> {
  // Just call hasRoleCheck with 'has-role:admin' to ensure identical logic
  const result = await hasRoleCheck('has-role:admin');

  // Update the requirement field to match the original check
  return {
    ...result,
    requirement: check,
  };
}

// Login status checking
async function isLoggedInCheck(check: string): Promise<CheckResultError> {
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
async function isEditorCheck(check: string): Promise<CheckResultError> {
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
async function hasDatasourcesCheck(check: string): Promise<CheckResultError> {
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
async function sectionCompletedCheck(check: string): Promise<CheckResultError> {
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


// Plugin enabled status checking - checks if a specific plugin is enabled
async function pluginEnabledCheck(check: string): Promise<CheckResultError> {
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

// Dashboard exists checking - generic dashboard existence (different from named search)
async function dashboardExistsCheck(check: string): Promise<CheckResultError> {
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

// Data source configured checking - tests if a specific data source is properly configured
async function datasourceConfiguredCheck(check: string): Promise<CheckResultError> {
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

    // Check for exact matches in name or type (same logic as hasDataSourceCheck)
    for (const ds of dataSources) {
      if (ds.name.toLowerCase() === dsRequirement || ds.type.toLowerCase() === dsRequirement) {
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
      const testResult = await getBackendSrv().post(`/api/datasources/${targetDataSource.id}/test`);

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

// Form validation checking - generic form validation state
async function formValidCheck(check: string): Promise<CheckResultError> {
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
