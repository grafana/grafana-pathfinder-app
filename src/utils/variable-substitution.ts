/**
 * Variable Substitution Utility
 *
 * Replaces {{variableName}} placeholders in content with stored response values.
 * Used for dynamic content that adapts based on user input from input blocks.
 */

import { ResponseValue } from '../lib/guide-responses';

/**
 * Create a fresh variable pattern regex.
 * Using a factory avoids shared state issues with the `g` flag's lastIndex.
 */
function createVariablePattern(): RegExp {
  return /\{\{(\w+)\}\}/g;
}

/**
 * Options for variable substitution
 */
export interface SubstitutionOptions {
  /** Value to use when a variable is not found (default: '[not set]') */
  fallback?: string;
  /** Whether to leave unmatched variables as-is (default: false - replaces with fallback) */
  preserveUnmatched?: boolean;
}

/**
 * Replace {{variableName}} placeholders with stored response values.
 *
 * @param content - The content string containing variable placeholders
 * @param responses - Object mapping variable names to their values
 * @param options - Substitution options
 * @returns The content with variables replaced
 *
 * @example
 * ```ts
 * const content = "Your data source {{datasourceName}} is configured.";
 * const responses = { datasourceName: "prometheus" };
 * const result = substituteVariables(content, responses);
 * // Result: "Your data source prometheus is configured."
 * ```
 */
export function substituteVariables(
  content: string,
  responses: Record<string, ResponseValue>,
  options: SubstitutionOptions = {}
): string {
  const { fallback = '[not set]', preserveUnmatched = false } = options;

  return content.replace(createVariablePattern(), (match, variableName: string) => {
    const value = responses[variableName];

    if (value === undefined || value === null) {
      return preserveUnmatched ? match : fallback;
    }

    // Convert boolean and number to string
    return String(value);
  });
}

/**
 * Check if content contains any variable placeholders.
 *
 * @param content - The content string to check
 * @returns True if content contains {{variableName}} patterns
 */
export function hasVariables(content: string): boolean {
  return createVariablePattern().test(content);
}

/**
 * Extract all variable names from content.
 *
 * @param content - The content string to extract variables from
 * @returns Array of unique variable names found
 *
 * @example
 * ```ts
 * const content = "Hello {{name}}, your {{datasource}} is ready. Hi {{name}}!";
 * const vars = extractVariables(content);
 * // Result: ["name", "datasource"]
 * ```
 */
export function extractVariables(content: string): string[] {
  const variables = new Set<string>();
  let match;

  const pattern = createVariablePattern();
  while ((match = pattern.exec(content)) !== null) {
    variables.add(match[1]);
  }

  return Array.from(variables);
}

/**
 * Check which variables in content are missing from responses.
 *
 * @param content - The content string containing variable placeholders
 * @param responses - Object mapping variable names to their values
 * @returns Array of variable names that are used but not defined
 */
export function findMissingVariables(content: string, responses: Record<string, ResponseValue>): string[] {
  const usedVariables = extractVariables(content);
  return usedVariables.filter((varName) => responses[varName] === undefined || responses[varName] === null);
}

/**
 * Substitute variables in multiple content strings at once.
 *
 * @param contents - Array of content strings
 * @param responses - Object mapping variable names to their values
 * @param options - Substitution options
 * @returns Array of content strings with variables replaced
 */
export function substituteVariablesInMany(
  contents: string[],
  responses: Record<string, ResponseValue>,
  options: SubstitutionOptions = {}
): string[] {
  return contents.map((content) => substituteVariables(content, responses, options));
}
