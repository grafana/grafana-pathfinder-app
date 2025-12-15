/**
 * Block Import Utilities
 *
 * Functions for importing JSON guides from files with validation.
 * Uses Zod schemas from src/validation/ for validation.
 */

import type { JsonGuide } from '../types';
import { validateGuideFromString, toLegacyResult } from '../../../validation';

/**
 * Maximum file size in bytes (1MB)
 */
export const MAX_FILE_SIZE = 1024 * 1024;

/**
 * Validation result with detailed error information
 */
export interface ImportValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  guide: JsonGuide | null;
}

/**
 * Read a file as text
 *
 * @param file - File to read
 * @returns Promise resolving to file contents
 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read file as text'));
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };

    reader.readAsText(file);
  });
}

/**
 * Validate file before reading
 *
 * @param file - File to validate
 * @returns Validation result with errors if invalid
 */
export function validateFile(file: File): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
    errors.push(`File exceeds 1MB limit (${sizeMB}MB)`);
  }

  // Check file type
  if (!file.name.endsWith('.json') && file.type !== 'application/json') {
    errors.push('File must be a JSON file (.json)');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Parse and validate JSON guide content with detailed error reporting
 *
 * Uses Zod schemas for validation. This is the main validation entry point.
 *
 * @param jsonString - JSON string to parse
 * @returns Validation result with parsed guide if valid
 */
export function parseAndValidateGuide(jsonString: string): ImportValidationResult {
  const result = validateGuideFromString(jsonString);
  return toLegacyResult(result);
}

/**
 * Complete import workflow: read file, validate, and return result
 *
 * @param file - File to import
 * @returns Promise resolving to validation result
 */
export async function importGuideFromFile(file: File): Promise<ImportValidationResult> {
  // Validate file first
  const fileValidation = validateFile(file);
  if (!fileValidation.isValid) {
    return {
      isValid: false,
      errors: fileValidation.errors,
      warnings: [],
      guide: null,
    };
  }

  // Read file contents
  let content: string;
  try {
    content = await readFileAsText(file);
  } catch {
    return {
      isValid: false,
      errors: ['Unable to read file'],
      warnings: [],
      guide: null,
    };
  }

  // Parse and validate JSON
  return parseAndValidateGuide(content);
}
