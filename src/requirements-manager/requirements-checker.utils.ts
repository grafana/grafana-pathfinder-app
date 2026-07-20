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

import { reftargetExistsCheck, navmenuOpenCheck, formValidCheck } from '../lib/dom';
import { sectionCompletedCheck } from './checks/section-completed-check';
import { isValidRequirement, type CheckResultError } from '../types/requirements.types';
import { INTERACTIVE_CONFIG } from '../constants/interactive-config';
import { logger } from '../lib/logging';
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
import { codaExitZeroCheck } from './checks/coda';

export type { CheckResultError };

export interface RequirementsCheckResult {
  requirements: string;
  pass: boolean;
  error: CheckResultError[];
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

interface CheckHandler {
  /** Stable tag for tracing + parity tests; not used by dispatch (mirrors FixHandler.fixType). */
  id: string;
  match: (check: string) => boolean;
  run: (check: string, ctx: CheckContext) => Promise<CheckResultError>;
}

// Order matters: dispatch takes the first handler whose `match` returns true,
// mirroring the original if/else chain (first-match-wins).
const CHECK_HANDLERS: readonly CheckHandler[] = [
  {
    id: 'exists-reftarget',
    match: (c) => c === 'exists-reftarget',
    run: (_c, ctx) =>
      reftargetExistsCheck(ctx.refTarget ?? '', ctx.targetAction ?? 'button', {
        lazyRender: ctx.lazyRender,
        scrollContainer: ctx.scrollContainer,
      }),
  },
  { id: 'navmenu-open', match: (c) => c === 'navmenu-open', run: () => navmenuOpenCheck() },
  { id: 'has-datasources', match: (c) => c === 'has-datasources', run: (c) => hasDatasourcesCheck(c) },
  { id: 'is-admin', match: (c) => c === 'is-admin', run: (c) => isAdminCheck(c) },
  { id: 'is-logged-in', match: (c) => c === 'is-logged-in', run: (c) => isLoggedInCheck(c) },
  { id: 'is-editor', match: (c) => c === 'is-editor', run: (c) => isEditorCheck(c) },
  { id: 'has-permission:', match: (c) => c.startsWith('has-permission:'), run: (c) => hasPermissionCheck(c) },
  { id: 'has-role:', match: (c) => c.startsWith('has-role:'), run: (c) => hasRoleCheck(c) },
  { id: 'has-datasource:', match: (c) => c.startsWith('has-datasource:'), run: (c) => hasDataSourceCheck(c) },
  {
    id: 'datasource-configured:',
    match: (c) => c.startsWith('datasource-configured:'),
    run: (c) => datasourceConfiguredCheck(c),
  },
  { id: 'has-plugin:', match: (c) => c.startsWith('has-plugin:'), run: (c) => hasPluginCheck(c) },
  { id: 'plugin-enabled:', match: (c) => c.startsWith('plugin-enabled:'), run: (c) => pluginEnabledCheck(c) },
  {
    id: 'has-dashboard-named:',
    match: (c) => c.startsWith('has-dashboard-named:'),
    run: (c) => hasDashboardNamedCheck(c),
  },
  { id: 'dashboard-exists', match: (c) => c === 'dashboard-exists', run: (c) => dashboardExistsCheck(c) },
  { id: 'on-page:', match: (c) => c.startsWith('on-page:'), run: (c) => onPageCheck(c) },
  { id: 'has-feature:', match: (c) => c.startsWith('has-feature:'), run: (c) => hasFeatureCheck(c) },
  { id: 'in-environment:', match: (c) => c.startsWith('in-environment:'), run: (c) => inEnvironmentCheck(c) },
  { id: 'min-version:', match: (c) => c.startsWith('min-version:'), run: (c) => minVersionCheck(c) },
  { id: 'section-completed:', match: (c) => c.startsWith('section-completed:'), run: (c) => sectionCompletedCheck(c) },
  { id: 'form-valid', match: (c) => c === 'form-valid', run: (c) => formValidCheck(c) },
  { id: 'is-terminal-active', match: (c) => c === 'is-terminal-active', run: (c) => terminalActiveCheck(c) },
  { id: 'coda-exit-zero:', match: (c) => c.startsWith('coda-exit-zero:'), run: (c) => codaExitZeroCheck(c) },
  { id: 'var-', match: (c) => c.startsWith('var-'), run: (c) => guideVariableCheck(c) },
  { id: 'renderer:', match: (c) => c.startsWith('renderer:'), run: (c) => rendererCheck(c) },
];

export { CHECK_HANDLERS };

async function routeUnifiedCheck(check: string, ctx: CheckContext): Promise<CheckResultError> {
  // Type-safe validation with helpful developer feedback
  if (!isValidRequirement(check)) {
    logger.warn(
      `Unknown requirement type: '${check}'. Check the requirement syntax and ensure it's supported. Allowing step to proceed.`
    );

    return {
      requirement: check,
      pass: true,
      error: `Warning: Unknown requirement type '${check}' - step allowed to proceed`,
      context: null,
    };
  }

  const handler = CHECK_HANDLERS.find((h) => h.match(check));
  if (handler) {
    return handler.run(check, ctx);
  }

  // Should never be reached due to the validation above, but keep as a fallback.
  logger.error(
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
      requirements,
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
      requirements,
      pass: false,
      error: [
        {
          requirement: requirements,
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

    logger.error(errorMessage.join('\n'));

    return false;
  }

  return true;
}
