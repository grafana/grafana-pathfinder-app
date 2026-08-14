/**
 * Guide Test Runner Error Classification
 *
 * Error classification logic for failure triage (L3-5C).
 * Analyzes error messages to categorize failures for routing to the appropriate team.
 *
 * @see docs/developer/E2E_TESTING.md#error-classification
 */

import { AbortReason, ErrorClassification } from './types';
import { INFRASTRUCTURE_ERROR_PATTERNS } from './constants';
import type { E2EErrorCode } from '../../../../src/cli/e2e/schemas/e2e-report.schema';

export function classifyInfrastructureErrorCode(error?: string): E2EErrorCode | undefined {
  if (!error) {
    return undefined;
  }
  if (/target crashed|page.*crashed/i.test(error)) {
    return 'BROWSER_CRASHED';
  }
  if (/browser.*disconnected/i.test(error)) {
    return 'BROWSER_DISCONNECTED';
  }
  if (/context.*closed|context.*destroyed/i.test(error)) {
    return 'CONTEXT_CLOSED';
  }
  if (/target.*closed|page.*closed|browser.*closed/i.test(error)) {
    return 'PAGE_CLOSED';
  }
  return undefined;
}

/**
 * Classify an error for failure triage (L3-5C).
 *
 * Per design doc MVP approach:
 * - High-confidence network, authentication, and browser failures → `infrastructure`
 * - Everything else → `unknown` (requires human triage)
 *
 * This function analyzes error messages to determine classification.
 * Only high-confidence infrastructure patterns are auto-classified.
 * All ambiguous cases default to `unknown` to avoid misrouting.
 *
 * @param error - Error message to classify
 * @param abortReason - Optional abort reason (AUTH_EXPIRED is always infrastructure)
 * @returns ErrorClassification
 *
 * @example
 * ```typescript
 * classifyError('Timeout waiting for step completion')  // → 'unknown'
 * classifyError('net::ERR_CONNECTION_REFUSED')          // → 'infrastructure'
 * classifyError('Element not found')                    // → 'unknown'
 * classifyError(undefined, 'AUTH_EXPIRED')              // → 'infrastructure'
 * ```
 */
export function classifyError(error?: string, abortReason?: AbortReason): ErrorClassification {
  // AUTH_EXPIRED abort is always infrastructure
  if (abortReason === 'AUTH_EXPIRED') {
    return 'infrastructure';
  }

  // No error message means we can't classify
  if (!error) {
    return 'unknown';
  }

  // Check if error matches any infrastructure patterns
  const isInfrastructure = INFRASTRUCTURE_ERROR_PATTERNS.some((pattern) => pattern.test(error));

  if (isInfrastructure) {
    return 'infrastructure';
  }

  // Default to unknown for all other errors
  // Per design doc: "default to `unknown` and require human triage"
  return 'unknown';
}
