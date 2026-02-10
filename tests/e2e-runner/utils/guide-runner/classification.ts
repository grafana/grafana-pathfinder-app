/**
 * Guide Test Runner Error Classification
 *
 * Error classification logic for failure triage (L3-5C).
 * Analyzes error messages to categorize failures for routing to the appropriate team.
 *
 * @see docs/design/e2e-test-runner-design.md#error-classification
 */

import { AbortReason, ErrorClassification } from './types';
import { INFRASTRUCTURE_ERROR_PATTERNS } from './constants';

/**
 * Classify an error for failure triage (L3-5C).
 *
 * Per design doc MVP approach:
 * - TIMEOUT, NETWORK_ERROR, AUTH_EXPIRED → `infrastructure`
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
 * classifyError('Timeout waiting for step completion')  // → 'infrastructure'
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
