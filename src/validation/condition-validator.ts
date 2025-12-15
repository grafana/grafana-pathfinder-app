/**
 * Condition Validator
 *
 * Validates the mini-grammar used in requirements and objectives fields.
 * Both requirements and objectives use the same grammar, so we use the
 * unifying term "condition" to refer to either.
 *
 * This validator runs AFTER Zod schema validation to ensure:
 * - Structure is already validated (nesting depth bounded)
 * - Only valid conditions reach runtime
 * - Typos and malformed conditions are caught at build time
 *
 * @coupling Uses types from src/types/requirements.types.ts
 */

import { FixedRequirementType, ParameterizedRequirementPrefix } from '../types/requirements.types';
import type { JsonGuide, JsonBlock, JsonStep } from '../types/json-guide.types';

// Maximum number of comma-separated components in a single condition string
const MAX_CONDITION_COMPONENTS = 10;

// Semver regex pattern (simplified: major.minor.patch)
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * Issue found during condition validation.
 */
export interface ConditionIssue {
  /** The condition string that caused the issue */
  condition: string;
  /** Human-readable error message */
  message: string;
  /** Machine-readable error code for categorization */
  code: 'unknown_type' | 'missing_argument' | 'unexpected_argument' | 'invalid_format' | 'too_many_components';
  /** JSON path to the condition (e.g., ['blocks', 2, 'requirements', 0]) */
  path: Array<string | number>;
}

/**
 * Get all fixed requirement type values as a Set for fast lookup.
 */
const FIXED_TYPES = new Set(Object.values(FixedRequirementType));

/**
 * Get all parameterized prefixes as an array.
 */
const PARAMETERIZED_PREFIXES = Object.values(ParameterizedRequirementPrefix);

/**
 * Validate a single condition component (one item, not comma-separated).
 */
function validateSingleCondition(condition: string, path: Array<string | number>): ConditionIssue | null {
  const trimmed = condition.trim();

  if (!trimmed) {
    return null; // Empty strings are ignored (filtered out by caller)
  }

  // Check if it's a valid fixed requirement type
  if (FIXED_TYPES.has(trimmed as FixedRequirementType)) {
    return null; // Valid fixed type
  }

  // Check if fixed type has unexpected argument (e.g., "is-admin:true")
  for (const fixedType of FIXED_TYPES) {
    if (trimmed.startsWith(fixedType + ':')) {
      return {
        condition: trimmed,
        message: `'${fixedType}' does not take an argument`,
        code: 'unexpected_argument',
        path,
      };
    }
  }

  // Check if it's a valid parameterized requirement
  for (const prefix of PARAMETERIZED_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      const argument = trimmed.slice(prefix.length);

      // Check for missing argument
      if (!argument || argument.trim() === '') {
        return {
          condition: trimmed,
          message: `'${prefix}' requires an argument`,
          code: 'missing_argument',
          path,
        };
      }

      // Validate argument format for specific prefixes
      const formatIssue = validateArgumentFormat(prefix, argument, trimmed, path);
      if (formatIssue) {
        return formatIssue;
      }

      return null; // Valid parameterized type
    }
  }

  // Unknown condition type
  return {
    condition: trimmed,
    message: `Unknown condition type '${trimmed}'`,
    code: 'unknown_type',
    path,
  };
}

/**
 * Validate argument format for specific parameterized conditions.
 */
function validateArgumentFormat(
  prefix: ParameterizedRequirementPrefix,
  argument: string,
  fullCondition: string,
  path: Array<string | number>
): ConditionIssue | null {
  switch (prefix) {
    case ParameterizedRequirementPrefix.ON_PAGE:
      // Path should start with '/'
      if (!argument.startsWith('/')) {
        return {
          condition: fullCondition,
          message: `Path argument should start with '/'`,
          code: 'invalid_format',
          path,
        };
      }
      break;

    case ParameterizedRequirementPrefix.MIN_VERSION:
      // Should be semver format
      if (!SEMVER_PATTERN.test(argument)) {
        return {
          condition: fullCondition,
          message: `Version should be in semver format (e.g., '11.0.0')`,
          code: 'invalid_format',
          path,
        };
      }
      break;

    case ParameterizedRequirementPrefix.HAS_ROLE:
      // Role should be lowercase
      if (argument !== argument.toLowerCase()) {
        return {
          condition: fullCondition,
          message: `Role should be lowercase`,
          code: 'invalid_format',
          path,
        };
      }
      break;
  }

  return null;
}

/**
 * Validate a comma-separated condition string.
 *
 * @param conditionString - The condition string (may contain multiple comma-separated conditions)
 * @param path - JSON path to this condition string
 * @returns Array of validation issues found
 */
export function validateConditionString(conditionString: string, path: Array<string | number>): ConditionIssue[] {
  const issues: ConditionIssue[] = [];

  // Split by comma and filter empty strings
  const components = conditionString
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

  // Check component count limit
  if (components.length > MAX_CONDITION_COMPONENTS) {
    issues.push({
      condition: conditionString,
      message: `Condition has ${components.length} components, maximum is ${MAX_CONDITION_COMPONENTS}`,
      code: 'too_many_components',
      path,
    });
    // Still validate individual components, but we've noted the limit issue
  }

  // Validate each component (use the same path for all - condition string provides context)
  for (const component of components) {
    const issue = validateSingleCondition(component, path);
    if (issue) {
      issues.push(issue);
    }
  }

  return issues;
}

/**
 * Validate an array of condition strings.
 *
 * @param conditions - Array of condition strings (each may be comma-separated)
 * @param basePath - JSON path to the array (e.g., ['blocks', 2, 'requirements'])
 * @returns Array of all validation issues found
 */
export function validateConditions(
  conditions: string[] | undefined,
  basePath: Array<string | number>
): ConditionIssue[] {
  if (!conditions || conditions.length === 0) {
    return [];
  }

  const allIssues: ConditionIssue[] = [];

  for (let i = 0; i < conditions.length; i++) {
    const issues = validateConditionString(conditions[i], [...basePath, i]);
    allIssues.push(...issues);
  }

  return allIssues;
}

/**
 * Validate all conditions (requirements and objectives) in a guide.
 * This function traverses all blocks and their nested content.
 *
 * @param guide - The parsed guide (must have passed Zod validation first)
 * @returns Array of all condition issues found
 */
export function validateBlockConditions(guide: JsonGuide): ConditionIssue[] {
  const issues: ConditionIssue[] = [];

  function visitStep(step: JsonStep, path: Array<string | number>): void {
    if (step.requirements) {
      issues.push(...validateConditions(step.requirements, [...path, 'requirements']));
    }
  }

  function visitBlock(block: JsonBlock, path: Array<string | number>): void {
    // Check requirements if present
    if ('requirements' in block && block.requirements) {
      issues.push(...validateConditions(block.requirements, [...path, 'requirements']));
    }

    // Check objectives if present
    if ('objectives' in block && block.objectives) {
      issues.push(...validateConditions(block.objectives, [...path, 'objectives']));
    }

    // Check verify field for interactive blocks (uses same grammar)
    if ('verify' in block && block.verify) {
      issues.push(...validateConditionString(block.verify, [...path, 'verify']));
    }

    // Check steps (multistep, guided blocks)
    if ('steps' in block && Array.isArray(block.steps)) {
      block.steps.forEach((step, i) => {
        visitStep(step, [...path, 'steps', i]);
      });
    }

    // Recurse into nested blocks (section, assistant)
    if ('blocks' in block && Array.isArray(block.blocks)) {
      block.blocks.forEach((child, i) => {
        visitBlock(child, [...path, 'blocks', i]);
      });
    }
  }

  // Visit all top-level blocks
  guide.blocks.forEach((block, i) => {
    visitBlock(block, ['blocks', i]);
  });

  return issues;
}
