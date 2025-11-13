import { Plugin, PluginKey } from '@tiptap/pm/state';
import { DOMParser } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { Extension } from '@tiptap/core';
import { sanitizeDocumentationHTML } from '../../../security';
import { debug, error as logError } from '../utils/logger';

/**
 * Detects if a text string contains HTML-like patterns
 * Checks for common HTML tags and structure
 */
function looksLikeHTML(text: string): boolean {
  if (!text || typeof text !== 'string') {
    return false;
  }

  // Trim whitespace for detection
  const trimmed = text.trim();

  // Check for HTML tag patterns (opening tags like <html>, <div>, <p>, etc.)
  // This regex matches tags like <tag>, <tag attr="value">, or </tag>
  const htmlTagPattern = /<[a-z][a-z0-9]*(\s+[^>]*)?>/i;

  // Check if it starts with an HTML tag (common case)
  const startsWithTag = trimmed.startsWith('<') && htmlTagPattern.test(trimmed);

  // Check if it contains multiple HTML tags (more reliable indicator)
  const tagMatches = trimmed.match(/<[a-z][a-z0-9]*(\s+[^>]*)?>/gi);
  const hasMultipleTags = tagMatches !== null && tagMatches.length >= 2;

  // Check for common HTML structure patterns
  const hasHtmlStructure =
    /<html/i.test(trimmed) ||
    /<head/i.test(trimmed) ||
    /<body/i.test(trimmed) ||
    /<div/i.test(trimmed) ||
    /<span/i.test(trimmed) ||
    /<p>/i.test(trimmed) ||
    /<h[1-6]/i.test(trimmed) ||
    /<ul/i.test(trimmed) ||
    /<ol/i.test(trimmed);

  return (startsWithTag || hasMultipleTags) && hasHtmlStructure;
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
          clipboardTextParser: (text: string, $context, plain: boolean, view: EditorView) => {
            // Only process if this looks like HTML and wasn't already handled as HTML
            if (!looksLikeHTML(text)) {
              // Return a slice with plain text to let default behavior handle it
              // We need to return a Slice, not null
              const schema = view.state.schema;
              const parser = DOMParser.fromSchema(schema);
              const tempDiv = document.createElement('div');
              tempDiv.textContent = text;
              return parser.parseSlice(tempDiv);
            }

            try {
              debug('[PasteSanitizer] HTML detected in plain text paste, parsing...');

              // SECURITY: Sanitize HTML content before parsing (F1, F4)
              const sanitized = sanitizeDocumentationHTML(text);

              // Get the editor's schema from the view state
              const schema = view.state.schema;

              // Create a temporary DOM element to parse the HTML
              const tempDiv = document.createElement('div');
              tempDiv.innerHTML = sanitized;

              // Use ProseMirror's DOMParser to convert HTML to a slice
              const parser = DOMParser.fromSchema(schema);
              const slice = parser.parseSlice(tempDiv, { preserveWhitespace: 'full' });

              debug('[PasteSanitizer] HTML parsed successfully from plain text');
              return slice;
            } catch (error) {
              logError('[PasteSanitizer] Failed to parse HTML from plain text:', error);
              // On error, return a plain text slice to fall back to default behavior
              const schema = view.state.schema;
              const parser = DOMParser.fromSchema(schema);
              const tempDiv = document.createElement('div');
              tempDiv.textContent = text;
              return parser.parseSlice(tempDiv);
            }
          },
        },
      }),
    ];
  },
});
