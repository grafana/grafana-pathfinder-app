/**
 * Validation Module
 *
 * Single source of truth for JSON guide validation using Zod schemas.
 *
 * @example
 * ```ts
 * import { validateGuide, validateGuideFromString } from '../validation';
 *
 * // Validate parsed JSON
 * const result = validateGuide(parsedData);
 *
 * // Validate JSON string
 * const result = validateGuideFromString(jsonString);
 *
 * // Strict mode (warnings become errors)
 * const result = validateGuide(data, { strict: true });
 * ```
 */

export {
  validateGuide,
  validateGuideFromString,
  toLegacyResult,
  type ValidationResult,
  type LegacyValidationResult,
  type ValidationOptions,
} from './validate-guide';

export { formatPath, formatZodErrors, formatErrorsAsStrings, formatWarningsAsStrings } from './errors';

export type { ValidationError, ValidationWarning } from './errors';

export { detectUnknownFields } from './unknown-fields';

export {
  validateConditionString,
  validateConditions,
  validateBlockConditions,
  type ConditionIssue,
} from './condition-validator';

export {
  validatePackage,
  validatePackageTree,
  type PackageValidationResult,
  type PackageValidationMessage,
  type PackageValidationOptions,
  type MessageSeverity,
} from './validate-package';

export { readJsonFile, type JsonReadResult, type JsonReadSuccess, type JsonReadFailure } from './package-io';
