/**
 * Attribute Service
 * Centralizes attribute transformation and utilities
 * Note: Validation functions have been moved to validation.ts
 */

import type { InteractiveAttributesInput, InteractiveAttributesOutput } from '../types';
import { ACTION_TYPES, DATA_ATTRIBUTES, DEFAULT_VALUES } from '../../../constants/interactive-config';
import { sanitizeTextForDisplay } from '../../../security';

// Re-export validation types and functions for backward compatibility
export type { ValidationError, AttributeValidationResult } from './validation';
export { validateAttributes } from './validation';

/**
 * Transform UI input attributes to HTML output attributes
 * Converts boolean data-doit to string 'false' or null
 */
export function transformInputToOutput(input: Partial<InteractiveAttributesInput>): InteractiveAttributesOutput {
  return {
    'data-targetaction': input['data-targetaction'],
    'data-reftarget': input['data-reftarget'],
    'data-requirements': input['data-requirements'],
    'data-doit': input['data-doit'] ? DEFAULT_VALUES.DO_IT_FALSE : null,
    class: input.class,
    id: input.id,
  };
}

/**
 * Transform HTML output attributes to UI input attributes
 * Converts string 'false' to boolean true for data-doit
 */
export function transformOutputToInput(
  output: Partial<InteractiveAttributesOutput>
): Partial<InteractiveAttributesInput> {
  return {
    'data-targetaction': output['data-targetaction'] || '',
    'data-reftarget': output['data-reftarget'] || '',
    'data-requirements': output['data-requirements'] || '',
    'data-doit': output['data-doit'] === DEFAULT_VALUES.DO_IT_FALSE,
    class: output.class || '',
    id: output.id || '',
  };
}

/**
 * Sanitize attribute values
 * Removes null/undefined, trims strings, validates formats
 * SECURITY: Sanitizes all string values to prevent XSS via attribute injection (F1, F4)
 */
export function sanitizeAttributes(
  attributes: Partial<InteractiveAttributesOutput>
): InteractiveAttributesOutput {
  const sanitized: Partial<InteractiveAttributesOutput> = {};

  // Trim string values, sanitize, and filter out empty ones
  Object.entries(attributes).forEach(([key, value]) => {
    if (value === null || value === undefined) {
      return;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed !== '') {
        // SECURITY: Sanitize string values to prevent XSS via attribute injection (F1, F4)
        const sanitizedValue = sanitizeTextForDisplay(trimmed);
        sanitized[key as keyof InteractiveAttributesOutput] = sanitizedValue as any;
      }
    } else {
      sanitized[key as keyof InteractiveAttributesOutput] = value;
    }
  });

  return sanitized as InteractiveAttributesOutput;
}

/**
 * Check if an attribute value is empty
 */
export function isEmptyAttribute(value: any): boolean {
  return value === null || value === undefined || value === '' || value === false;
}

/**
 * Get default attributes for an action type
 */
export function getDefaultAttributes(actionType: string): Partial<InteractiveAttributesOutput> {
  const base: Partial<InteractiveAttributesOutput> = {
    'data-targetaction': actionType,
    'data-requirements': DEFAULT_VALUES.REQUIREMENT,
    class: DEFAULT_VALUES.CLASS,
  };

  if (actionType === ACTION_TYPES.SEQUENCE) {
    return {
      ...base,
      id: '',
      'data-reftarget': '',
    };
  }

  return base;
}

/**
 * Merge attributes, with new attributes overriding existing ones
 */
export function mergeAttributes(
  existing: Partial<InteractiveAttributesOutput>,
  updates: Partial<InteractiveAttributesOutput>
): InteractiveAttributesOutput {
  return {
    ...existing,
    ...Object.fromEntries(Object.entries(updates).filter(([_, value]) => !isEmptyAttribute(value))),
  } as InteractiveAttributesOutput;
}

/**
 * Extract attributes from an HTML element
 */
export function extractAttributesFromElement(element: HTMLElement): Record<string, string> {
  const attrs: Record<string, string> = {};

  // Extract relevant attributes
  const dataAttrKeys = Object.values(DATA_ATTRIBUTES);
  const otherAttrKeys = ['class', 'id'];
  const attrKeys = [...dataAttrKeys, ...otherAttrKeys];

  attrKeys.forEach((key) => {
    const value = element.getAttribute(key);
    if (value) {
      attrs[key] = value;
    }
  });

  return attrs;
}

