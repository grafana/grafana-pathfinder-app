/**
 * Block Export Utilities
 *
 * Functions for exporting JSON guides to clipboard and file downloads.
 */

import type { JsonGuide } from '../types';
import { validateGuide as validateGuideCanonical, validateGuideFromString, toLegacyResult } from '../../../validation';

/**
 * Copy JSON guide to clipboard
 *
 * @param guide - The guide to copy
 * @param pretty - Whether to format with indentation (default: true)
 * @returns Promise that resolves when copied
 */
export async function copyGuideToClipboard(guide: JsonGuide, pretty = true): Promise<void> {
  const json = pretty ? JSON.stringify(guide, null, 2) : JSON.stringify(guide);

  await navigator.clipboard.writeText(json);
}

/**
 * Download JSON guide as a file
 *
 * @param guide - The guide to download
 * @param filename - Optional filename (defaults to guide.id.json)
 * @param pretty - Whether to format with indentation (default: true)
 */
export function downloadGuideAsFile(guide: JsonGuide, filename?: string, pretty = true): void {
  const json = pretty ? JSON.stringify(guide, null, 2) : JSON.stringify(guide);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename || `${guide.id}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Clean up the URL object
  URL.revokeObjectURL(url);
}

/**
 * Validate a JSON guide structure
 *
 * Delegates to the canonical Zod-based validator in `src/validation/`. This
 * is the same pipeline the CLI and MCP server run, so the editor's
 * "Copy JSON" / GitHub-PR paths now apply identical rules (Zod schema +
 * condition-grammar + nesting depth) instead of the older shallow check.
 *
 * Unknown-field warnings are intentionally suppressed: those exist for
 * detecting forward-incompatible additions in CI, not for nudging authors
 * mid-edit.
 *
 * @param guide - The guide to validate
 * @returns Object with isValid boolean and array of error messages
 */
export function validateGuide(guide: JsonGuide): { isValid: boolean; errors: string[] } {
  const result = validateGuideCanonical(guide, { skipUnknownFieldCheck: true });
  const legacy = toLegacyResult(result);
  return { isValid: legacy.isValid, errors: legacy.errors };
}

/**
 * Format guide JSON for display
 *
 * @param guide - The guide to format
 * @returns Formatted JSON string
 */
export function formatGuideJson(guide: JsonGuide): string {
  return JSON.stringify(guide, null, 2);
}

/**
 * Parse JSON string to guide (with validation)
 *
 * @param json - JSON string to parse
 * @returns Parsed guide or null if invalid
 */
export function parseGuideJson(json: string): JsonGuide | null {
  const result = validateGuideFromString(json, { skipUnknownFieldCheck: true });
  if (!result.isValid || !result.guide) {
    console.error(
      'Invalid guide JSON:',
      result.errors.map((e) => e.message)
    );
    return null;
  }
  return result.guide;
}

/**
 * Get estimated file size of guide in bytes
 *
 * @param guide - The guide to measure
 * @returns Size in bytes
 */
export function getGuideSize(guide: JsonGuide): number {
  const json = JSON.stringify(guide);
  return new Blob([json]).size;
}

/**
 * Format file size for display
 *
 * @param bytes - Size in bytes
 * @returns Formatted string (e.g., "1.5 KB")
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
