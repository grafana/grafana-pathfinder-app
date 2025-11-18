/**
 * Utilities for detecting whether a string is a CSS selector or plain text
 * Used primarily for button targeting where both selector and text-based matching are supported
 */

/**
 * Detect if a string is a CSS selector using common patterns
 * Returns true for: #id, .class, [attr], tag[attr], :pseudo, combinators, etc.
 * Returns false for plain text like button labels
 *
 * @param input - The string to test
 * @returns true if the string appears to be a CSS selector
 *
 * @example
 * ```typescript
 * isCssSelector('#my-button')           // true
 * isCssSelector('.btn-primary')         // true
 * isCssSelector('[data-testid="save"]') // true
 * isCssSelector('button:hover')         // true
 * isCssSelector('div > button')         // true
 * isCssSelector('Save Dashboard')       // false
 * isCssSelector('OK')                   // false
 * ```
 */
export function isCssSelector(input: string): boolean {
  if (!input || typeof input !== 'string') {
    return false;
  }

  const trimmed = input.trim();

  // Empty string is not a selector
  if (trimmed.length === 0) {
    return false;
  }

  // Regex patterns for common CSS selector syntax
  const patterns = [
    /^#[\w-]+/, // ID selector: #id
    /^\.[\w-]+/, // Class selector: .class
    /^\[.*\]/, // Attribute selector: [attr], [attr="value"]
    /^[\w-]+\[/, // Tag with attribute: tag[attr]
    /^:[\w-]+/, // Pseudo-class/element without tag: :focus, :hover
    /^[\w-]+:/, // Pseudo-class/element with tag: button:hover
    /^[\w-]+\s*>\s*/, // Child combinator: div > button
    /^[\w-]+\s*\+\s*/, // Adjacent sibling: div + button
    /^[\w-]+\s*~\s*/, // General sibling: div ~ button
    /\s*>\s*[\w-]+/, // Contains child combinator: > button
    /\s*\+\s*[\w-]+/, // Contains adjacent sibling: + button
    /\s*~\s*[\w-]+/, // Contains general sibling: ~ button
  ];

  return patterns.some((pattern) => pattern.test(trimmed));
}
