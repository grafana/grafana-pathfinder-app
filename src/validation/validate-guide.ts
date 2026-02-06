/**
 * Guide Validation Module
 */
import { z } from 'zod';
import type { JsonGuide } from '../types/json-guide.types';
import { JsonGuideSchema } from '../types/json-guide.schema';
import {
  formatPath,
  formatZodErrors,
  formatErrorsAsStrings,
  formatWarningsAsStrings,
  type ValidationError,
  type ValidationWarning,
} from './errors';
import { detectUnknownFields } from './unknown-fields';
import { validateBlockConditions, type ConditionIssue } from './condition-validator';
import { customErrorMap } from './error-map';

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  guide: JsonGuide | null;
}

export interface LegacyValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  guide: JsonGuide | null;
}

export interface ValidationOptions {
  strict?: boolean;
  skipUnknownFieldCheck?: boolean;
}

/**
 * Convert a condition issue to a validation warning.
 */
function conditionIssueToWarning(issue: ConditionIssue): ValidationWarning {
  return {
    message: `${formatPath(issue.path)}: ${issue.message}`,
    path: issue.path,
    type: 'invalid-condition',
  };
}

export function validateGuide(data: unknown, options: ValidationOptions = {}): ValidationResult {
  // 1. Zod parse - validates structure, types, nesting depth and use a custom error map for better messages
  const previousErrorMap = z.getErrorMap?.();
  z.setErrorMap(customErrorMap as any); // Type assertion needed for Zod v4 compatibility

  const result = JsonGuideSchema.safeParse(data);

  if (previousErrorMap) {
    z.setErrorMap(previousErrorMap);
  }

  if (!result.success) {
    return { isValid: false, errors: formatZodErrors(result.error.issues), warnings: [], guide: null };
  }

  // 2. Unknown fields check (existing) - single traversal
  const warnings: ValidationWarning[] = options.skipUnknownFieldCheck ? [] : detectUnknownFields(data);

  // 3. Condition validation (NEW) - only runs after Zod validates structure
  const conditionIssues = validateBlockConditions(result.data as JsonGuide);
  warnings.push(...conditionIssues.map(conditionIssueToWarning));

  // 4. Additional suggestions
  if (result.data.blocks.length === 0) {
    warnings.push({ message: 'Guide has no blocks', path: ['blocks'], type: 'suggestion' });
  }

  // 5. Strict mode - promote all warnings to errors
  if (options.strict && warnings.length > 0) {
    return {
      isValid: false,
      errors: warnings.map((w) => ({ message: w.message, path: w.path, code: 'strict' })),
      warnings: [],
      guide: null,
    };
  }
  return { isValid: true, errors: [], warnings, guide: result.data as JsonGuide };
}

export function validateGuideFromString(jsonString: string, options: ValidationOptions = {}): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    return {
      isValid: false,
      errors: [{ message: 'The file does not contain valid JSON', path: [], code: 'invalid_json' }],
      warnings: [],
      guide: null,
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      isValid: false,
      errors: [{ message: 'JSON must be an object with id, title, and blocks', path: [], code: 'invalid_type' }],
      warnings: [],
      guide: null,
    };
  }
  return validateGuide(parsed, options);
}

export function toLegacyResult(result: ValidationResult): LegacyValidationResult {
  return {
    isValid: result.isValid,
    errors: formatErrorsAsStrings(result.errors),
    warnings: formatWarningsAsStrings(result.warnings),
    guide: result.guide,
  };
}
