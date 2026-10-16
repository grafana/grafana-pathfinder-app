/**
 * Form value matching for observed formfill actions and form validation.
 *
 * @module action-matcher
 */

import { logger } from '../../lib/logging';

// ============ REGEX PATTERN MATCHING ============

/**
 * Check if a value string represents a regex pattern.
 *
 * Detects regex patterns by:
 * - Enclosed in forward slashes: /pattern/ or /pattern/flags
 * - Starts with ^ (anchor at start)
 * - Ends with $ (anchor at end)
 *
 * @param value - The value string to check
 * @returns true if value appears to be a regex pattern
 *
 * @example
 * ```typescript
 * isRegexPattern('/https?:\\/\\//') // true - slash-delimited
 * isRegexPattern('^https://') // true - starts with anchor
 * isRegexPattern('example.com$') // true - ends with anchor
 * isRegexPattern('exact-value') // false - plain string
 * ```
 */
export function isRegexPattern(value: string): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }

  // Pattern 1: Enclosed in forward slashes /pattern/ or /pattern/flags
  // SECURITY: Safe regex - simple character match with no nested quantifiers
  if (value.startsWith('/')) {
    const lastSlashIndex = value.lastIndexOf('/');
    // Must have closing slash after opening slash (not at index 0)
    if (lastSlashIndex > 0) {
      return true;
    }
  }

  // Pattern 2: Starts with ^ (regex start anchor)
  if (value.startsWith('^')) {
    return true;
  }

  // Pattern 3: Ends with $ (regex end anchor)
  if (value.endsWith('$')) {
    return true;
  }

  return false;
}

/**
 * Parse a regex pattern string into a RegExp object.
 *
 * Handles both:
 * - Slash-delimited patterns: /pattern/flags
 * - Bare anchor patterns: ^pattern or pattern$
 *
 * @param pattern - The regex pattern string
 * @returns Compiled RegExp, or null if invalid
 *
 * @example
 * ```typescript
 * parseRegexPattern('/^https?:\\/\\//i') // RegExp with case-insensitive flag
 * parseRegexPattern('^grafana') // RegExp matching start
 * ```
 */
export function parseRegexPattern(pattern: string): RegExp | null {
  if (!pattern) {
    return null;
  }

  try {
    // Slash-delimited pattern: /pattern/flags
    if (pattern.startsWith('/')) {
      const lastSlashIndex = pattern.lastIndexOf('/');
      if (lastSlashIndex > 0) {
        const regexBody = pattern.substring(1, lastSlashIndex);
        const flags = pattern.substring(lastSlashIndex + 1);
        return new RegExp(regexBody, flags);
      }
    }

    // Bare anchor pattern: treat entire string as regex
    return new RegExp(pattern);
  } catch (error) {
    logger.warn('Invalid regex pattern', { pattern, error });
    return null;
  }
}

/**
 * Test if an actual value matches a regex pattern.
 *
 * @param actualValue - The actual value to test
 * @param pattern - The regex pattern string
 * @returns true if actualValue matches the pattern
 *
 * @example
 * ```typescript
 * matchesRegexPattern('https://grafana.com', '^https://') // true
 * matchesRegexPattern('my-dashboard', '/^[a-z-]+$/') // true
 * ```
 */
export function matchesRegexPattern(actualValue: string, pattern: string): boolean {
  if (actualValue === undefined || actualValue === null) {
    return false;
  }

  const regex = parseRegexPattern(pattern);
  if (!regex) {
    return false;
  }

  return regex.test(actualValue);
}

/**
 * Result of form validation matching
 */
export interface FormfillMatchResult {
  /** Whether the value matches */
  isMatch: boolean;
  /** Whether regex was used for matching */
  usedRegex: boolean;
  /** The expected pattern (for display) */
  expectedPattern: string;
}

/**
 * Match form value against expected value (supports regex patterns).
 *
 * If expectedValue is a regex pattern (detected by isRegexPattern),
 * uses regex matching. Otherwise uses exact string comparison.
 *
 * @param actualValue - The actual form value
 * @param expectedValue - The expected value (may be regex pattern)
 * @returns Match result with details
 */
export function matchFormValue(
  actualValue: string | undefined,
  expectedValue: string | undefined
): FormfillMatchResult {
  // No expected value means any value is acceptable
  if (expectedValue === undefined || expectedValue === '') {
    return { isMatch: true, usedRegex: false, expectedPattern: '' };
  }

  // No actual value when one is expected
  if (actualValue === undefined || actualValue === null) {
    return { isMatch: false, usedRegex: isRegexPattern(expectedValue), expectedPattern: expectedValue };
  }

  // Check if expected value is a regex pattern
  if (isRegexPattern(expectedValue)) {
    const isMatch = matchesRegexPattern(actualValue, expectedValue);
    return { isMatch, usedRegex: true, expectedPattern: expectedValue };
  }

  // Exact string matching (backward compatible)
  return {
    isMatch: actualValue === expectedValue,
    usedRegex: false,
    expectedPattern: expectedValue,
  };
}
