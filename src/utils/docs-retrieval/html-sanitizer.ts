// HTML Sanitization for Documentation Content
// Implements XSS protection using DOMPurify with custom configuration
// for interactive documentation features

import DOMPurify from 'dompurify';
import { isYouTubeDomain, isVimeoDomain } from '../url-validator';

/**
 * Sanitizes HTML content for documentation rendering.
 * Configured to support custom elements (badges, interactive elements)
 * while preventing XSS attacks.
 *
 * Security features:
 * - Allowlists custom documentation elements
 * - Preserves data-* attributes for interactive functionality
 * - Video platform iframes (YouTube, Vimeo): allowed without sandbox, browser default referrer policy
 * - Other iframes: forced sandbox="" (maximum restrictions) and no-referrer policy
 * - Enforces rel="noopener noreferrer" on target="_blank" links
 *
 * @param html - Raw HTML string from documentation source
 * @returns Sanitized HTML safe for rendering
 * @throws Error if sanitization fails critically
 */
export function sanitizeDocumentationHTML(html: string): string {
  if (!html || typeof html !== 'string') {
    throw new Error('Invalid HTML input: must be a non-empty string');
  }

  // Configure DOMPurify with custom settings for documentation
  const config: DOMPurify.Config = {
    // Allow standard HTML tags plus custom documentation elements
    // Only includes tags actually used by Grafana docs content
    ALLOWED_TAGS: [
      // Core HTML5 structural elements
      'div',
      'span',
      'p',
      'br',
      'hr',
      // Headings
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      // Text formatting
      'strong',
      'em',
      'b',
      'i',
      'u',
      's',
      'mark',
      'small',
      'sub',
      'sup',
      'code',
      'kbd',
      'samp',
      'var',
      'abbr',
      'cite',
      'del',
      'ins',
      // Links and navigation
      'a',
      'nav',
      // Lists
      'ul',
      'ol',
      'li',
      'dl',
      'dt',
      'dd',
      // Tables
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'th',
      'td',
      'caption',
      'colgroup',
      'col',
      // Media
      'img',
      'video',
      'audio',
      'source',
      'iframe',
      // Code blocks
      'pre',
      // Sections and layout
      'article',
      'section',
      'header',
      'footer',
      'aside',
      'main',
      // Interactive documentation features
      'details',
      'summary',
      'blockquote',
      'figure',
      'figcaption',
      // Forms (used in interactive tutorials)
      'form',
      'input',
      'textarea',
      'select',
      'option',
      'optgroup',
      'button',
      'label',
      'fieldset',
      'legend',
      // SVG (for embedded graphics in docs)
      'svg',
      'path',
      'circle',
      'rect',
      'line',
      'ellipse',
      'polygon',
      'polyline',
      'g',
      'defs',
      'use',
      'text',
      // Custom documentation elements (actually used)
      'badge',
      'badge-tooltip',
    ],

    // Allowlist of attributes - strict list of actually used attributes
    ALLOWED_ATTR: [
      // Standard HTML attributes
      'id',
      'class',
      'title',
      'lang',
      'dir',
      // Link attributes
      'href',
      'target',
      'rel',
      'download',
      // Media attributes
      'src',
      'alt',
      'width',
      'height',
      'poster',
      'controls',
      'autoplay',
      'loop',
      'muted',
      // Form attributes
      'type',
      'name',
      'value',
      'placeholder',
      'disabled',
      'checked',
      'selected',
      'readonly',
      'required',
      'rows',
      'cols',
      'min',
      'max',
      'step',
      'pattern',
      // Table attributes
      'colspan',
      'rowspan',
      'headers',
      'scope',
      // Essential ARIA attributes (commonly used in Grafana docs)
      'role',
      'aria-label',
      'aria-labelledby',
      'aria-describedby',
      'aria-hidden',
      'aria-expanded',
      'aria-controls',
      'aria-live',
      // Basic SVG attributes (for simple graphics in docs)
      'viewBox',
      'fill',
      'stroke',
      'd',
      'cx',
      'cy',
      'r',
      'x',
      'y',
      'transform',
      'xmlns',
      // Badge/Tooltip custom element attributes
      'text',
      'color',
      'icon',
      'tooltip',
      // Iframe attributes (security-controlled via hooks)
      'frameborder',
      'allowfullscreen',
      'allow',
      'sandbox',
      'referrerpolicy',
      'loading',
      // ALL data-* attributes used in the codebase (explicit allowlist approach)
      // Interactive step/section attributes
      'data-targetaction',
      'data-reftarget',
      'data-targetvalue',
      'data-targetcomment',
      'data-showme',
      'data-doit',
      'data-showme-text',
      'data-skippable',
      'data-requirements',
      'data-objectives',
      'data-hint',
      'data-verify',
      'data-step-timeout',
      'data-button-type',
      'data-section-id',
      'data-step-id',
      // UI component attributes
      'data-element',
      'data-key',
      'data-label',
      // Media attributes
      'data-src',
      // Navigation and journey control
      'data-journey-start',
      'data-milestone-url',
      'data-journey-nav',
      'data-side-journey-link',
      'data-related-journey-link',
      // System markers
      'data-pathfinder-content',
      'data-testid',
      'data-cy',
    ],

    // Also keep ALLOW_DATA_ATTR for any new attributes tutorial creators add
    ALLOW_DATA_ATTR: true,

    // Allow aria-* attributes
    ALLOW_ARIA_ATTR: true,

    // Allow unknown protocols in data attributes (for CSS selectors like :has(), :contains())
    // This is safe because data-* attributes don't execute code, only hold selector strings
    ALLOW_UNKNOWN_PROTOCOLS: true,

    // Keep safe URI schemes (block javascript:, data: for iframes, etc.)
    ALLOWED_URI_REGEXP:
      /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|data|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,

    // Forbid dangerous iframe attributes
    FORBID_ATTR: ['srcdoc'], // srcdoc can contain XSS payloads

    // Additional security settings
    SAFE_FOR_TEMPLATES: true,
    WHOLE_DOCUMENT: false,
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
    RETURN_TRUSTED_TYPE: false,
    FORCE_BODY: false,
    SANITIZE_DOM: true,
    KEEP_CONTENT: true,
    IN_PLACE: false,
  };

  // Hook to enforce security attributes on iframes and links
  // This is the DOMPurify recommended pattern for conditional attribute modification
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    // Enforce rel="noopener noreferrer" on all links with target="_blank"
    // Prevents tab-nabbing attacks
    if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
      node.setAttribute('rel', 'noopener noreferrer');
    }

    // Enforce strict iframe security with YouTube-specific exception
    if (node.tagName === 'IFRAME') {
      const src = node.getAttribute('src');

      if (!src) {
        // Iframe without src is invalid - remove it
        node.remove();
        return;
      }

      // Validate video platform domains using proper URL parsing
      // This prevents domain hijacking attacks like youtube.com.evil.com
      const isYouTube = isYouTubeDomain(src);
      const isVimeo = isVimeoDomain(src);

      if (isYouTube || isVimeo) {
        // SECURITY: Trusted video platforms - allow without sandbox restrictions
        // These platforms need scripts to function (video player, analytics, etc.)

        if (isYouTube) {
          // YouTube iframes: Add enablejsapi parameter for analytics if not present
          if (!src.includes('enablejsapi=1')) {
            const separator = src.includes('?') ? '&' : '?';
            node.setAttribute('src', `${src}${separator}enablejsapi=1`);
          }
        }
        // Note: Vimeo iframes work as-is, no special parameters needed

        // SECURITY: Don't set referrerpolicy for video platforms - let browser use default
        // Setting no-referrer causes playback errors (YouTube error 153, Vimeo similar)
        // Browser default (usually strict-origin-when-cross-origin) is sufficient
      } else {
        // Non-video platform iframes: Maximum security restrictions (Grafana pattern)
        // SECURITY: Empty sandbox="" = most restrictive (no scripts, no forms, no plugins, etc.)
        // Note: The HTML parser preserves this empty string value correctly for React rendering
        node.setAttribute('sandbox', '');
        node.setAttribute('referrerpolicy', 'no-referrer');
      }
    }
  });

  try {
    const sanitized = DOMPurify.sanitize(html, config);

    // Remove the hook to prevent affecting other sanitization operations
    DOMPurify.removeHook('afterSanitizeAttributes');

    if (typeof sanitized !== 'string') {
      throw new Error('DOMPurify did not return a string');
    }

    return sanitized;
  } catch (error) {
    // Remove hook on error too
    DOMPurify.removeHook('afterSanitizeAttributes');

    throw new Error(`HTML sanitization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Sanitizes text fields from external APIs (e.g., recommender service).
 * Strips all HTML tags and returns plain text to prevent XSS injection.
 * Use this for fields like title, summary, description from untrusted sources.
 *
 * @param text - Text that may contain HTML tags
 * @returns Plain text with all HTML stripped
 */
export function sanitizeTextForDisplay(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  // Use DOMPurify with ALLOWED_TAGS: [] to strip all HTML
  // This is the recommended approach for text-only sanitization
  const sanitized = DOMPurify.sanitize(text, {
    ALLOWED_TAGS: [], // No HTML tags allowed
    ALLOWED_ATTR: [], // No attributes allowed
    KEEP_CONTENT: true, // Keep text content
  });

  return sanitized.trim();
}
