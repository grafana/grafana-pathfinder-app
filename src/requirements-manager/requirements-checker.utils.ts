/**
 * Requirements checking — router and retry harness.
 *
 * The individual check implementations live next to their peers in
 * `./checks/*` (grafana-api, location, env, vars, terminal). This file holds
 * only:
 *   - The route map (which check string maps to which function)
 *   - The retry harness used by `checkRequirements` / `checkPostconditions`
 *   - The exported entry points
 *   - Author-time validation (`validateInteractiveRequirements`)
 *
 * Adding a new requirement type means:
 *   1. Implement the check in the right `./checks/*` file (or a new one)
 *   2. Add a case to `routeUnifiedCheck`
 *   3. Add the requirement string to `isValidRequirement` in `types/requirements.types.ts`
 */

import { reftargetExistsCheck, navmenuOpenCheck, sectionCompletedCheck, formValidCheck } from '../lib/dom';
import { isValidRequirement } from '../types/requirements.types';
import { INTERACTIVE_CONFIG } from '../constants/interactive-config';
import { TimeoutManager } from '../utils/timeout-manager';

import {
  hasPermissionCheck,
  hasRoleCheck,
  hasDataSourceCheck,
  hasPluginCheck,
  hasDashboardNamedCheck,
  isAdminCheck,
  isLoggedInCheck,
  isEditorCheck,
  hasDatasourcesCheck,
  pluginEnabledCheck,
  dashboardExistsCheck,
  datasourceConfiguredCheck,
} from './checks/grafana-api';
import { onPageCheck } from './checks/location';
import { hasFeatureCheck, inEnvironmentCheck, minVersionCheck, rendererCheck } from './checks/env';
import { guideVariableCheck } from './checks/vars';
import { terminalActiveCheck } from './checks/terminal';

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
  /** Scroll container selector for lazy-scroll fixes */
  scrollContainer?: string;
}

export interface RequirementsCheckOptions {
  requirements: string;
  targetAction?: string;
  refTarget?: string;
  targetValue?: string;
  stepId?: string;
  retryCount?: number; // Current retry attempt (internal use)
  maxRetries?: number; // Maximum retry attempts (defaults to config)
  /** Enable progressive scroll discovery for virtualized containers */
  lazyRender?: boolean;
  /** CSS selector for scroll container when lazyRender is enabled */
  scrollContainer?: string;
}

type CheckMode = 'pre' | 'post';

interface CheckContext {
  targetAction?: string;
  refTarget?: string;
  /** Enable progressive scroll discovery for virtualized containers */
  lazyRender?: boolean;
  /** CSS selector for scroll container when lazyRender is enabled */
  scrollContainer?: string;
}

async function routeUnifiedCheck(check: string, ctx: CheckContext): Promise<CheckResultError> {
  const { targetAction = 'button', refTarget = '', lazyRender, scrollContainer } = ctx;

  // Type-safe validation with helpful developer feedback
  if (!isValidRequirement(check)) {
    console.warn(
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
    return reftargetExistsCheck(refTarget, targetAction, { lazyRender, scrollContainer });
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

  // Terminal connection check
  if (check === 'is-terminal-active') {
    return terminalActiveCheck(check);
  }

  // Guide response variable checks (e.g., var-policyAccepted:true)
  if (check.startsWith('var-')) {
    return guideVariableCheck(check);
  }

  // Renderer context checks (e.g., renderer:pathfinder, renderer:website)
  if (check.startsWith('renderer:')) {
    return rendererCheck(check);
  }

  // This should never be reached due to type validation above, but keeping as fallback
  console.error(
    `Unexpected requirement type reached end of router: '${check}'. This indicates a bug in the type validation.`
  );

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
 * Shared retry logic for requirements and postconditions checking.
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
    lazyRender,
    scrollContainer,
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
    const result = await runUnifiedChecks(requirements, mode, { targetAction, refTarget, lazyRender, scrollContainer });

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
  } catch (error) {
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
 * Pre-action requirements checker. Validates requirements before an action can run.
 */
export async function checkRequirements(options: RequirementsCheckOptions): Promise<RequirementsCheckResult> {
  return executeChecksWithRetry(options, 'pre', 'requirements');
}

/**
 * Post-action verification checker. Same underlying checks as `checkRequirements`,
 * intended for verifying outcomes AFTER an action.
 */
export async function checkPostconditions(options: RequirementsCheckOptions): Promise<RequirementsCheckResult> {
  return executeChecksWithRetry(options, 'post', 'postconditions');
}

/**
 * Validates interactive element props and logs errors for impossible configurations.
 *
 * Specifically catches steps with `exists-reftarget` requirement but no refTarget,
 * which would make the step impossible to pass. Used at author-time to surface
 * mistakes in the block editor.
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

    console.error(errorMessage.join('\n'));

    return false;
  }

  return true;
}
