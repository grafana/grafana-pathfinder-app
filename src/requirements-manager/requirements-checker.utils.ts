import { warn, error } from '../lib/logger';
/**
 * Pure requirements checking utilities
 * Extracted from interactive.hook.ts to eliminate mock element anti-pattern
 *
 * This module handles requirements checking without DOM manipulation,
 * focusing on API calls, configuration checks, and Grafana state validation.
 */

import { locationService, config, hasPermission, getDataSourceSrv, getBackendSrv } from '@grafana/runtime';
import { ContextService } from '../context-engine';
import { reftargetExistsCheck, navmenuOpenCheck, sectionCompletedCheck, formValidCheck } from '../lib/dom';
import { isValidRequirement } from '../types/requirements.types';
import { INTERACTIVE_CONFIG } from '../constants/interactive-config';
import { TimeoutManager } from '../utils/timeout-manager';

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
  /** Diagnostic context for debugging. Should be included when available. */
  context?: Record<string, unknown> | null;
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
  retryCount?: number; // Current retry attempt (internal use)
  maxRetries?: number; // Maximum retry attempts (defaults to config)
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
    warn(
      `Unknown requirement type: '${check}'. Check the requirement syntax and ensure it's supported. Allowing step to proceed.`
    );

    return {
      requirement: check,
      pass: true,
      error: `Warning: Unknown requirement type '${check}' - step allowed to proceed`,
      context: null,
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
  error(`Unexpected requirement type reached end of router: '${check}'. This indicates a bug in the type validation.`);

  return {
    requirement: check,
    pass: true,
    error: `Warning: Unexpected requirement type '${check}' - step allowed to proceed`,
    context: null,
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

/**
 * Shared retry logic for requirements and postconditions checking
 * Extracts common retry pattern to reduce duplication
 */
async function executeChecksWithRetry(
  options: RequirementsCheckOptions,
  mode: CheckMode,
  checkType: 'requirements' | 'postconditions'
): Promise<RequirementsCheckResult> {
  const {
    requirements,
    targetAction = 'button',
    refTarget = '',
    retryCount = 0,
    maxRetries = INTERACTIVE_CONFIG.delays.requirements.maxRetries,
  } = options;

  if (!requirements) {
    return {
      requirements: requirements || '',
      pass: true,
      error: [],
    };
  }

  const timeoutKey = `${checkType}-retry-${requirements}-${retryCount}`;
  const errorTimeoutKey = `${checkType}-retry-error-${requirements}-${retryCount}`;

  try {
    const result = await runUnifiedChecks(requirements, mode, { targetAction, refTarget });

    // If the check passes, return success
    if (result.pass) {
      return result;
    }

    // If the check fails and we haven't exhausted retries, retry after delay
    if (retryCount < maxRetries) {
      const timeoutManager = TimeoutManager.getInstance();

      return new Promise((resolve) => {
        timeoutManager.setTimeout(
          timeoutKey,
          async () => {
            const retryResult = await executeChecksWithRetry(
              { ...options, retryCount: retryCount + 1 },
              mode,
              checkType
            );
            resolve(retryResult);
          },
          INTERACTIVE_CONFIG.delays.requirements.retryDelay
        );
      });
    }

    // If we've exhausted retries, return the last failed result
    return result;
  } catch (err) {
    // On error, retry if we haven't exhausted attempts
    if (retryCount < maxRetries) {
      const timeoutManager = TimeoutManager.getInstance();

      return new Promise((resolve) => {
        timeoutManager.setTimeout(
          errorTimeoutKey,
          async () => {
            const retryResult = await executeChecksWithRetry(
              { ...options, retryCount: retryCount + 1 },
              mode,
              checkType
            );
            resolve(retryResult);
          },
          INTERACTIVE_CONFIG.delays.requirements.retryDelay
        );
      });
    }

    // If we've exhausted retries, return error result
    const checkTypeName = checkType.charAt(0).toUpperCase() + checkType.slice(1);
    return {
      requirements: requirements || '',
      pass: false,
      error: [
        {
          requirement: requirements || 'unknown',
          pass: false,
          error: `${checkTypeName} check failed after ${maxRetries + 1} attempts: ${error}`,
          context: { error: String(error), retryCount, maxRetries },
        },
      ],
    };
  }
}

/**
 * Pre-action requirements checker
 * Validates requirements before an action can be performed
 */
export async function checkRequirements(options: RequirementsCheckOptions): Promise<RequirementsCheckResult> {
  return executeChecksWithRetry(options, 'pre', 'requirements');
}

/**
 * Post-action verification checker
 * Similar to checkRequirements, but semantically intended for verifying outcomes AFTER an action.
 * Uses the same underlying pure checks where applicable (e.g., has-plugin, has-datasource, has-dashboard-named, on-page).
 * Excludes pre-action gating like navmenu-open and existence checks that are about enabling interactions.
 */
export async function checkPostconditions(options: RequirementsCheckOptions): Promise<RequirementsCheckResult> {
  return executeChecksWithRetry(options, 'post', 'postconditions');
}

/**
 * ============================================================================
 * PURE REQUIREMENTS CHECKING FUNCTIONS
 * These functions only use APIs, configuration, and Grafana state - no DOM
 * ============================================================================
 */

/**
 * Permission checking - verifies user has specific Grafana permissions
 *
 * Use cases:
 * - Admin features: ensure user can manage data sources, users, etc.
 * - Data access: verify read/write permissions for specific resources
 * - Security gates: prevent unauthorized access to sensitive operations
 * - Role-based tutorials: show different content based on permissions
 *
 * How it works:
 * - Uses Grafana's built-in hasPermission() function
 * - Checks against Grafana's permission system
 * - Returns immediate boolean result (no API calls)
 *
 * Example usage:
 * - data-requirements="has-permission:datasources.read" - can view data sources
 * - data-requirements="has-permission:users.write" - can manage users
 * - data-requirements="has-permission:dashboards.create" - can create dashboards
 *
 * Common permissions:
 * - datasources.read, datasources.write
 * - dashboards.read, dashboards.write, dashboards.create
 * - users.read, users.write
 * - orgs.read, orgs.write
 */
async function hasPermissionCheck(check: string): Promise<CheckResultError> {
  try {
    const permission = check.replace('has-permission:', '');
    const hasAccess = hasPermission(permission);

    return {
      requirement: check,
      pass: hasAccess,
      error: hasAccess ? undefined : `Missing permission: ${permission}`,
      context: { permission, hasAccess },
    };
  } catch (err) {
    return {
      requirement: check,
      pass: false,
      error: `Permission check failed: ${error}`,
      context: { error: String(error) },
    };
  }
}

/**
 * User role checking - verifies user has specific organizational role
 *
 * Use cases:
 * - Role-based access: show admin-only or editor-only features
 * - Tutorial branching: different paths for different user types
 * - Feature gating: ensure user has sufficient privileges
 * - Security validation: verify role before sensitive operations
 *
 * Supported roles:
 * - admin/grafana-admin: Grafana admin or org admin
 * - editor: Editor role or higher (includes admins)
 * - viewer: Any role (viewer, editor, admin)
 * - Custom roles: exact case-insensitive match
 *
 * Role hierarchy (higher roles include lower permissions):
 * - Grafana Admin > Org Admin > Editor > Viewer
 *
 * Example usage:
 * - data-requirements="has-role:admin" - admin or grafana admin only
 * - data-requirements="has-role:editor" - editor or admin
 * - data-requirements="has-role:viewer" - any authenticated user
 * - data-requirements="has-role:custom-role" - exact role match
 */
async function hasRoleCheck(check: string): Promise<CheckResultError> {
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
  } catch (err) {
    return {
      requirement: check,
      pass: false,
      error: `Role check failed: ${error}`,
      context: { error: String(error) },
    };
  }
}

/**
 * Data source existence checking - verifies a specific data source is installed
 *
 * Use cases:
 * - Tutorial prerequisites: ensure required data source is available
 * - Feature dependencies: check if specific data source type exists
 * - Multi-data source tutorials: verify all needed sources are present
 * - Troubleshooting: validate data source installation
 *
 * How it works:
 * - Searches by name or type (case-insensitive)
 * - Uses DataSourceSrv.getList() for immediate results
 * - No connection testing (use datasource-configured for that)
 *
 * Example usage:
 * - data-requirements="has-datasource:prometheus" - Prometheus type exists
 * - data-requirements="has-datasource:loki" - Loki type exists
 * - data-requirements="has-datasource:My Production DB" - exact name match
 *
 * Search priority:
 * 1. Exact name match
 * 2. Exact type match
 *
 * Difference from datasource-configured:
 * - has-datasource: checks if data source exists/is installed
 * - datasource-configured: checks if data source exists AND works
 */
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
  } catch (err) {
    return {
      requirement: check,
      pass: false,
      error: `Data source check failed: ${error}`,
      context: { error },
    };
  }
}

/**
 * Plugin installation checking - verifies a specific plugin is installed
 *
 * Use cases:
 * - Tutorial prerequisites: ensure required plugins are available
 * - Feature availability: check if optional plugins are installed
 * - Compatibility checking: verify plugin dependencies
 * - Installation guides: validate plugin setup
 *
 * How it works:
 * - Searches by exact plugin ID match
 * - Uses /api/plugins endpoint via ContextService
 * - Only checks installation, not enabled status
 *
 * Example usage:
 * - data-requirements="has-plugin:volkovlabs-rss-datasource" - RSS plugin installed
 * - data-requirements="has-plugin:grafana-clock-panel" - Clock panel installed
 * - data-requirements="has-plugin:alexanderzobnin-zabbix-app" - Zabbix app installed
 *
 * Plugin ID format:
 * - Use exact plugin ID from plugin.json
 * - Case-sensitive matching
 * - Check Grafana plugin catalog for correct IDs
 *
 * Difference from plugin-enabled:
 * - has-plugin: checks if plugin is installed (may be disabled)
 * - plugin-enabled: checks if plugin is installed AND enabled
 */
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
  } catch (err) {
    return {
      requirement: check,
      pass: false,
      error: `Plugin check failed: ${error}`,
      context: { error },
    };
  }
}

/**
 * Dashboard existence by name - verifies a specific dashboard exists by title
 *
 * Use cases:
 * - Tutorial dependencies: ensure required dashboards are available
 * - Dashboard-based tutorials: verify target dashboard exists before proceeding
 * - Data visualization guides: check if example dashboards are present
 * - Import validation: confirm dashboard was successfully imported
 *
 * How it works:
 * - Searches dashboards by title using /api/search endpoint
 * - Case-insensitive exact title matching
 * - Returns search results for debugging
 *
 * Example usage:
 * - data-requirements="has-dashboard-named:Node Exporter Full" - specific dashboard
 * - data-requirements="has-dashboard-named:My Custom Dashboard" - user-created dashboard
 * - data-requirements="has-dashboard-named:Prometheus Overview" - imported dashboard
 *
 * Search behavior:
 * - Exact title match required (case-insensitive)
 * - Partial matches are found but don't satisfy requirement
 * - Provides helpful suggestions when similar dashboards exist
 *
 * Difference from dashboard-exists:
 * - has-dashboard-named: checks for specific dashboard by title
 * - dashboard-exists: checks if any dashboards exist in the system
 */
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
  } catch (err) {
    return {
      requirement: check,
      pass: false,
      error: `Dashboard check failed: ${error}`,
      context: { error },
    };
  }
}

/**
 * Page location checking - verifies user is on a specific page/URL
 *
 * Use cases:
 * - Context-sensitive tutorials: show steps only on relevant pages
 * - Navigation validation: ensure user reached the correct page
 * - Page-specific features: gate functionality to appropriate locations
 * - Workflow enforcement: verify user followed navigation steps
 *
 * How it works:
 * - Gets current pathname from Grafana's locationService
 * - Supports both exact matches and partial matches (contains)
 * - Case-sensitive path matching
 *
 * Example usage:
 * - data-requirements="on-page:/dashboards" - on dashboards page
 * - data-requirements="on-page:/datasources" - on data sources page
 * - data-requirements="on-page:/d/" - on any dashboard view page
 * - data-requirements="on-page:/explore" - on explore page
 *
 * Common Grafana paths:
 * - /dashboards - dashboard list
 * - /datasources - data source management
 * - /d/[uid] - specific dashboard
 * - /explore - explore/query interface
 * - /alerting - alerting rules
 * - /admin - admin pages
 *
 * Matching behavior:
 * - Exact match: current path === required path
 * - Partial match: current path contains required path
 */
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
      canFix: !matches,
      fixType: matches ? undefined : 'location',
      targetHref: matches ? undefined : requiredPath,
    };
  } catch (err) {
    return {
      requirement: check,
      pass: false,
      error: `Page check failed: ${error}`,
    };
  }
}

/**
 * Feature toggle checking - verifies a specific feature flag is enabled
 *
 * Use cases:
 * - Beta features: gate experimental functionality
 * - Version-specific features: check if new features are available
 * - A/B testing: show different content based on feature flags
 * - Gradual rollouts: enable features for specific deployments
 *
 * How it works:
 * - Checks config.featureToggles object
 * - Returns true only if feature is explicitly enabled
 * - Uses exact feature name matching
 *
 * Example usage:
 * - data-requirements="has-feature:alertingPreview" - alerting preview enabled
 * - data-requirements="has-feature:newDashboardExperience" - new dashboard UI
 * - data-requirements="has-feature:publicDashboards" - public sharing enabled
 *
 * Common feature toggles:
 * - alertingPreview - new alerting system
 * - publicDashboards - public dashboard sharing
 * - newDashboardExperience - updated dashboard UI
 * - correlations - data source correlations
 *
 * Note: Feature names are case-sensitive and match Grafana's feature toggle names
 */
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
  } catch (err) {
    return {
      requirement: check,
      pass: false,
      error: `Feature check failed: ${error}`,
    };
  }
}

/**
 * Environment checking - verifies Grafana is running in a specific environment
 *
 * Use cases:
 * - Cloud-specific features: show cloud-only functionality
 * - Development tutorials: different steps for dev vs production
 * - Environment-specific configuration: adapt content to deployment type
 * - Feature availability: some features only work in certain environments
 *
 * How it works:
 * - Checks config.buildInfo.env value
 * - Case-insensitive environment matching
 * - Uses Grafana's build-time environment detection
 *
 * Example usage:
 * - data-requirements="in-environment:production" - production Grafana
 * - data-requirements="in-environment:development" - dev environment
 * - data-requirements="in-environment:cloud" - Grafana Cloud
 *
 * Common environments:
 * - production - standard production deployment
 * - development - development/testing environment
 * - cloud - Grafana Cloud instances
 *
 * Note: Environment is set at build time and reflects deployment type
 */
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
  } catch (err) {
    return {
      requirement: check,
      pass: false,
      error: `Environment check failed: ${error}`,
    };
  }
}

/**
 * Minimum version checking - verifies Grafana version meets minimum requirement
 *
 * Use cases:
 * - Feature compatibility: ensure features are available in current version
 * - API availability: check if specific APIs exist in this Grafana version
 * - Tutorial adaptation: show different steps for different versions
 * - Deprecation warnings: alert about unsupported older versions
 *
 * How it works:
 * - Compares current Grafana version with required minimum
 * - Uses semantic versioning comparison (major.minor.patch)
 * - Gets version from config.buildInfo.version
 *
 * Example usage:
 * - data-requirements="min-version:9.0.0" - requires Grafana 9.0+
 * - data-requirements="min-version:10.1.0" - requires Grafana 10.1+
 * - data-requirements="min-version:8.5.0" - requires Grafana 8.5+
 *
 * Version comparison logic:
 * - 10.1.0 meets min-version:9.0.0 ✅
 * - 9.5.2 meets min-version:9.5.0 ✅
 * - 8.4.0 fails min-version:9.0.0 ❌
 *
 * Use for:
 * - New API features introduced in specific versions
 * - UI changes that happened in certain releases
 * - Plugin compatibility requirements
 */
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
  } catch (err) {
    return {
      requirement: check,
      pass: false,
      error: `Version check failed: ${error}`,
    };
  }
}

/**
 * Admin status checking - verifies user has admin privileges (shorthand for has-role:admin)
 *
 * Use cases:
 * - Admin-only features: gate administrative functionality
 * - System configuration: ensure user can modify system settings
 * - User management: verify permissions for user operations
 * - Security-sensitive operations: require admin privileges
 *
 * How it works:
 * - Delegates to hasRoleCheck('has-role:admin') for consistency
 * - Checks both isGrafanaAdmin and orgRole === 'Admin'
 * - Provides convenient shorthand for common admin check
 *
 * Example usage:
 * - data-requirements="is-admin" - simpler than has-role:admin
 * - Useful in admin tutorials and configuration guides
 *
 * Admin types recognized:
 * - Grafana Admin (isGrafanaAdmin: true) - super admin
 * - Organization Admin (orgRole: 'Admin') - org-level admin
 *
 * Equivalent to: has-role:admin
 */
async function isAdminCheck(check: string): Promise<CheckResultError> {
  // Just call hasRoleCheck with 'has-role:admin' to ensure identical logic
  const result = await hasRoleCheck('has-role:admin');

  // Update the requirement field to match the original check
  return {
    ...result,
    requirement: check,
  };
}

/**
 * Login status checking - verifies user is authenticated
 *
 * Use cases:
 * - Authentication gates: ensure user is logged in before proceeding
 * - User-specific features: gate personalized functionality
 * - Security validation: verify authentication for sensitive operations
 * - Tutorial prerequisites: ensure user has valid session
 *
 * How it works:
 * - Checks config.bootData.user existence and isSignedIn flag
 * - Validates both user object and sign-in status
 * - No API calls required (uses cached user data)
 *
 * Example usage:
 * - data-requirements="is-logged-in" - user must be authenticated
 * - Common prerequisite for most interactive guides
 * - Prevents anonymous users from accessing user-specific features
 *
 * Authentication states:
 * - Logged in: user exists and isSignedIn === true
 * - Not logged in: no user or isSignedIn === false
 * - Unknown: user data not available (treats as not logged in)
 *
 * Note: This is a basic authentication check, not authorization
 */
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
  } catch (err) {
    return {
      requirement: check,
      pass: false,
      error: `Login check failed: ${error}`,
      context: { error },
    };
  }
}

/**
 * Editor role checking - verifies user has editor privileges or higher
 *
 * Use cases:
 * - Content editing: ensure user can modify dashboards, panels, etc.
 * - Configuration changes: verify permissions for system modifications
 * - Tutorial gating: show editing features only to authorized users
 * - Write operations: validate permissions before allowing changes
 *
 * How it works:
 * - Checks for Editor, Admin, or Grafana Admin roles
 * - Follows role hierarchy (admins have editor permissions)
 * - Uses cached user data from config.bootData.user
 *
 * Example usage:
 * - data-requirements="is-editor" - can edit content
 * - Useful before dashboard editing tutorials
 * - Gates features that modify Grafana configuration
 *
 * Role hierarchy (all can edit):
 * - Grafana Admin (isGrafanaAdmin: true)
 * - Organization Admin (orgRole: 'Admin')
 * - Editor (orgRole: 'Editor')
 *
 * Excluded:
 * - Viewer (orgRole: 'Viewer') - read-only access
 *
 * Note: More permissive than is-admin, includes editor role
 */
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
  } catch (err) {
    return {
      requirement: check,
      pass: false,
      error: `Editor check failed: ${error}`,
      context: { error },
    };
  }
}

/**
 * Data sources availability checking - verifies at least one data source exists
 *
 * Use cases:
 * - Tutorial prerequisites: ensure basic Grafana setup is complete
 * - Data-dependent features: verify data sources are available before querying
 * - Setup validation: check if initial configuration is done
 * - Onboarding flows: guide users through basic setup
 *
 * How it works:
 * - Counts total number of configured data sources
 * - Uses ContextService.fetchDataSources() API call
 * - Passes if any data sources exist (regardless of type or status)
 *
 * Example usage:
 * - data-requirements="has-datasources" - at least one data source exists
 * - Common prerequisite for data visualization tutorials
 * - Ensures users have completed basic Grafana setup
 *
 * What it checks:
 * - Total count > 0 (any data source type)
 * - Includes all configured data sources (enabled and disabled)
 * - Does not test connectivity (use datasource-configured for that)
 *
 * Difference from specific checks:
 * - has-datasources: any data source exists
 * - has-datasource:X: specific data source exists
 * - datasource-configured:X: specific data source exists and works
 */
async function hasDatasourcesCheck(check: string): Promise<CheckResultError> {
  try {
    const dataSources = await ContextService.fetchDataSources();
    return {
      requirement: check,
      pass: dataSources.length > 0,
      error: dataSources.length > 0 ? undefined : 'No data sources found',
      context: { count: dataSources.length, types: dataSources.map((ds) => ds.type) },
    };
  } catch (err) {
    return {
      requirement: check,
      pass: false,
      error: `Failed to check data sources: ${error}`,
      context: { error },
    };
  }
}

/**
 * Plugin enabled status checking - verifies a specific plugin is installed AND enabled
 *
 * Use cases:
 * - Before using plugin features: ensure plugin is active
 * - Tutorial prerequisites: verify required plugins are enabled
 * - Feature availability: check if optional plugins are ready to use
 * - Troubleshooting: validate plugin activation status
 *
 * How it works:
 * - Finds plugin by exact ID match
 * - Checks both existence and enabled status
 * - Distinguishes between "not installed" vs "installed but disabled"
 *
 * Example usage:
 * - data-requirements="plugin-enabled:volkovlabs-rss-datasource" - RSS plugin ready
 * - data-requirements="plugin-enabled:grafana-clock-panel" - Clock panel enabled
 * - data-requirements="plugin-enabled:alexanderzobnin-zabbix-app" - Zabbix app active
 *
 * Difference from has-plugin:
 * - has-plugin: checks if plugin is installed (may be disabled)
 * - plugin-enabled: checks if plugin is installed AND enabled (ready to use)
 */
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
  } catch (err) {
    return {
      requirement: check,
      pass: false,
      error: `Plugin enabled check failed: ${error}`,
      context: { error },
    };
  }
}

/**
 * Dashboard existence checking - verifies at least one dashboard exists in the system
 *
 * Use cases:
 * - Tutorial prerequisites: ensure dashboards are available for examples
 * - Content validation: verify Grafana has dashboard content
 * - Setup completion: check if users have created any dashboards
 * - Feature availability: ensure dashboard features can be demonstrated
 *
 * How it works:
 * - Uses /api/search endpoint with type: 'dash-db'
 * - Checks for any non-deleted dashboards
 * - Limit 1 for efficiency (just need to know if any exist)
 *
 * Example usage:
 * - data-requirements="dashboard-exists" - at least one dashboard exists
 * - Useful before dashboard navigation tutorials
 * - Ensures dashboard features can be demonstrated
 *
 * What it checks:
 * - Any dashboard exists (regardless of name or content)
 * - Excludes deleted dashboards
 * - System-wide check across all organizations
 *
 * Difference from specific checks:
 * - dashboard-exists: any dashboard exists
 * - has-dashboard-named:X: specific dashboard by title exists
 *
 * Performance: Uses limit=1 for fast existence check
 */
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
  } catch (err) {
    return {
      requirement: check,
      pass: false,
      error: `Dashboard existence check failed: ${error}`,
      context: { error },
    };
  }
}

/**
 * Data source configuration testing - verifies a specific data source is properly configured and working
 *
 * Use cases:
 * - Before querying data: ensure data source connection works
 * - Tutorial prerequisites: verify Prometheus/Loki/etc. is set up correctly
 * - Dashboard creation: check required data sources are functional
 * - Troubleshooting guides: validate data source connectivity
 *
 * How it works:
 * - Finds data source by name or type (case-insensitive)
 * - Calls Grafana's /api/datasources/{id}/test endpoint
 * - Only passes if test returns status: 'success'
 *
 * Example usage:
 * - data-requirements="datasource-configured:prometheus" - check Prometheus works
 * - data-requirements="datasource-configured:loki" - check Loki connection
 * - data-requirements="datasource-configured:My Custom DS" - check by exact name
 *
 * Difference from has-datasource:
 * - has-datasource: checks if data source exists/is installed
 * - datasource-configured: checks if data source exists AND connection test passes
 */
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
  } catch (err) {
    return {
      requirement: check,
      pass: false,
      error: `Data source configuration check failed: ${error}`,
      context: { error },
    };
  }
}

/**
 * Validates interactive element props and logs errors for impossible configurations
 *
 * This utility detects impossible requirement combinations and logs console errors
 * to help authors catch configuration mistakes during development.
 *
 * Specifically, it checks if an element has 'exists-reftarget' requirement but
 * no refTarget, which would make the step impossible to pass.
 *
 * @param props - Interactive element props to validate
 * @param elementType - Human-readable element type (e.g., 'InteractiveStep', 'InteractiveMultiStep')
 * @returns true if validation passed, false if errors were logged
 */
export function validateInteractiveRequirements(
  props: {
    requirements?: string;
    refTarget?: string;
    stepId?: string;
    originalHTML?: string;
  },
  elementType: string
): boolean {
  const { requirements, refTarget, stepId, originalHTML } = props;

  // If no requirements, nothing to validate
  if (!requirements) {
    return true;
  }

  // Check if requirements include 'exists-reftarget'
  const requirementList = requirements.split(',').map((r) => r.trim());
  const hasExistsReftarget = requirementList.includes('exists-reftarget');

  // If 'exists-reftarget' is present but no refTarget, this is an impossible configuration
  if (hasExistsReftarget && !refTarget) {
    const errorMessage = [
      `[${elementType}] Invalid requirement configuration:`,
      `  - Element has 'exists-reftarget' requirement but no refTarget`,
      `  - Step ID: ${stepId || 'unknown'}`,
      `  - This step can never pass because there is no target element to check`,
      `  - Fix: Either add a data-reftarget attribute or remove 'exists-reftarget' from requirements`,
    ];

    if (originalHTML) {
      errorMessage.push(
        `  - Original HTML: ${originalHTML.substring(0, 200)}${originalHTML.length > 200 ? '...' : ''}`
      );
    }

    error(errorMessage.join('\n'));

    return false;
  }

  return true;
}
