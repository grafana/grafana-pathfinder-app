/**
 * Guide-response variable checks: `var-<name>:<value>`.
 *
 * Stored responses live in `guideResponseStorage` (cross-device synced) and are
 * scoped to the guide identity owned by `global-state/guide-identity`, so one
 * guide's answers cannot satisfy another guide's requirements.
 * Supports wildcard `*`, boolean `true`/`false`, and exact string match.
 */

import { getCurrentGuideId } from '../../global-state/guide-identity';
import { guideResponseStorage } from '../../lib/user-storage';
import type { CheckResultError } from '../../types/requirements.types';

export async function guideVariableCheck(check: string): Promise<CheckResultError> {
  try {
    // Parse the requirement format: var-{variableName}:{expectedValue}
    const match = check.match(/^var-([^:]+):(.+)$/);
    if (!match) {
      return {
        requirement: check,
        pass: false,
        error: `Invalid variable requirement format: ${check}. Expected: var-{variableName}:{expectedValue}`,
        context: { format: 'var-{variableName}:{expectedValue}' },
      };
    }

    const variableName = match[1]!;
    const expectedValue = match[2]!;

    const guideId = getCurrentGuideId();
    const actualValue = await guideResponseStorage.getResponse(guideId, variableName);

    // Check for wildcard (any non-empty value)
    if (expectedValue === '*') {
      const hasValue = actualValue !== undefined && actualValue !== '' && actualValue !== null;
      return {
        requirement: check,
        pass: hasValue,
        error: hasValue ? undefined : `Variable '${variableName}' has no value set`,
        context: { variableName, expectedValue, actualValue, guideId },
      };
    }

    // Check for boolean values
    if (expectedValue === 'true') {
      const isTrue = actualValue === true || actualValue === 'true';
      return {
        requirement: check,
        pass: isTrue,
        error: isTrue ? undefined : `Variable '${variableName}' is not true (got: ${actualValue})`,
        context: { variableName, expectedValue, actualValue, guideId },
      };
    }

    if (expectedValue === 'false') {
      const isFalse = actualValue === false || actualValue === 'false';
      return {
        requirement: check,
        pass: isFalse,
        error: isFalse ? undefined : `Variable '${variableName}' is not false (got: ${actualValue})`,
        context: { variableName, expectedValue, actualValue, guideId },
      };
    }

    // Exact string match
    const matches = String(actualValue) === expectedValue;
    return {
      requirement: check,
      pass: matches,
      error: matches ? undefined : `Variable '${variableName}' does not match '${expectedValue}' (got: ${actualValue})`,
      context: { variableName, expectedValue, actualValue, guideId },
    };
  } catch (error) {
    return {
      requirement: check,
      pass: false,
      error: `Variable check failed: ${error}`,
      context: { error: String(error) },
    };
  }
}
