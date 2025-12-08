/**
 * Error formatting utilities for Zod validation errors
 */

import type { ZodIssue } from 'zod';
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

function formatFieldName(path: Array<string | number>): string {
  const lastSegment = path[path.length - 1];
  return typeof lastSegment === 'string' ? lastSegment : '';
}

function isBlockPath(path: Array<string | number>): boolean {
  if (path.length < 2) {
    return false;
  }
  return path[path.length - 2] === 'blocks' && typeof path[path.length - 1] === 'number';
}

function validateStepFields(step: Record<string, unknown>, stepIndex: number, blockIndex: number): string | null {
  if (!step.action) {
    return `Block ${blockIndex + 1}, step ${stepIndex + 1}: missing required field 'action'`;
  }
  if (!step.reftarget) {
    return `Block ${blockIndex + 1}, step ${stepIndex + 1}: missing required field 'reftarget'`;
  }
  if (step.action === 'formfill' && !step.targetvalue) {
    return `Block ${blockIndex + 1}, step ${stepIndex + 1}: formfill action requires 'targetvalue'`;
  }
  const validActions = ['highlight', 'button', 'formfill', 'navigate', 'hover'];
  if (!validActions.includes(step.action as string)) {
    return `Block ${blockIndex + 1}, step ${stepIndex + 1}: unknown action type '${step.action}'`;
  }
  return null;
}

function validateNestedBlock(
  nestedBlock: Record<string, unknown>,
  nestedIndex: number,
  parentPath: string
): string | null {
  const blockType = typeof nestedBlock.type === 'string' ? nestedBlock.type : null;
  if (!blockType) {
    return `${parentPath} > Block ${nestedIndex + 1}: missing required field 'type'`;
  }
  if (!VALID_BLOCK_TYPES.has(blockType)) {
    return `${parentPath} > Block ${nestedIndex + 1}: unknown block type '${blockType}'`;
  }
  const requiredFields: Record<string, string[]> = {
    markdown: ['content'],
    html: ['content'],
    image: ['src'],
    video: ['src'],
    interactive: ['action', 'reftarget', 'content'],
    multistep: ['content', 'steps'],
    guided: ['content', 'steps'],
    section: ['blocks'],
    quiz: ['question', 'choices'],
    assistant: ['blocks'],
  };
  const required = requiredFields[blockType] || [];
  for (const field of required) {
    if (
      !(field in nestedBlock) ||
      nestedBlock[field] === undefined ||
      nestedBlock[field] === null ||
      nestedBlock[field] === ''
    ) {
      return `${parentPath} > Block ${nestedIndex + 1} (${blockType}): missing required field '${field}'`;
    }
  }
  return null;
}

function getUnionErrorMessage(issue: ZodIssue, data: unknown): string | null {
  if (issue.code !== 'invalid_union') {
    return null;
  }

  const block = getBlockAtPath(data, issue.path);
  if (!block) {
    return null;
  }

  const blockType = typeof block.type === 'string' ? block.type : null;
  if (blockType && !VALID_BLOCK_TYPES.has(blockType)) {
    return `unknown block type '${blockType}'`;
  }
  if (!blockType) {
    return "missing required field 'type'";
  }

  // Check for step-level errors
  if ((blockType === 'multistep' || blockType === 'guided') && Array.isArray(block.steps)) {
    const blockIndex =
      issue.path.length >= 2 && typeof issue.path[issue.path.length - 1] === 'number'
        ? (issue.path[issue.path.length - 1] as number)
        : 0;
    for (let i = 0; i < block.steps.length; i++) {
      const step = block.steps[i] as Record<string, unknown>;
      if (step && typeof step === 'object') {
        const stepError = validateStepFields(step, i, blockIndex);
        if (stepError) {
          return stepError;
        }
      }
    }
  }

  // Check for nested block errors in section/assistant
  if ((blockType === 'section' || blockType === 'assistant') && Array.isArray(block.blocks)) {
    const blockIndex =
      issue.path.length >= 2 && typeof issue.path[issue.path.length - 1] === 'number'
        ? (issue.path[issue.path.length - 1] as number)
        : 0;
    for (let i = 0; i < block.blocks.length; i++) {
      const nestedBlock = block.blocks[i] as Record<string, unknown>;
      if (nestedBlock && typeof nestedBlock === 'object') {
        const nestedError = validateNestedBlock(nestedBlock, i, `Block ${blockIndex + 1}`);
        if (nestedError) {
          return nestedError;
        }
      }
    }
  }

  // Check for missing required fields
  const requiredFields: Record<string, string[]> = {
    markdown: ['content'],
    html: ['content'],
    image: ['src'],
    video: ['src'],
    interactive: ['action', 'reftarget', 'content'],
    multistep: ['content', 'steps'],
    guided: ['content', 'steps'],
    section: ['blocks'],
    quiz: ['question', 'choices'],
    assistant: ['blocks'],
  };
  const required = requiredFields[blockType] || [];
  for (const field of required) {
    if (!(field in block) || block[field] === undefined || block[field] === null || block[field] === '') {
      return `missing required field '${field}'`;
    }
    if (
      Array.isArray(block[field]) &&
      block[field].length === 0 &&
      (field === 'steps' || field === 'choices' || field === 'blocks')
    ) {
      return `missing required field '${field}' array`;
    }
  }

  // Check interactive-specific validations
  if (blockType === 'interactive') {
    const validActions = ['highlight', 'button', 'formfill', 'navigate', 'hover'];
    if (block.action && !validActions.includes(block.action as string)) {
      return `unknown action type '${block.action}'`;
    }
    if (block.action === 'formfill' && !block.targetvalue) {
      return "formfill action requires 'targetvalue'";
    }
  }

  return null;
}

export function formatZodErrors(issues: ZodIssue[], data: unknown): ValidationError[] {
  return issues.map((issue) => {
    const blockPath = formatBlockPath(issue.path, data);
    const fieldName = formatFieldName(issue.path);
    let message: string;

    if (issue.code === 'invalid_union') {
      const unionMsg = getUnionErrorMessage(issue, data);
      if (unionMsg) {
        // Check if unionMsg already has block prefix (from nested errors)
        if (unionMsg.startsWith('Block ')) {
          message = unionMsg;
        } else if (isBlockPath(issue.path)) {
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
        message = blockPath ? `${blockPath}: Invalid input` : 'Invalid input';
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
