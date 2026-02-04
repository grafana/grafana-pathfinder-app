/**
 * Pre-flight Checks for E2E Test Runner
 *
 * Validates environment before running guide tests to fail fast with clear error messages.
 *
 * @see tests/e2e-runner/design/e2e-test-runner-design.md#pre-flight-checks
 */

import type { Page } from '@playwright/test';

/**
 * Exit codes per design spec
 */
export const ExitCode = {
  SUCCESS: 0,
  TEST_FAILURE: 1,
  CONFIGURATION_ERROR: 2,
  GRAFANA_UNREACHABLE: 3,
  AUTH_FAILURE: 4,
} as const;

/**
 * Names of pre-flight checks
 */
export type PreFlightCheckName = 'grafana-reachable' | 'auth-valid' | 'plugin-installed';

/**
 * Result of a single pre-flight check
 */
export interface PreFlightCheck {
  name: PreFlightCheckName;
  passed: boolean;
  error?: string;
  durationMs?: number;
}

/**
 * Overall result of pre-flight checks
 */
export interface PreFlightResult {
  success: boolean;
  checks: PreFlightCheck[];
  abortReason?: string;
  totalDurationMs: number;
}

/**
 * Grafana health response shape
 */
interface GrafanaHealthResponse {
  database?: string;
  version?: string;
}

/**
 * Check if Grafana is reachable and healthy.
 *
 * This is a public endpoint that doesn't require authentication,
 * so it can be called from the CLI before spawning Playwright.
 */
export async function checkGrafanaHealth(grafanaUrl: string): Promise<PreFlightCheck> {
  const startTime = Date.now();
  const name: PreFlightCheckName = 'grafana-reachable';

  try {
    const healthUrl = new URL('/api/health', grafanaUrl).toString();
    const response = await fetch(healthUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      // Short timeout for health check
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return {
        name,
        passed: false,
        error: `Grafana health check failed: HTTP ${response.status} ${response.statusText}`,
        durationMs: Date.now() - startTime,
      };
    }

    const data = (await response.json()) as GrafanaHealthResponse;

    // Verify database is healthy
    if (data.database !== 'ok') {
      return {
        name,
        passed: false,
        error: `Grafana database not healthy: ${data.database ?? 'unknown'}`,
        durationMs: Date.now() - startTime,
      };
    }

    return {
      name,
      passed: true,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.name === 'TimeoutError'
          ? `Connection timeout after 10s`
          : error.message
        : 'Unknown error';

    return {
      name,
      passed: false,
      error: `Grafana not reachable at ${grafanaUrl}: ${errorMessage}`,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Check if authentication is valid (requires Playwright page).
 *
 * This navigates to a protected page and verifies the user is not redirected to login.
 * Should be called after Playwright auth setup (e.g., via admin.json state).
 */
export async function checkAuthValid(page: Page, grafanaUrl: string): Promise<PreFlightCheck> {
  const startTime = Date.now();
  const name: PreFlightCheckName = 'auth-valid';

  try {
    // Navigate to a protected page
    const dashboardsUrl = new URL('/dashboards', grafanaUrl).toString();
    await page.goto(dashboardsUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Check if we were redirected to login
    const currentUrl = page.url();
    const isLoginPage = currentUrl.includes('/login');

    if (isLoginPage) {
      return {
        name,
        passed: false,
        error: 'Authentication failed - redirected to login page',
        durationMs: Date.now() - startTime,
      };
    }

    // Additional check: verify we can access protected API
    const userResponse = await page.request.get(`${grafanaUrl}/api/user`);
    if (!userResponse.ok()) {
      return {
        name,
        passed: false,
        error: `Authentication check failed: /api/user returned ${userResponse.status()}`,
        durationMs: Date.now() - startTime,
      };
    }

    return {
      name,
      passed: true,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      name,
      passed: false,
      error: `Auth validation failed: ${errorMessage}`,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Check if the Pathfinder plugin is installed and enabled.
 *
 * Requires authentication, so must be called from Playwright context.
 */
export async function checkPluginInstalled(page: Page, grafanaUrl: string): Promise<PreFlightCheck> {
  const startTime = Date.now();
  const name: PreFlightCheckName = 'plugin-installed';
  const pluginId = 'grafana-pathfinder-app';

  try {
    const pluginUrl = `${grafanaUrl}/api/plugins/${pluginId}/settings`;
    const response = await page.request.get(pluginUrl);

    if (!response.ok()) {
      if (response.status() === 404) {
        return {
          name,
          passed: false,
          error: `Pathfinder plugin (${pluginId}) is not installed`,
          durationMs: Date.now() - startTime,
        };
      }
      return {
        name,
        passed: false,
        error: `Plugin check failed: HTTP ${response.status()}`,
        durationMs: Date.now() - startTime,
      };
    }

    // Optionally check if plugin is enabled
    const data = (await response.json()) as { enabled?: boolean };
    if (data.enabled === false) {
      return {
        name,
        passed: false,
        error: `Pathfinder plugin is installed but not enabled`,
        durationMs: Date.now() - startTime,
      };
    }

    return {
      name,
      passed: true,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      name,
      passed: false,
      error: `Plugin check failed: ${errorMessage}`,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Run all pre-flight checks that require a Playwright page.
 *
 * This includes auth validation and plugin installation checks.
 * Should be called at the start of the guide runner test.
 *
 * @param page - Playwright page (authenticated)
 * @param grafanaUrl - Base Grafana URL
 * @returns Pre-flight result with all check statuses
 */
export async function runPlaywrightPreflightChecks(
  page: Page,
  grafanaUrl: string
): Promise<PreFlightResult> {
  const startTime = Date.now();
  const checks: PreFlightCheck[] = [];

  // 1. Check auth validity
  const authCheck = await checkAuthValid(page, grafanaUrl);
  checks.push(authCheck);

  // If auth fails, abort - no point checking plugin
  if (!authCheck.passed) {
    return {
      success: false,
      checks,
      abortReason: authCheck.error,
      totalDurationMs: Date.now() - startTime,
    };
  }

  // 2. Check plugin installed
  const pluginCheck = await checkPluginInstalled(page, grafanaUrl);
  checks.push(pluginCheck);

  if (!pluginCheck.passed) {
    return {
      success: false,
      checks,
      abortReason: pluginCheck.error,
      totalDurationMs: Date.now() - startTime,
    };
  }

  return {
    success: true,
    checks,
    totalDurationMs: Date.now() - startTime,
  };
}

/**
 * Format pre-flight results for console output.
 */
export function formatPreflightResults(result: PreFlightResult, verbose: boolean = false): string {
  const lines: string[] = [];

  if (verbose) {
    lines.push('Pre-flight checks:');
    for (const check of result.checks) {
      const status = check.passed ? '✓' : '✗';
      const duration = check.durationMs ? ` [${check.durationMs}ms]` : '';
      lines.push(`  ${status} ${check.name}${duration}`);
      if (!check.passed && check.error) {
        lines.push(`    Error: ${check.error}`);
      }
    }
    lines.push(`  Total: ${result.totalDurationMs}ms`);
  } else if (!result.success) {
    // Non-verbose: only show failures
    for (const check of result.checks) {
      if (!check.passed && check.error) {
        lines.push(`Pre-flight failed: ${check.error}`);
      }
    }
  }

  return lines.join('\n');
}
