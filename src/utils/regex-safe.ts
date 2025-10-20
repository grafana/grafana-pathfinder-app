/**
 * Safe Regular Expression Utilities
 *
 * Protects against ReDoS (Regular Expression Denial of Service) attacks
 * by limiting input size before regex matching.
 *
 * Note: JavaScript doesn't support true regex timeouts. Protection comes from:
 * 1. Input length validation before matching
 * 2. Using safe regex patterns (no nested quantifiers)
 * 3. Failing fast on oversized inputs
 *
 * @module regex-safe
 */

/**
 * Execute regex matching with input size protection
 *
 * Prevents ReDoS attacks by rejecting inputs that are too large before
 * attempting regex matching. This is the primary defense since JavaScript
 * doesn't support regex execution timeouts.
 *
 * @param input - String to match against
 * @param pattern - Regular expression pattern
 * @param maxLength - Maximum allowed input length (default: 10000)
 * @returns Match result or null if input too large or matching fails
 *
 * @example
 * ```typescript
 * // Safe matching with length protection
 * const result = safeRegexMatch(userInput, /^(.*?)(operator)(.*)$/, 1000);
 * if (result) {
 *   const [, before, op, after] = result;
 * }
 * ```
 */
export function safeRegexMatch(input: string, pattern: RegExp, maxLength = 10000): RegExpMatchArray | null {
  // SECURITY: Quick length check to prevent ReDoS
  if (input.length > maxLength) {
    console.warn('[SECURITY] Input too long for regex matching:', input.length, 'chars (max:', maxLength, ')');
    return null;
  }

  try {
    // Execute regex - length check above prevents catastrophic backtracking
    const result = input.match(pattern);
    return result;
  } catch (error) {
    console.error('[SECURITY] Regex execution failed:', error);
    return null;
  }
}

/**
 * Test if a string matches a pattern safely
 *
 * @param input - String to test
 * @param pattern - Regular expression pattern
 * @param maxLength - Maximum allowed input length (default: 10000)
 * @returns true if matches, false otherwise
 */
export function safeRegexTest(input: string, pattern: RegExp, maxLength = 10000): boolean {
  // SECURITY: Quick length check to prevent ReDoS
  if (input.length > maxLength) {
    console.warn('[SECURITY] Input too long for regex test:', input.length, 'chars (max:', maxLength, ')');
    return false;
  }

  try {
    return pattern.test(input);
  } catch (error) {
    console.error('[SECURITY] Regex test failed:', error);
    return false;
  }
}

/**
 * Validate that a regex pattern is safe (no nested quantifiers)
 *
 * Detects potentially vulnerable patterns like:
 * - (a+)+ - nested quantifiers
 * - (a*)* - nested quantifiers
 * - (a|ab)* - alternation with overlap
 *
 * @param pattern - Regex pattern to validate
 * @returns Object with isSafe flag and warning message if unsafe
 */
export function validateRegexPattern(pattern: RegExp): { isSafe: boolean; warning?: string } {
  const patternStr = pattern.source;

  // Check for nested quantifiers - basic detection
  if (/\([^)]*[*+][^)]*\)[*+]/.test(patternStr)) {
    return {
      isSafe: false,
      warning: 'Pattern contains nested quantifiers (potential ReDoS vulnerability)',
    };
  }

  // Check for alternation with overlap followed by quantifier
  if (/\([^)]*\|[^)]*\)[*+]/.test(patternStr)) {
    return {
      isSafe: false,
      warning: 'Pattern contains alternation with quantifier (potential ReDoS vulnerability)',
    };
  }

  return { isSafe: true };
}
