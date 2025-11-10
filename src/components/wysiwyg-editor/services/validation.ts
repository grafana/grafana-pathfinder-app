/**
 * Validation service for user inputs
 * Prevents malformed/dangerous inputs from being stored in HTML attributes
 */

import { parseUrlSafely, sanitizeTextForDisplay } from '../../../security';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates CSS selectors to ensure they're safe and well-formed
 * Uses the browser's native querySelector to validate syntax
 * SECURITY: Rejects dangerous patterns that could cause XSS (F1, F5)
 */
export function validateCssSelector(selector: string): ValidationResult {
  if (!selector || selector.trim() === '') {
    return { valid: false, error: 'Selector cannot be empty' };
  }

  // SECURITY: Check for dangerous patterns that could enable XSS (F1, F5)
  const dangerousPatterns = [
    /<script/i,           // Script tags
    /javascript:/i,       // JavaScript protocol
    /<object/i,          // Object tags
    /<iframe/i,          // Iframe tags
    /<embed/i,           // Embed tags
    /<applet/i,          // Applet tags
    /on\w+\s*=/i,        // Event handlers (onclick, onerror, onload, etc.)
    /data:/i,            // Data URIs
    /vbscript:/i,        // VBScript protocol
    /expression\s*\(/i,  // CSS expressions (IE)
  ];

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

