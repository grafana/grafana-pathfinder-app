import { Plugin, PluginKey } from '@tiptap/pm/state';
import { DOMParser, type Slice, type ResolvedPos, Slice as ProseMirrorSlice, Fragment } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { Extension } from '@tiptap/core';
import { sanitizeDocumentationHTML } from '../../../security';
import { debug, error as logError } from '../utils/logger';

/**
 * Detects if a text string contains HTML-like content.
 * Checks for HTML tags and basic structure to determine if content should be parsed as HTML.
 *
 * @param text - The text to check for HTML content
 * @returns true if HTML-like content is detected, false otherwise
 */
function detectHTMLContent(text: string): boolean {
  if (!text || typeof text !== 'string') {
    return false;
  }

  // Check for HTML tags (opening/closing tags or self-closing tags)
  // Pattern matches: <tag>, </tag>, <tag/>, <tag attr="value">
  const htmlTagPattern = /<[a-z][a-z0-9]*\b[^>]*>|<\/[a-z][a-z0-9]*>/i;

  // Check if text contains HTML tags
  if (!htmlTagPattern.test(text)) {
    return false;
  }

  // Additional validation: check for balanced tags or common HTML structure
  // This helps avoid false positives from text that contains < or > characters
  const hasOpeningTag = /<[a-z][a-z0-9]*\b[^>]*>/i.test(text);
  const hasClosingTag = /<\/[a-z][a-z0-9]*>/i.test(text);
  const hasSelfClosingTag = /<[a-z][a-z0-9]*\b[^>]*\/>/i.test(text);

  // Consider it HTML if we have opening/closing tags or self-closing tags
  return hasOpeningTag && (hasClosingTag || hasSelfClosingTag);
}

/**
 * Parses HTML text into a ProseMirror Slice using the editor's schema.
 * Sanitizes HTML before parsing to prevent XSS attacks.
 *
 * @param view - The ProseMirror editor view
 * @param htmlText - The HTML text to parse
 * @returns A ProseMirror Slice if parsing succeeds, null otherwise
 */
function parseHTMLToSlice(view: EditorView, htmlText: string): Slice | null {
  try {
    // SECURITY: Sanitize HTML before parsing (F1, F4)
    const sanitized = sanitizeDocumentationHTML(htmlText);
    debug('[PasteSanitizer] Sanitized HTML for parsing:', sanitized.substring(0, 100));

    // Create a temporary DOM element to hold the sanitized HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = sanitized;

    // Use ProseMirror's DOMParser to convert HTML DOM to ProseMirror nodes
    const parser = DOMParser.fromSchema(view.state.schema);
    const slice = parser.parseSlice(tempDiv, { preserveWhitespace: 'full' });

    debug('[PasteSanitizer] Successfully parsed HTML to ProseMirror slice');
    return slice;
  } catch (error) {
    logError('[PasteSanitizer] Failed to parse HTML to ProseMirror slice:', error);
    return null;
  }
}

/**
 * PasteSanitizer Extension
 *
 * Intercepts paste events and sanitizes HTML content before insertion to prevent XSS attacks.
 * Handles two scenarios:
 * 1. HTML detected in clipboard: Uses transformPastedHTML (already working)
 * 2. HTML pasted as plain text: Uses clipboardTextParser to detect and parse HTML
 *
 * SECURITY: Sanitizes all pasted content using DOMPurify (F1, F4)
 */
export const PasteSanitizer = Extension.create({
  name: 'pasteSanitizer',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('pasteSanitizer'),
        props: {
          transformPastedHTML: (html: string) => {
            try {
              debug('[PasteSanitizer] HTML detected in clipboard, sanitizing...');
              // SECURITY: Sanitize HTML content before insertion (F1, F4)
              const sanitized = sanitizeDocumentationHTML(html);
              debug('[PasteSanitizer] HTML sanitized successfully');
              return sanitized;
            } catch (error) {
              logError('[PasteSanitizer] Failed to sanitize pasted content:', error);
              // On error, return empty string to prevent unsafe content
              return '';
            }
          },
        },
      }),
    ];
  },
});
