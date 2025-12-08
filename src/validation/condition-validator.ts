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

import {
  FixedRequirementType,
  ParameterizedRequirementPrefix,
} from '../types/requirements.types';
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
  /** Optional suggestion for fixing the issue */
  suggestion?: string;
  /** JSON path to the condition (e.g., ['blocks', 2, 'requirements', 0]) */
  path: Array<string | number>;
}

/**
 * Result of validating a condition string or array.
 */
export interface ConditionValidationResult {
  /** Hard errors that should always fail validation */
  errors: ConditionIssue[];
  /** Soft warnings (become errors in strict mode) */
  warnings: ConditionIssue[];
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
 * Get parameterized prefixes without the trailing colon, for helpful suggestions.
 */
const PARAMETERIZED_PREFIXES_WITHOUT_COLON = PARAMETERIZED_PREFIXES.map((p) => p.slice(0, -1));

/**
 * Validate a single condition component (one item, not comma-separated).
 */
function validateSingleCondition(
  condition: string,
  path: Array<string | number>
): ConditionIssue | null {
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
        suggestion: `Use '${fixedType}' without arguments`,
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
          suggestion: `Add an argument after '${prefix}' (e.g., '${prefix}value')`,
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

  // Check if it matches a parameterized prefix without the colon (common mistake)
  for (const prefixWithoutColon of PARAMETERIZED_PREFIXES_WITHOUT_COLON) {
    if (trimmed === prefixWithoutColon) {
      return {
        condition: trimmed,
        message: `Unknown condition type '${trimmed}'`,
        code: 'unknown_type',
        suggestion: `Did you mean '${prefixWithoutColon}:X'? Parameterized conditions require a colon and argument.`,
        path,
      };
    }
  }

  // Unknown condition type
  return {
    condition: trimmed,
    message: `Unknown condition type '${trimmed}'`,
    code: 'unknown_type',
    suggestion: getUnknownTypeSuggestion(trimmed),
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
          suggestion: `Use 'on-page:/${argument}' instead`,
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
          suggestion: `Use a version like 'min-version:11.0.0'`,
          path,
        };
      }
      break;

    case ParameterizedRequirementPrefix.HAS_ROLE:
      // Role should be lowercase (advisory)
      if (argument !== argument.toLowerCase()) {
        return {
          condition: fullCondition,
          message: `Role should be lowercase`,
          code: 'invalid_format',
          suggestion: `Use 'has-role:${argument.toLowerCase()}' instead`,
          path,
        };
      }
      break;
  }

  return null;
}

/**
 * Get a helpful suggestion for an unknown condition type.
 */
function getUnknownTypeSuggestion(condition: string): string {
  const lower = condition.toLowerCase();

  // Check for common typos
  const typoSuggestions: Record<string, string> = {
    'exist-reftarget': 'exists-reftarget',
    'esists-reftarget': 'exists-reftarget',
    'existsreftarget': 'exists-reftarget',
    'navmenu': 'navmenu-open',
    'nav-open': 'navmenu-open',
    'admin': 'is-admin',
    'logged-in': 'is-logged-in',
    'loggedin': 'is-logged-in',
    editor: 'is-editor',
    datasources: 'has-datasources',
    'dashboard-exist': 'dashboard-exists',
    'dashboardexists': 'dashboard-exists',
    'form-validation': 'form-valid',
    formvalid: 'form-valid',
  };

  if (typoSuggestions[lower]) {
    return `Did you mean '${typoSuggestions[lower]}'?`;
  }

  // List valid fixed types
  const fixedTypesList = Array.from(FIXED_TYPES).slice(0, 4).join("', '");
  return `Valid fixed types include: '${fixedTypesList}', etc.`;
}

/**
 * Validate a comma-separated condition string.
 *
 * @param conditionString - The condition string (may contain multiple comma-separated conditions)
 * @param path - JSON path to this condition string
 * @returns Validation result with errors and warnings
 */
export function validateConditionString(
  conditionString: string,
  path: Array<string | number>
): ConditionValidationResult {
  const warnings: ConditionIssue[] = [];

  // Split by comma and filter empty strings
  const components = conditionString
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

  // Check component count limit
  if (components.length > MAX_CONDITION_COMPONENTS) {
    warnings.push({
      condition: conditionString,
      message: `Condition has ${components.length} components, maximum is ${MAX_CONDITION_COMPONENTS}`,
      code: 'too_many_components',
      suggestion: `Split into multiple steps or simplify the conditions`,
      path,
    });
    // Still validate individual components, but we've noted the limit issue
  }

  // Validate each component
  for (let i = 0; i < components.length; i++) {
    const issue = validateSingleCondition(components[i], [...path, i]);
    if (issue) {
      warnings.push(issue);
    }
  }

  // All condition validation issues are warnings (become errors in strict mode)
  return { errors: [], warnings };
}

/**
 * Validate an array of condition strings.
 *
 * @param conditions - Array of condition strings (each may be comma-separated)
 * @param basePath - JSON path to the array (e.g., ['blocks', 2, 'requirements'])
 * @returns Combined validation result
 */
export function validateConditions(
  conditions: string[] | undefined,
  basePath: Array<string | number>
): ConditionValidationResult {
  if (!conditions || conditions.length === 0) {
    return { errors: [], warnings: [] };
  }

  const allWarnings: ConditionIssue[] = [];

  for (let i = 0; i < conditions.length; i++) {
    const result = validateConditionString(conditions[i], [...basePath, i]);
    allWarnings.push(...result.warnings);
  }

  return { errors: [], warnings: allWarnings };
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
      const result = validateConditions(step.requirements, [...path, 'requirements']);
      issues.push(...result.warnings);
    }
  }

  function visitBlock(block: JsonBlock, path: Array<string | number>): void {
    // Check requirements if present
    if ('requirements' in block && block.requirements) {
      const result = validateConditions(block.requirements, [...path, 'requirements']);
      issues.push(...result.warnings);
    }

    // Check objectives if present
    if ('objectives' in block && block.objectives) {
      const result = validateConditions(block.objectives, [...path, 'objectives']);
      issues.push(...result.warnings);
    }

    // Check verify field for interactive blocks (uses same grammar)
    if ('verify' in block && block.verify) {
      const result = validateConditionString(block.verify, [...path, 'verify']);
      issues.push(...result.warnings);
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

