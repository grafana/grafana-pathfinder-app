import * as prettier from 'prettier';
import * as prettierHtmlPlugin from 'prettier/plugins/html';
import { warn, error as logError } from './logger';

/**
 * Formats HTML with proper indentation using Prettier
 * Handles edge cases that regex-based formatters cannot:
 * - Attributes with special characters
 * - Self-closing tags
 * - Nested inline/block content
 * - HTML entities
 *
 * @param html - Raw HTML string to format
 * @returns Formatted HTML string with proper indentation
 */
export async function formatHTML(html: string): Promise<string> {
  try {
    const formatted = await prettier.format(html, {
      parser: 'html',
      plugins: [prettierHtmlPlugin],
      printWidth: 80,
      tabWidth: 2,
      useTabs: false,
      htmlWhitespaceSensitivity: 'css',
    });
    return formatted.trim();
  } catch (e) {
    // Log error when formatting fails
    logError('[htmlFormatter] Failed to format HTML with Prettier:', e);
    warn('[htmlFormatter] Returning unformatted HTML');
    // Fallback to unformatted HTML if formatting fails
    return html;
  }
}

/**
 * Synchronous wrapper for formatHTML that returns unformatted HTML if formatting fails
 * Used for compatibility with synchronous code
 *
 * @param html - Raw HTML string to format
 * @returns Promise that resolves to formatted HTML string
 */
export function formatHTMLSync(html: string): string {
  // Return unformatted HTML immediately for synchronous calls
  // The async version will be used when possible
  warn('[htmlFormatter] formatHTMLSync called - returning unformatted HTML. Use formatHTML (async) instead.');
  return html;
}
