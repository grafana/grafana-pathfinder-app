/**
 * Validation service for user inputs
 * Prevents malformed/dangerous inputs from being stored in HTML attributes
 */

import { parseUrlSafely, sanitizeTextForDisplay } from '../../../security';
import type { InteractiveAttributesOutput } from '../types';
import { ACTION_TYPES, DATA_ATTRIBUTES } from '../../../constants/interactive-config';

/**
 * Form field definition for validation
 */
export interface FormField {
  id: string;
  label: string;
  type: 'text' | 'checkbox';
  placeholder?: string;
  hint?: string;
  defaultValue?: string | boolean;
  required?: boolean;
  autoFocus?: boolean;
  showCommonOptions?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validation error with field information
 */
export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Attribute validation result with multiple errors
 */
export interface AttributeValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Check if selector uses enhanced-selector pseudo-selectors
 * These are custom pseudo-selectors supported by the runtime enhanced-selector engine
 * Note: :has() is detected as enhanced even when standalone, because native :has() support
 * is not available in all browsers (Firefox < 140, Safari < 17.2), so we route through
 * the custom validator to ensure consistent behavior across browsers.
 */
function isEnhancedSelector(selector: string): boolean {
  return (
    selector.includes(':contains(') ||
    selector.includes(':nth-match(') ||
    selector.includes(':text(') ||
    selector.includes(':has(') // Any :has() usage is treated as enhanced for cross-browser compatibility
  );
}

/**
 * Basic syntax validation for enhanced selectors
 * Validates parentheses matching and basic structure
 * Handles :has(), :contains(), :nth-match(), and :text() pseudo-selectors
 */
function validateEnhancedSelectorSyntax(selector: string): ValidationResult {
  // First, check for empty pseudo-selectors using regex (simpler and more reliable)
  const emptyPseudoPatterns = [
    /:has\(\s*\)/g, // Empty :has()
    /:contains\(\s*\)/g, // Empty :contains()
    /:nth-match\(\s*\)/g, // Empty :nth-match()
    /:text\(\s*\)/g, // Empty :text()
  ];

  for (const pattern of emptyPseudoPatterns) {
    if (pattern.test(selector)) {
      return {
        valid: false,
        error: 'Enhanced pseudo-selector cannot be empty',
      };
    }
  }

  // Check for balanced parentheses in pseudo-selectors
  let parenCount = 0;
  let inPseudo = false;

  for (let i = 0; i < selector.length; i++) {
    const char = selector[i];
    const nextChars = selector.substring(i, i + 5);

    // Detect start of pseudo-selector
    if (nextChars === ':has(' || nextChars === ':con' || nextChars === ':nth' || nextChars === ':text') {
      inPseudo = true;
      parenCount = 1;
      // Skip past ':has(' (5 chars) or start of other pseudo (4 chars for ':con', ':nth', ':text')
      i += nextChars === ':has(' ? 4 : 3;
      continue;
    }

    if (inPseudo) {
      if (char === '(') {
        parenCount++;
      } else if (char === ')') {
        parenCount--;
        if (parenCount === 0) {
          inPseudo = false;
        }
      }
    }
  }

  if (parenCount !== 0) {
    return {
      valid: false,
      error: 'Unbalanced parentheses in enhanced selector',
    };
  }

  return { valid: true };
}

/**
 * Validates CSS selectors to ensure they're safe and well-formed
 * Supports both native CSS selectors and enhanced-selector pseudo-selectors
 * SECURITY: Rejects dangerous patterns that could cause XSS (F1, F5)
 */
export function validateCssSelector(selector: string): ValidationResult {
  if (!selector || selector.trim() === '') {
    return { valid: false, error: 'Selector cannot be empty' };
  }

  const trimmedSelector = selector.trim();

  // SECURITY: Check for dangerous patterns that could enable XSS (F1, F5)
  const dangerousPatterns = [
    /<script/i, // Script tags
    /javascript:/i, // JavaScript protocol
    /<object/i, // Object tags
    /<iframe/i, // Iframe tags
    /<embed/i, // Embed tags
    /<applet/i, // Applet tags
    /on\w+\s*=/i, // Event handlers (onclick, onerror, onload, etc.)
    /data:/i, // Data URIs
    /vbscript:/i, // VBScript protocol
    /expression\s*\(/i, // CSS expressions (IE)
    /<svg/i, // SVG tags (can contain scripts)
    /<form/i, // Form tags (can be used for CSRF)
    /<base/i, // Base tags (can change base URL)
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(trimmedSelector)) {
      return {
        valid: false,
        error: 'Selector contains dangerous patterns',
      };
    }
  }

  // SECURITY: Check for dangerous patterns in attribute selectors (F1, F5)
  // Attribute selectors like [attr*="javascript:"] or [attr^="data:"] can be dangerous
  const attributeSelectorPattern = /\[[^\]]*\]/g;
  const attributeSelectors = trimmedSelector.match(attributeSelectorPattern);

  if (attributeSelectors) {
    for (const attrSelector of attributeSelectors) {
      // Check for dangerous protocols or patterns in attribute values
      const dangerousAttrPatterns = [
        /javascript:/i,
        /data:/i,
        /vbscript:/i,
        /on\w+\s*=/i,
        /<script/i,
        /expression\s*\(/i,
      ];

      for (const pattern of dangerousAttrPatterns) {
        if (pattern.test(attrSelector)) {
          return {
            valid: false,
            error: 'Attribute selector contains dangerous patterns',
          };
        }
      }
    }
  }

  // SECURITY: Check for URL functions in CSS (url(), etc.) that might contain dangerous protocols
  const urlFunctionPattern = /url\s*\([^)]*\)/gi;
  const urlFunctions = trimmedSelector.match(urlFunctionPattern);

  if (urlFunctions) {
    for (const urlFunc of urlFunctions) {
      const dangerousUrlPatterns = [/javascript:/i, /data:/i, /vbscript:/i];

      for (const pattern of dangerousUrlPatterns) {
        if (pattern.test(urlFunc)) {
          return {
            valid: false,
            error: 'URL function contains dangerous protocol',
          };
        }
      }
    }
  }

  // Check if this is an enhanced selector (uses custom pseudo-selectors)
  if (isEnhancedSelector(trimmedSelector)) {
    // Validate enhanced selector syntax instead of using native querySelector
    return validateEnhancedSelectorSyntax(trimmedSelector);
  }

  // Validate CSS syntax using browser's querySelector for native selectors
  try {
    // Create a temporary div to test the selector
    const testDiv = document.createElement('div');
    testDiv.querySelector(trimmedSelector);
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
 * SECURITY: Uses DOMPurify-based sanitization to prevent XSS (F1)
 */
export function sanitizeAttributeValue(value: string): string {
  if (!value) {
    return '';
  }

  // SECURITY: Use DOMPurify-based sanitization from security utilities (F1)
  return sanitizeTextForDisplay(value);
}

/**
 * Validates button text or other simple text inputs
 * Ensures basic safety without being overly restrictive
 * SECURITY: Checks for common XSS patterns (F1)
 */
export function validateText(text: string, fieldName = 'Text'): ValidationResult {
  if (!text || text.trim() === '') {
    return { valid: false, error: `${fieldName} cannot be empty` };
  }

  // SECURITY: Check for script tags or javascript: protocol (F1)
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

/**
 * Validates navigation URLs to prevent XSS and injection attacks
 * SECURITY: Validates against dangerous URL schemes (F4, F6)
 *
 * @param url - The URL to validate (can be relative or absolute)
 * @returns ValidationResult with error message if invalid
 */
export function validateNavigationUrl(url: string): ValidationResult {
  if (!url || url.trim() === '') {
    return { valid: false, error: 'Navigation URL cannot be empty' };
  }

  const trimmedUrl = url.trim();

  // SECURITY: Check for dangerous URL schemes (F4, F6)
  const dangerousSchemes = ['javascript:', 'data:', 'file:', 'vbscript:', 'blob:'];
  const lowerUrl = trimmedUrl.toLowerCase();

  for (const scheme of dangerousSchemes) {
    if (lowerUrl.startsWith(scheme)) {
      return {
        valid: false,
        error: `Dangerous URL scheme detected: ${scheme}`,
      };
    }
  }

  // Check if it's a relative path (starts with /)
  if (trimmedUrl.startsWith('/')) {
    // Relative paths are safe if they start with /
    return { valid: true };
  }

  // For absolute URLs, parse and validate
  // SECURITY: Use parseUrlSafely() to safely parse URLs (F3)
  const parsedUrl = parseUrlSafely(trimmedUrl);

  if (!parsedUrl) {
    return {
      valid: false,
      error: 'Invalid URL format. Must be a relative path starting with / or a valid absolute URL',
    };
  }

  // Only allow http and https protocols for absolute URLs
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return {
      valid: false,
      error: `Only http and https protocols are allowed. Found: ${parsedUrl.protocol}`,
    };
  }

  return { valid: true };
}

/**
 * Validate attributes for a specific action type
 * Centralized validation for all interactive element attributes
 */
export function validateAttributes(
  actionType: string,
  attributes: Partial<InteractiveAttributesOutput>
): AttributeValidationResult {
  const errors: ValidationError[] = [];

  // Validate action type
  if (!actionType) {
    errors.push({ field: 'data-targetaction', message: 'Action type is required' });
  } else if (!Object.values(ACTION_TYPES).includes(actionType as any)) {
    errors.push({ field: 'data-targetaction', message: `Invalid action type: ${actionType}` });
  }

  // Action-specific validation
  switch (actionType) {
    case ACTION_TYPES.BUTTON:
    case ACTION_TYPES.HIGHLIGHT:
    case ACTION_TYPES.FORM_FILL:
    case ACTION_TYPES.HOVER:
      if (!attributes['data-reftarget'] || attributes['data-reftarget'].trim() === '') {
        errors.push({ field: 'data-reftarget', message: 'Reference target is required' });
      }
      break;

    case ACTION_TYPES.NAVIGATE:
      if (!attributes['data-reftarget'] || attributes['data-reftarget'].trim() === '') {
        errors.push({ field: 'data-reftarget', message: 'Navigation path is required' });
      } else {
        // SECURITY: Validate URL against dangerous schemes (F4, F6)
        const urlValidation = validateNavigationUrl(attributes['data-reftarget']);
        if (!urlValidation.valid) {
          errors.push({ field: 'data-reftarget', message: urlValidation.error || 'Invalid navigation URL' });
        }
      }
      break;

    case ACTION_TYPES.SEQUENCE:
      if (!attributes.id || attributes.id.trim() === '') {
        errors.push({ field: 'id', message: 'Section ID is required for sequence actions' });
      }
      break;
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate a single form field based on its type and the action type
 * Centralized field validation logic extracted from BaseInteractiveForm
 *
 * @param field - The form field definition
 * @param value - The field value to validate
 * @param actionType - The action type for context-specific validation
 * @returns Error message string if invalid, null if valid
 */
export function validateFormField(field: FormField, value: any, actionType: string): string | null {
  if (field.type === 'checkbox') {
    return null; // Checkboxes don't need validation
  }

  const stringValue = String(value || '').trim();

  // Skip validation for optional empty fields
  if (!field.required && stringValue === '') {
    return null;
  }

  // Required field validation
  if (field.required && stringValue === '') {
    return `${field.label.replace(':', '')} is required`;
  }

  // Validate based on field type/purpose
  // SECURITY: URL validation for navigate actions (F4, F6)
  if (field.id === DATA_ATTRIBUTES.REF_TARGET && actionType === ACTION_TYPES.NAVIGATE) {
    const result = validateNavigationUrl(stringValue);
    if (!result.valid) {
      return result.error || 'Invalid navigation URL';
    }
  }
  // CSS selectors (data-reftarget for highlight, formfill, hover)
  else if (
    field.id === DATA_ATTRIBUTES.REF_TARGET &&
    actionType !== ACTION_TYPES.BUTTON &&
    actionType !== ACTION_TYPES.NAVIGATE
  ) {
    const result = validateCssSelector(stringValue);
    if (!result.valid) {
      return result.error || 'Invalid selector';
    }
  }

  // Requirements field
  if (field.id === DATA_ATTRIBUTES.REQUIREMENTS && stringValue !== '') {
    const result = validateRequirement(stringValue);
    if (!result.valid) {
      return result.error || 'Invalid requirement';
    }
  }

  // Button text and other text fields (only if not already validated above)
  if (field.id === DATA_ATTRIBUTES.REF_TARGET && stringValue !== '' && actionType === ACTION_TYPES.BUTTON) {
    const result = validateText(stringValue, field.label.replace(':', ''));
    if (!result.valid) {
      return result.error || 'Invalid text';
    }
  }

  // Section ID validation for sequence actions
  if (field.id === 'id' && actionType === ACTION_TYPES.SEQUENCE) {
    const result = validateSectionId(stringValue);
    if (!result.valid) {
      return result.error || 'Invalid section ID';
    }
  }

  return null;
}
