/**
 * Error formatting utilities for Zod validation errors
 *
 * Minimal formatter using Zod's raw error messages.
 */

import type { ZodIssue } from 'zod';

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

export function formatZodErrors(issues: ZodIssue[]): ValidationError[] {
  return issues.map((issue) => {
    // Zod paths are PropertyKey[] but for JSON data they are always string | number
    const path = issue.path as Array<string | number>;
    return {
      message: path.length > 0 ? `${formatPath(path)}: ${issue.message}` : issue.message,
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
