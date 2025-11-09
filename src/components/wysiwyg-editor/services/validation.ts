/**
 * Validation service for user inputs
 * Prevents malformed/dangerous inputs from being stored in HTML attributes
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates CSS selectors to ensure they're safe and well-formed
 * Uses the browser's native querySelector to validate syntax
 * Rejects dangerous patterns that could cause issues
 */
export function validateCssSelector(selector: string): ValidationResult {
  if (!selector || selector.trim() === '') {
    return { valid: false, error: 'Selector cannot be empty' };
  }

  // Check for dangerous patterns
  const dangerousPatterns = [/<script/i, /javascript:/i, /<object/i, /<iframe/i, /<embed/i, /<applet/i];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(selector)) {
      return {
        valid: false,
        error: 'Selector contains dangerous patterns',
      };
    }
  }

  // Validate CSS syntax using browser's querySelector
  try {
    // Create a temporary div to test the selector
    const testDiv = document.createElement('div');
    testDiv.querySelector(selector);
    return { valid: true };
  } catch (e) {
    return {
      valid: false,
      error: 'Invalid CSS selector syntax',
    };
  }
}

/**
 * Validates section IDs to ensure they're safe HTML IDs
 * HTML IDs must start with a letter and contain only alphanumeric, hyphens, underscores
 */
export function validateSectionId(id: string): ValidationResult {
  if (!id || id.trim() === '') {
    return { valid: false, error: 'Section ID cannot be empty' };
  }

  // HTML ID must start with letter, contain only alphanumeric, hyphens, underscores
  const validIdPattern = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

  if (!validIdPattern.test(id)) {
    return {
      valid: false,
      error: 'ID must start with letter and contain only letters, numbers, hyphens, underscores',
    };
  }

  return { valid: true };
}

/**
 * Sanitizes attribute values by removing potentially problematic characters
 * This is a lightweight sanitization for general attribute values
 */
export function sanitizeAttributeValue(value: string): string {
  if (!value) return '';

  // Remove null bytes and control characters
  let sanitized = value.replace(/[\x00-\x1F\x7F]/g, '');

  // Escape double quotes to prevent attribute injection
  sanitized = sanitized.replace(/"/g, '&quot;');

  return sanitized;
}

/**
 * Validates button text or other simple text inputs
 * Ensures basic safety without being overly restrictive
 */
export function validateText(text: string, fieldName: string = 'Text'): ValidationResult {
  if (!text || text.trim() === '') {
    return { valid: false, error: `${fieldName} cannot be empty` };
  }

  // Check for script tags or javascript: protocol
  if (/<script/i.test(text) || /javascript:/i.test(text)) {
    return {
      valid: false,
      error: `${fieldName} contains dangerous content`,
    };
  }

  return { valid: true };
}

/**
 * Validates requirement strings
 * Requirements should follow specific patterns like "exists-reftarget", "on-page:/path"
 */
export function validateRequirement(requirement: string): ValidationResult {
  if (!requirement || requirement.trim() === '') {
    // Empty is valid (optional field)
    return { valid: true };
  }

  // Common requirement patterns
  const validPatterns = [
    /^exists-reftarget$/,
    /^navmenu-open$/,
    /^on-page:.+$/,
    /^is-admin$/,
    /^has-datasource:.+$/,
    /^has-plugin:.+$/,
    /^section-completed:.+$/,
  ];

  const isValid = validPatterns.some((pattern) => pattern.test(requirement));

  if (!isValid) {
    return {
      valid: false,
      error: 'Invalid requirement format. Expected patterns like "exists-reftarget", "on-page:/path", etc.',
    };
  }

  return { valid: true };
}

