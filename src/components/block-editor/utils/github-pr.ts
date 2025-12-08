/**
 * GitHub PR Utilities
 *
 * Functions for creating pull requests to the grafana/interactive-tutorials repository.
 * Uses a clipboard + GitHub web UI approach - no authentication required.
 */

import type { JsonGuide } from '../types';
import { validateGuide, formatFileSize } from './block-export';

/**
 * GitHub repository configuration
 */
const GITHUB_REPO_OWNER = 'grafana';
const GITHUB_REPO_NAME = 'interactive-tutorials';
const GITHUB_BRANCH = 'main';
const GUIDES_PATH = 'guides';

/**
 * Result of preparing a GitHub PR
 */
export interface PRCreationResult {
  /** Status of the preparation */
  status: 'ready' | 'invalid' | 'error';
  /** Human-readable message */
  message: string;
  /** Data for creating the PR */
  data?: {
    /** Filename for the guide */
    filename: string;
    /** Full path in the repository */
    filePath: string;
    /** JSON content */
    json: string;
    /** File size in bytes */
    byteSize: number;
    /** Formatted file size for display */
    formattedSize: string;
    /** GitHub URL to open */
    githubUrl: string;
    /** Whether JSON was successfully copied to clipboard */
    copiedToClipboard: boolean;
  };
  /** Validation errors if status is 'invalid' */
  errors?: string[];
}

/**
 * Sanitize a guide ID to create a valid filename.
 * Converts to lowercase, replaces invalid characters with dashes,
 * and ensures the result is a clean, URL-safe filename.
 *
 * @param id - The guide ID to sanitize
 * @returns Sanitized filename (without extension)
 */
export function sanitizeFilename(id: string): string {
  return (
    id
      .toLowerCase()
      // Replace spaces, underscores, and special chars with dashes
      .replace(/[^a-z0-9-]/g, '-')
      // Collapse multiple dashes into one
      .replace(/-+/g, '-')
      // Remove leading/trailing dashes
      .replace(/^-|-$/g, '')
      // Limit length to prevent overly long filenames
      .slice(0, 100) || 'untitled-guide'
  );
}

/**
 * Build the GitHub URL for creating or editing a file.
 * Always uses the "new file" URL - GitHub will handle showing the edit interface
 * if the file already exists when the user tries to commit.
 *
 * @param filePath - Path to the file in the repository
 * @returns GitHub URL to open
 */
function buildGitHubUrl(filePath: string): string {
  // SECURITY: Use URL API to safely construct URLs (F3)
  const baseUrl = new URL(`https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`);
  baseUrl.pathname += `/new/${GITHUB_BRANCH}`;
  baseUrl.searchParams.set('filename', filePath);
  return baseUrl.toString();
}

/**
 * Copy JSON to clipboard.
 * Returns true if successful, false if clipboard access failed.
 *
 * @param json - JSON string to copy
 * @returns Promise resolving to true if copied, false otherwise
 */
async function copyToClipboard(json: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(json);
      return true;
    }
  } catch (e) {
    console.warn('Clipboard API failed, trying fallback:', e);
  }

  // Fallback for older browsers or when clipboard API fails
  try {
    const textArea = document.createElement('textarea');
    textArea.value = json;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    const success = document.execCommand('copy');
    document.body.removeChild(textArea);
    return success;
  } catch (e) {
    console.warn('Fallback clipboard copy failed:', e);
    return false;
  }
}

/**
 * Prepare a GitHub PR for a guide.
 * Validates the guide, copies JSON to clipboard, checks if file exists,
 * and returns the appropriate GitHub URL.
 *
 * @param guide - The guide to create a PR for
 * @returns Promise resolving to the PR creation result
 */
export async function prepareGitHubPR(guide: JsonGuide): Promise<PRCreationResult> {
  // 1. Validate the guide
  const validation = validateGuide(guide);
  if (!validation.isValid) {
    return {
      status: 'invalid',
      message: 'Guide validation failed',
      errors: validation.errors,
    };
  }

  // Additional validation for PR creation
  if (!guide.id || guide.id.trim() === '') {
    return {
      status: 'invalid',
      message: 'Guide must have an ID',
      errors: ['Guide ID is required for creating a PR'],
    };
  }

  if (!guide.blocks || guide.blocks.length === 0) {
    return {
      status: 'invalid',
      message: 'Guide must have at least one block',
      errors: ['Add some content to your guide before creating a PR'],
    };
  }

  try {
    // 2. Prepare JSON and file info
    // Use pretty-printed JSON for clipboard so it's readable
    const json = JSON.stringify(guide, null, 2);
    const filename = `${sanitizeFilename(guide.id)}.json`;
    const filePath = `${GUIDES_PATH}/${filename}`;
    const byteSize = new Blob([json]).size;
    const formattedSize = formatFileSize(byteSize);

    // 3. Try to copy to clipboard (non-blocking - we continue even if it fails)
    const copiedToClipboard = await copyToClipboard(json);

    // 4. Build the GitHub URL
    const githubUrl = buildGitHubUrl(filePath);

    return {
      status: 'ready',
      message: copiedToClipboard
        ? `Ready to create PR for "${filename}"`
        : `Ready to create PR for "${filename}" (clipboard copy failed - copy manually)`,
      data: {
        filename,
        filePath,
        json,
        byteSize,
        formattedSize,
        githubUrl,
        copiedToClipboard,
      },
    };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Failed to prepare PR',
    };
  }
}

/**
 * Open GitHub in a new tab with the prepared URL.
 *
 * @param url - GitHub URL to open
 */
export function openGitHub(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}
