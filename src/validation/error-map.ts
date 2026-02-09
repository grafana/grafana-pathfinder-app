/**
 * Custom Zod Error Map for Better Validation Messages
 *
 * Intercepts Zod errors during parsing to provide more helpful messages,
 * especially for discriminated union errors which default to "Invalid input".
 */

import { z } from 'zod';

/**
 * Recursively collect all errors from union branches, then find the best one.
 * Prefers enum/value errors as they're most actionable.
 */
function findActionableError(errors: z.ZodIssue[][]): z.ZodIssue | null {
  const allErrors: z.ZodIssue[] = [];

  function collect(errorBranches: z.ZodIssue[][]): void {
    for (const branchErrors of errorBranches) {
      for (const issue of branchErrors) {
        allErrors.push(issue);
        // Recurse into nested unions
        if (issue.code === 'invalid_union' && 'errors' in issue) {
          collect((issue as any).errors);
        }
      }
    }
  }

  collect(errors);

  // Prefer enum/value errors on non-discriminator fields (most actionable)
  // Skip 'type' field errors as they're just discriminator mismatches
  const enumError = allErrors.find((issue) => {
    if (issue.code !== 'invalid_value') {
      return false;
    }

    const path = issue.path || [];
    const fieldName = path.length > 0 ? String(path[path.length - 1]) : '';
    return fieldName !== 'type'; // Skip discriminator field
  });

  if (enumError) {
    return enumError;
  }

  // Fallback: first non-generic error (including type errors if nothing else found)
  return (
    allErrors.find((issue) => {
      const code = (issue as any).code;
      return code !== 'invalid_type' && code !== 'invalid_literal' && code !== 'invalid_union';
    }) || null
  );
}

/**
 * Format an error with expected values shown clearly.
 */
function formatError(issue: z.ZodIssue): string {
  const path = issue.path || [];
  const fieldName = path.length > 0 ? String(path[path.length - 1]) : 'value';

  // Extract expected values from various Zod error formats
  const values = (issue as any).values || (issue as any).options;

  if (Array.isArray(values) && values.length > 0) {
    return `Invalid '${fieldName}' field. Expected one of: ${values.join(', ')}`;
  }

  return issue.message || `Invalid '${fieldName}' field`;
}

/**
 * Custom error map for Zod validation.
 * Replaces generic "Invalid input" messages with specific field errors.
 */
export const customErrorMap = (issue: z.ZodIssue): { message: string } | undefined => {
  // Only handle union errors - everything else gets default messages
  if (issue.code === 'invalid_union' && 'errors' in issue) {
    const actionableError = findActionableError((issue as any).errors);
    if (actionableError) {
      return { message: formatError(actionableError) };
    }
  }

  // Use Zod's default error messages for everything else
  return undefined;
};
