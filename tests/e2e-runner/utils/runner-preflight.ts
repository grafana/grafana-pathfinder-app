import type { Page } from '@playwright/test';

import { createScopedBearerTokenAuthStrategy, scopedBearerHeaders } from '../auth/scoped-bearer-token';
import { printPreflightChecks } from './console-reporter';
import { formatPreflightResults, runPlaywrightPreflightChecks } from './preflight';
import {
  createAuthContext,
  getDefaultAuthStrategy,
  type AuthFailureKind,
  type SessionValidationResult,
} from '../auth/grafana-auth';

export class RunnerPreflightError extends Error {
  constructor(
    message: string,
    readonly failureKind: AuthFailureKind
  ) {
    super(message);
    this.name = 'RunnerPreflightError';
  }
}

export async function runRunnerPreflight(
  page: Page,
  targetUrl: string,
  bearerToken: string | undefined,
  verbose: boolean
): Promise<void> {
  const result = await runPlaywrightPreflightChecks(page, targetUrl, {
    authStrategy: bearerToken ? createScopedBearerTokenAuthStrategy(bearerToken, targetUrl) : undefined,
    requestHeaders: bearerToken ? scopedBearerHeaders(targetUrl, targetUrl, bearerToken) : undefined,
  });
  printPreflightChecks(result.checks);
  if (verbose) {
    const formatted = formatPreflightResults(result, true);
    if (formatted) {
      console.log(formatted);
    }
  }
  if (result.success) {
    return;
  }

  const failedCheck = result.checks.find((check) => !check.passed);
  const checkName = failedCheck?.name;
  const prefix =
    checkName === 'auth-valid'
      ? 'Pre-flight auth check failed'
      : checkName === 'plugin-installed'
        ? 'Pre-flight plugin check failed'
        : 'Pre-flight check failed';
  throw new RunnerPreflightError(
    `${prefix}: ${result.abortReason}`,
    failedCheck?.failureKind ?? 'infrastructure_error'
  );
}

export function createRunnerSessionValidator(
  targetUrl: string,
  bearerToken: string | undefined
): (page: Page) => Promise<SessionValidationResult> {
  const strategy = bearerToken ? createScopedBearerTokenAuthStrategy(bearerToken, targetUrl) : getDefaultAuthStrategy();
  const context = createAuthContext(targetUrl, strategy);
  return (page) => context.validateSession(page);
}
