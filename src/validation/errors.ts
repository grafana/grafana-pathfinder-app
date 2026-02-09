/**
 * Error formatting utilities for Zod validation errors
 *
 * Simple formatter that adds path context to Zod error messages.
 * Complex error message improvements are handled by the custom error map.
 */

import { z } from 'zod';

export interface ValidationError {
  message: string;
  path: Array<string | number>;
  code: string;
}

export interface ValidationWarning {
  message: string;
  path: Array<string | number>;
  type: 'unknown-field' | 'deprecation' | 'suggestion' | 'invalid-condition';
}

export function formatPath(path: Array<string | number>): string {
  if (path.length === 0) {
    return 'root';
  }
  return path
    .map((p) => (typeof p === 'number' ? `[${p}]` : `.${p}`))
    .join('')
    .replace(/^\./, '');
}

export function formatZodErrors(issues: z.core.$ZodIssue[]): ValidationError[] {
  return issues.map((issue) => {
    // Zod paths are PropertyKey[] but for JSON data they are always string | number
    const path = issue.path as Array<string | number>;
    const errorMessage = issue.message;

    return {
      message: path.length > 0 ? `${formatPath(path)}: ${errorMessage}` : errorMessage,
      path,
      code: issue.code,
    };
  });
}

export function formatErrorsAsStrings(errors: ValidationError[]): string[] {
  return errors.map((e) => e.message);
}

export function formatWarningsAsStrings(warnings: ValidationWarning[]): string[] {
  return warnings.map((w) => w.message);
}
