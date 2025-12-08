/**
 * Error formatting utilities for Zod validation errors
 *
 * This module is responsible for formatting Zod validation errors into
 * human-readable messages. It extracts context from Zod's error structure
 * without re-implementing validation logic.
 */

import type { ZodIssue, ZodError } from 'zod';
import { VALID_BLOCK_TYPES } from '../types/json-guide.schema';

export interface ValidationError {
  message: string;
  path: Array<string | number>;
  code: string;
}

export interface ValidationWarning {
  message: string;
  path: Array<string | number>;
  type: 'unknown-field' | 'deprecation' | 'suggestion';
}

/**
 * Extract the block type from a path in the data structure.
 */
function getBlockTypeFromPath(data: unknown, path: Array<string | number>): string | null {
  let current: unknown = data;
  for (const segment of path) {
    if (current === null || current === undefined) {
      return null;
    }
    if (typeof segment === 'number' && Array.isArray(current)) {
      current = current[segment];
    } else if (typeof segment === 'string' && typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return null;
    }
  }
  if (current && typeof current === 'object' && 'type' in current) {
    return String((current as Record<string, unknown>).type);
  }
  return null;
}

/**
 * Get the object at a specific path in the data structure.
 */
function getBlockAtPath(data: unknown, path: Array<string | number>): Record<string, unknown> | null {
  let current: unknown = data;
  for (const segment of path) {
    if (current === null || current === undefined) {
      return null;
    }
    if (typeof segment === 'number' && Array.isArray(current)) {
      current = current[segment];
    } else if (typeof segment === 'string' && typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return null;
    }
  }
  return current && typeof current === 'object' ? (current as Record<string, unknown>) : null;
}

/**
 * Format a path into a human-readable block reference.
 * E.g., ["blocks", 0] -> "Block 1"
 * E.g., ["blocks", 2, "steps", 1] -> "Block 3, step 2"
 */
function formatBlockPath(path: Array<string | number>, data: unknown): string {
  const parts: string[] = [];
  for (let i = 0; i < path.length; i++) {
    const segment = path[i];
    if (path[i - 1] === 'blocks' && typeof segment === 'number') {
      const blockType = getBlockTypeFromPath(data, path.slice(0, i + 1));
      parts.push(blockType ? `Block ${segment + 1} (${blockType})` : `Block ${segment + 1}`);
    } else if (path[i - 1] === 'steps' && typeof segment === 'number') {
      for (let j = i - 2; j >= 0; j--) {
        if (path[j - 1] === 'blocks' && typeof path[j] === 'number') {
          parts.push(`Block ${(path[j] as number) + 1}, step ${segment + 1}`);
          break;
        }
      }
    }
  }
  return parts.join(' > ');
}

/**
 * Extract the field name from the end of a path.
 */
function formatFieldName(path: Array<string | number>): string {
  const lastSegment = path[path.length - 1];
  return typeof lastSegment === 'string' ? lastSegment : '';
}

/**
 * Check if a path points to a block (e.g., ["blocks", 0]).
 */
function isBlockPath(path: Array<string | number>): boolean {
  if (path.length < 2) {
    return false;
  }
  return path[path.length - 2] === 'blocks' && typeof path[path.length - 1] === 'number';
}

/**
 * Check if a ZodError has ANY type literal error (regardless of what type it expects).
 * If there's a type error, this schema didn't match the input's type field.
 */
function hasAnyTypeLiteralError(zodError: ZodError): boolean {
  return zodError.issues.some((issue) => {
    // Check if this is a type literal mismatch - the last path segment should be 'type'
    if (issue.code !== 'invalid_literal') {
      return false;
    }
    const lastSegment = issue.path[issue.path.length - 1];
    return lastSegment === 'type';
  });
}

/**
 * Extract field error from a ZodError for a specific issue type.
 */
function extractFieldError(zodError: ZodError): string | null {
  for (const issue of zodError.issues) {
    if (issue.path.length > 0) {
      const fieldName = issue.path[issue.path.length - 1];
      if (typeof fieldName === 'string') {
        if (issue.code === 'too_small') {
          return `missing required field '${fieldName}'`;
        } else if (issue.code === 'invalid_type' && 'received' in issue && issue.received === 'undefined') {
          return `missing required field '${fieldName}'`;
        } else if (issue.code === 'invalid_enum_value') {
          const received = (issue as unknown as { received: string }).received;
          return `unknown ${fieldName} '${received}'`;
        } else if (issue.code === 'custom') {
          // Custom refinement error (e.g., formfill requires targetvalue)
          return issue.message;
        }
      }
    }
  }
  return null;
}

/**
 * Recursively find field errors in union errors, filtering by block type.
 * Only descends into union branches that don't have type literal errors
 * (meaning the type field matched for that schema).
 */
function findFieldErrorInUnion(zodError: ZodError, _expectedBlockType: string): string | null {
  // If this error has a type literal mismatch, skip it entirely
  // (This schema expected a different block type than we provided)
  if (hasAnyTypeLiteralError(zodError)) {
    return null;
  }

  // Check each issue in this error for nested unions
  for (const issue of zodError.issues) {
    if (issue.code === 'invalid_union') {
      const unionIssue = issue as ZodIssue & { unionErrors?: ZodError[] };
      if (unionIssue.unionErrors) {
        for (const nestedError of unionIssue.unionErrors) {
          const fieldError = findFieldErrorInUnion(nestedError, _expectedBlockType);
          if (fieldError) {
            return fieldError;
          }
        }
      }
    }
  }

  // No nested unions or they didn't have field errors - check direct field errors
  return extractFieldError(zodError);
}

/**
 * Extract the most useful error message from a union error's nested errors.
 */
function extractUnionErrorDetails(issue: ZodIssue, blockType: string | null): string | null {
  const unionIssue = issue as ZodIssue & { unionErrors?: ZodError[] };
  if (!unionIssue.unionErrors || unionIssue.unionErrors.length === 0) {
    return null;
  }

  // If we know the block type, find errors from the matching schema
  if (blockType && VALID_BLOCK_TYPES.has(blockType)) {
    for (const zodError of unionIssue.unionErrors) {
      const fieldError = findFieldErrorInUnion(zodError, blockType);
      if (fieldError) {
        return fieldError;
      }
    }
  }

  // Fallback: just get any field error
  for (const zodError of unionIssue.unionErrors) {
    const fieldError = extractFieldError(zodError);
    if (fieldError) {
      return fieldError;
    }
  }

  return null;
}

/**
 * Extract a contextual error message from a union error.
 * Uses block type context and nested error details.
 */
function getUnionErrorMessage(issue: ZodIssue, data: unknown): string | null {
  if (issue.code !== 'invalid_union') {
    return null;
  }

  const block = getBlockAtPath(data, issue.path);
  if (!block) {
    return null;
  }

  const blockType = typeof block.type === 'string' ? block.type : null;

  // Check for unknown block type first
  if (blockType && !VALID_BLOCK_TYPES.has(blockType)) {
    return `unknown block type '${blockType}'`;
  }
  if (!blockType) {
    return "missing required field 'type'";
  }

  // Try to extract specific field error from union's nested errors
  const fieldError = extractUnionErrorDetails(issue, blockType);
  if (fieldError) {
    return fieldError;
  }

  // No specific error found - return null to use Zod's message
  return null;
}

/**
 * Format Zod validation issues into human-readable error objects.
 */
export function formatZodErrors(issues: ZodIssue[], data: unknown): ValidationError[] {
  return issues.map((issue) => {
    const blockPath = formatBlockPath(issue.path, data);
    const fieldName = formatFieldName(issue.path);
    let message: string;

    if (issue.code === 'invalid_union') {
      const unionMsg = getUnionErrorMessage(issue, data);
      if (unionMsg) {
        if (isBlockPath(issue.path)) {
          const blockIndex = issue.path[issue.path.length - 1] as number;
          const blockType = getBlockTypeFromPath(data, issue.path);
          const prefix = blockType ? `Block ${blockIndex + 1} (${blockType})` : `Block ${blockIndex + 1}`;
          message = `${prefix}: ${unionMsg}`;
        } else if (blockPath) {
          message = `${blockPath}: ${unionMsg}`;
        } else {
          message = unionMsg;
        }
      } else {
        // Fall back to Zod's message for complex union errors
        message = blockPath ? `${blockPath}: ${issue.message}` : issue.message;
      }
    } else if (blockPath) {
      if (
        issue.code === 'too_small' ||
        (issue.code === 'invalid_type' && 'received' in issue && issue.received === 'undefined')
      ) {
        message = `${blockPath}: missing required field '${fieldName}'`;
      } else if (issue.code === 'invalid_enum_value') {
        message = `${blockPath}: unknown ${fieldName} '${(issue as unknown as { received: string }).received}'`;
      } else {
        message = `${blockPath}: ${issue.message}`;
      }
    } else {
      if (issue.code === 'too_small') {
        message = `Guide is missing required field '${fieldName}' (string)`;
      } else if (issue.code === 'invalid_type' && 'received' in issue && issue.received === 'undefined') {
        message = `Guide is missing required field '${fieldName}' (${(issue as unknown as { expected: string }).expected})`;
      } else if (issue.code === 'invalid_type' && 'received' in issue) {
        message = `'${fieldName}' must be an array`;
      } else {
        message = issue.message;
      }
    }
    return { message, path: issue.path, code: issue.code };
  });
}

export function formatErrorsAsStrings(errors: ValidationError[]): string[] {
  return errors.map((e) => e.message);
}

export function formatWarningsAsStrings(warnings: ValidationWarning[]): string[] {
  return warnings.map((w) => w.message);
}
