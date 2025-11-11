import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Extension } from '@tiptap/core';
import { sanitizeDocumentationHTML } from '../../../security';
import { error as logError } from '../utils/logger';

/**
 * PasteSanitizer Extension
 *
 * Intercepts paste events and sanitizes HTML content before insertion to prevent XSS attacks.
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
              // SECURITY: Sanitize HTML content before insertion (F1, F4)
              const sanitized = sanitizeDocumentationHTML(html);
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
