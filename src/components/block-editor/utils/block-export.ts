/**
 * Block Export Utilities
 *
 * Functions for exporting JSON guides to clipboard and file downloads.
 */

import type { JsonBlock, JsonGuide, JsonStep } from '../types';
import { validateGuide as validateGuideCanonical, validateGuideFromString, toLegacyResult } from '../../../validation';
import { logger } from '../../../lib/logging';

/**
 * Recursively remove editor-only `authorNote` fields from every block in
 * a guide. Used by the export paths so author notes never ship in
 * published JSON.
 *
 * Walks the standard nested-container fields (`blocks`, `whenTrue`,
 * `whenFalse`, `steps`). Returns a new guide; does not mutate input.
 */
export function stripAuthorNotes(guide: JsonGuide): JsonGuide {
  const stripBlock = (block: JsonBlock): JsonBlock => {
    const cleaned: Record<string, unknown> = { ...(block as unknown as Record<string, unknown>) };
    delete cleaned.authorNote;

    // Recurse into known container fields. Each branch only runs when
    // the field exists on the current variant; we don't add fields.
    if (Array.isArray(cleaned.blocks)) {
      cleaned.blocks = (cleaned.blocks as JsonBlock[]).map(stripBlock);
    }
    if (Array.isArray(cleaned.whenTrue)) {
      cleaned.whenTrue = (cleaned.whenTrue as JsonBlock[]).map(stripBlock);
    }
    if (Array.isArray(cleaned.whenFalse)) {
      cleaned.whenFalse = (cleaned.whenFalse as JsonBlock[]).map(stripBlock);
    }
    if (Array.isArray(cleaned.steps)) {
      // Steps don't currently carry authorNote (they're a sub-shape, not
      // a discriminated block) — passthrough but defensive in case the
      // schema gains it later.
      cleaned.steps = (cleaned.steps as JsonStep[]).map((step) => {
        const cleanedStep = { ...(step as unknown as Record<string, unknown>) };
        delete cleanedStep.authorNote;
        return cleanedStep as unknown as JsonStep;
      });
    }
    return cleaned as unknown as JsonBlock;
  };

  return {
    ...guide,
    blocks: guide.blocks.map(stripBlock),
  };
}

/**
 * Copy JSON guide to clipboard
 *
 * @param guide - The guide to copy
 * @param pretty - Whether to format with indentation (default: true)
 * @returns Promise that resolves when copied
 */
export async function copyGuideToClipboard(guide: JsonGuide, pretty = true): Promise<void> {
  const exportable = stripAuthorNotes(guide);
  const json = pretty ? JSON.stringify(exportable, null, 2) : JSON.stringify(exportable);

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
  const exportable = stripAuthorNotes(guide);
  const json = pretty ? JSON.stringify(exportable, null, 2) : JSON.stringify(exportable);
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
    logger.error('Invalid guide JSON', { errors: result.errors.map((e) => e.message) });
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
