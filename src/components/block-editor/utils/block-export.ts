/**
 * Block Export Utilities
 *
 * Functions for exporting JSON guides to clipboard and file downloads.
 */

import type { JsonGuide } from '../types';

/**
 * Copy JSON guide to clipboard
 *
 * @param guide - The guide to copy
 * @param pretty - Whether to format with indentation (default: true)
 * @returns Promise that resolves when copied
 */
export async function copyGuideToClipboard(guide: JsonGuide, pretty = true): Promise<void> {
  const json = pretty ? JSON.stringify(guide, null, 2) : JSON.stringify(guide);

  // Try modern clipboard API first
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(json);
    return;
  }

  // Fallback for older browsers
  const textArea = document.createElement('textarea');
  textArea.value = json;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  textArea.style.top = '-999999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(textArea);
  }
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
 * @param guide - The guide to validate
 * @returns Object with isValid boolean and array of error messages
 */
export function validateGuide(guide: JsonGuide): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Required fields
  if (!guide.id || typeof guide.id !== 'string') {
    errors.push('Guide must have a valid "id" string');
  }

  if (!guide.title || typeof guide.title !== 'string') {
    errors.push('Guide must have a valid "title" string');
  }

  if (!Array.isArray(guide.blocks)) {
    errors.push('Guide must have a "blocks" array');
  } else {
    // Validate each block has a type
    guide.blocks.forEach((block, index) => {
      if (!block.type) {
        errors.push(`Block at index ${index} is missing "type" field`);
      }
    });
  }

  // Validate match metadata if present
  if (guide.match) {
    if (guide.match.urlPrefix && !Array.isArray(guide.match.urlPrefix)) {
      errors.push('match.urlPrefix must be an array');
    }
    if (guide.match.tags && !Array.isArray(guide.match.tags)) {
      errors.push('match.tags must be an array');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
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
  try {
    const parsed = JSON.parse(json);
    const validation = validateGuide(parsed);

    if (!validation.isValid) {
      console.error('Invalid guide JSON:', validation.errors);
      return null;
    }

    return parsed as JsonGuide;
  } catch (e) {
    console.error('Failed to parse guide JSON:', e);
    return null;
  }
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
