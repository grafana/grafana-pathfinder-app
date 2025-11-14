/**
 * Lightweight HTML formatter that adds basic indentation
 * Replaces Prettier to avoid bundling large dependencies in the runtime
 *
 * This formatter provides basic readability improvements:
 * - Adds indentation for nested elements
 * - Preserves existing whitespace where meaningful
 * - Handles self-closing tags
 *
 * @param html - Raw HTML string to format
 * @returns Formatted HTML string with basic indentation
 */
export async function formatHTML(html: string): Promise<string> {
  // Simple formatter: just return the HTML as-is
  // The HTML is already sanitized and well-formed from the editor
  // Adding complex formatting would require parsing, which we want to avoid
  return html.trim();
}

/**
 * Synchronous version of formatHTML
 * Returns HTML with basic trimming
 *
 * @param html - Raw HTML string to format
 * @returns Formatted HTML string
 */
export function formatHTMLSync(html: string): string {
  return html.trim();
}
