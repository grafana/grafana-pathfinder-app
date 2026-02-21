// HTML Parser for React Component Tree Conversion
// Converts raw HTML into structured data that can be rendered as React components
// Implements fail-fast principle with proper error propagation
// SECURITY: All HTML is sanitized with DOMPurify before parsing

import { ParseError, ParseResult, ParsedElement, ParsedContent, ContentParseResult } from '../types/content.types';
import { sanitizeDocumentationHTML } from '../security';

// Re-export for convenience
export type { ParsedElement, ParsedContent };

/**
 * Error collection utility for parsing operations
 */
class ParsingErrorCollector {
  private errors: ParseError[] = [];
  private warnings: string[] = [];

  addError(
    type: ParseError['type'],
    message: string,
    element?: string,
    location?: string,
    originalError?: Error
  ): void {
    this.errors.push({
      type,
      message,
      element: element?.substring(0, 200), // Limit element size for readability
      location,
      originalError,
    });
  }

  addWarning(message: string): void {
    this.warnings.push(message);
  }

  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  getResult<T>(data?: T): ParseResult<T> {
    return {
      isValid: !this.hasErrors(),
      data,
      errors: this.errors,
      warnings: this.warnings,
    };
  }
}

/**
 * Maps HTML attributes to React props
 *
 * SECURITY NOTE: This function assumes HTML has already been sanitized by DOMPurify.
 * It only handles React-specific transformations (e.g., class → className).
 * No security validation is performed here - that's DOMPurify's job.
 */
function mapHtmlAttributesToReactProps(element: Element, errorCollector: ParsingErrorCollector): Record<string, any> {
  const props: Record<string, any> = {};

  try {
    // HTML to React attribute mapping (React-specific naming)
    const attributeMap: Record<string, string> = {
      class: 'className',
      for: 'htmlFor',
      tabindex: 'tabIndex',
      contenteditable: 'contentEditable',
      spellcheck: 'spellCheck',
      readonly: 'readOnly',
      maxlength: 'maxLength',
      cellpadding: 'cellPadding',
      cellspacing: 'cellSpacing',
      rowspan: 'rowSpan',
      colspan: 'colSpan',
      usemap: 'useMap',
      frameborder: 'frameBorder',
      allowfullscreen: 'allowFullScreen',
    };

    // Attributes that should be skipped (React doesn't need these)
    const skipAttributes = new Set([
      'style', // Could be handled separately if needed in future
    ]);

    for (const attr of element.attributes) {
      try {
        const attrName = attr.name.toLowerCase();
        const attrValue = attr.value;

        // Skip attributes React doesn't need
        if (skipAttributes.has(attrName)) {
          continue;
        }

        // data-* and aria-* attributes pass through as-is (React accepts them)
        if (attrName.startsWith('data-') || attrName.startsWith('aria-')) {
          props[attrName] = attrValue;
          continue;
        }

        // Map HTML attribute names to React prop names
        const reactPropName = attributeMap[attrName] || attrName;

        // SECURITY (F6): Preserve empty string for sandbox attribute
        // Empty sandbox="" means maximum restrictions, not a boolean true
        // Other enumerated attributes that use empty strings meaningfully
        const preserveEmptyString = new Set(['sandbox']);

        // Convert boolean attributes for React (e.g., disabled="" → disabled={true})
        // But preserve empty strings for attributes where they have specific meaning
        if ((attrValue === '' || attrValue === attrName) && !preserveEmptyString.has(attrName)) {
          props[reactPropName] = true;
        } else {
          props[reactPropName] = attrValue;
        }
      } catch (error) {
        errorCollector.addError(
          'attribute_mapping',
          `Failed to process attribute '${attr.name}': ${error instanceof Error ? error.message : 'Unknown error'}`,
          element.outerHTML,
          'mapHtmlAttributesToReactProps',
          error instanceof Error ? error : undefined
        );
      }
    }
  } catch (error) {
    errorCollector.addError(
      'attribute_mapping',
      `Failed to map attributes for element: ${error instanceof Error ? error.message : 'Unknown error'}`,
      element.outerHTML,
      'mapHtmlAttributesToReactProps',
      error instanceof Error ? error : undefined
    );
  }

  return props;
}

/**
 * Main HTML parser with fail-fast error collection
 * Either succeeds completely or provides meaningful error information
 *
 * @param html - HTML string to parse
 * @param baseUrl - Source URL for relative path resolution
 */
export function parseHTMLToComponents(html: string, baseUrl?: string): ContentParseResult {
  const errorCollector = new ParsingErrorCollector();

  // Validate input
  if (!html || typeof html !== 'string') {
    errorCollector.addError('html_parsing', 'Invalid HTML input: must be a non-empty string', html);
    return errorCollector.getResult<ParsedContent>();
  }

  // SECURITY: Sanitize HTML before parsing - no fallback on failure
  // This prevents XSS attacks by removing malicious content before DOM parsing
  let sanitizedHtml: string;
  try {
    sanitizedHtml = sanitizeDocumentationHTML(html);
  } catch (error) {
    errorCollector.addError(
      'html_sanitization',
      `HTML sanitization failed - content rejected for security reasons: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
      html.substring(0, 200),
      'sanitizeDocumentationHTML',
      error instanceof Error ? error : undefined
    );
    return errorCollector.getResult<ParsedContent>();
  }

  let doc: Document;
  let root: Element;

  try {
    const parser = new DOMParser();
    // Always parse as a fragment (prevents html/body wrapping)
    // Use sanitized HTML instead of raw input
    doc = parser.parseFromString(`<div>${sanitizedHtml}</div>`, 'text/html');

    // Check for parsing errors
    const parserErrors = doc.querySelectorAll('parsererror');
    if (parserErrors.length > 0) {
      errorCollector.addError(
        'html_parsing',
        `DOM parser found ${parserErrors.length} error(s) in HTML`,
        html.substring(0, 200),
        'DOMParser'
      );
      return errorCollector.getResult<ParsedContent>();
    }

    root = doc.body.firstElementChild!;
    if (!root) {
      errorCollector.addError('html_parsing', 'Failed to create document root element', html);
      return errorCollector.getResult<ParsedContent>();
    }
  } catch (error) {
    errorCollector.addError(
      'html_parsing',
      `Failed to parse HTML: ${error instanceof Error ? error.message : 'Unknown error'}`,
      html.substring(0, 200),
      'DOMParser',
      error instanceof Error ? error : undefined
    );
    return errorCollector.getResult<ParsedContent>();
  }

  const elements: ParsedElement[] = [];
  let hasInteractiveElements = false;
  let hasCodeBlocks = false;
  let hasExpandableTables = false;
  let hasImages = false;
  let hasVideos = false;
  let hasAssistantElements = false;

  function walk(node: Element | ChildNode, path = 'root'): ParsedElement | string | null {
    try {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? '';
        // Preserve whitespace but filter out completely empty nodes
        return text.length > 0 ? text : null;
      }

      // Handle element nodes
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        const tag = el.tagName.toLowerCase();
        const currentPath = `${path}.${tag}`;

        // Skip elements that don't belong in body content (React compatibility)
        // SECURITY NOTE: DOMPurify has already stripped dangerous content like <script>
        // This check is for React rendering compatibility, not security
        if (['script', 'style', 'meta', 'link', 'base'].includes(tag)) {
          errorCollector.addWarning(`Skipping ${tag} element (not suitable for content rendering)`);
          return null;
        }

        // IMAGE: <img>
        if (tag === 'img') {
          hasImages = true;
          // Get all attributes using the safe mapping function
          const imgProps = mapHtmlAttributesToReactProps(el, errorCollector);

          return {
            type: 'image-renderer',
            props: {
              src: el.getAttribute('src') ?? undefined,
              dataSrc: el.getAttribute('data-src') ?? undefined,
              alt: el.getAttribute('alt') ?? undefined,
              width: el.getAttribute('width') ?? undefined,
              height: el.getAttribute('height') ?? undefined,
              className: el.getAttribute('class') ?? undefined,
              title: el.getAttribute('title') ?? undefined,
              baseUrl,
              // Include all other attributes (including data-* attributes)
              ...imgProps,
            },
            children: [],
            originalHTML: el.outerHTML,
          };
        }

        // VIDEO: <video>
        if (tag === 'video') {
          hasVideos = true;
          // Get all attributes using the safe mapping function
          const videoProps = mapHtmlAttributesToReactProps(el, errorCollector);

          return {
            type: 'video',
            props: {
              src: el.getAttribute('src') ?? undefined,
              baseUrl,
              // Include all other attributes (including data-* attributes)
              ...videoProps,
            },
            children: [],
            originalHTML: el.outerHTML,
          };
        }

        // YOUTUBE IFRAME: <iframe> with YouTube src
        if (tag === 'iframe') {
          const src = el.getAttribute('src') ?? '';
          const isYouTube = src.includes('youtube.com') || src.includes('youtu.be');

          if (isYouTube) {
            hasVideos = true;
            // Get all attributes using the safe mapping function
            const iframeProps = mapHtmlAttributesToReactProps(el, errorCollector);

            return {
              type: 'youtube-video',
              props: {
                src,
                width: el.getAttribute('width') ?? undefined,
                height: el.getAttribute('height') ?? undefined,
                title: el.getAttribute('title') ?? undefined,
                className: el.getAttribute('class') ?? undefined,
                // Include all other attributes (including data-* attributes)
                ...iframeProps,
              },
              children: [],
              originalHTML: el.outerHTML,
            };
          }

          // For non-YouTube iframes, render as regular iframe
          const iframeProps = mapHtmlAttributesToReactProps(el, errorCollector);
          return {
            type: 'iframe',
            props: iframeProps,
            children: [],
            originalHTML: el.outerHTML,
          };
        }

        // CODE BLOCK: <pre>
        if (tag === 'pre') {
          hasCodeBlocks = true;

          // Check if this pre contains an assistant element
          const assistantEl = el.querySelector('assistant');

          if (assistantEl) {
            // This is an assistant-customizable code block
            hasAssistantElements = true;
            const defaultValue = assistantEl.textContent?.trim() || '';
            const assistantId = assistantEl.getAttribute('data-assistant-id') || `assistant-${path}`;
            const assistantType = assistantEl.getAttribute('data-assistant-type') || 'query';

            return {
              type: 'assistant-customizable',
              props: {
                defaultValue,
                assistantId,
                assistantType,
                inline: false, // Pre blocks are always block mode
              },
              children: [],
              originalHTML: el.outerHTML,
            };
          }

          // Regular code block (no assistant element)
          const codeEl = el.querySelector('code');
          const code = codeEl ? codeEl.textContent : el.textContent;

          if (!code) {
            errorCollector.addWarning(`Empty code block found at ${currentPath}`);
          }

          // Try to detect language from class names
          const languageMatch =
            (el.className || '').match(/language-([^\s"]+)/) || (codeEl?.className || '').match(/language-([^\s"]+)/);

          return {
            type: 'code-block',
            props: {
              code: code?.trim() ?? '',
              language: languageMatch ? languageMatch[1] : undefined,
              showCopy: true,
              inline: false,
            },
            children: [],
            originalHTML: el.outerHTML,
          };
        }

        // INLINE CODE: <code> (not inside pre)
        if (tag === 'code' && el.parentElement?.tagName.toLowerCase() !== 'pre') {
          hasCodeBlocks = true;
          const code = el.textContent;

          // Try to detect language from class names
          const languageMatch = (el.className || '').match(/language-([^\s"]+)/);

          return {
            type: 'code-block',
            props: {
              code: code?.trim() ?? '',
              language: languageMatch ? languageMatch[1] : undefined,
              showCopy: true,
              inline: true,
            },
            children: [],
            originalHTML: el.outerHTML,
          };
        }

        // EXPANDABLE TABLE: <div class="expand-table-wrapper">
        if (tag === 'div' && /\bexpand-table-wrapper\b/.test(el.className || '')) {
          hasExpandableTables = true;

          // Parse children as React components instead of raw HTML
          const children: Array<ParsedElement | string> = [];
          el.childNodes.forEach((child, index) => {
            try {
              const walked = walk(child, `${currentPath}.expand-table-wrapper[${index}]`);
              if (walked) {
                children.push(walked);
              }
            } catch (error) {
              errorCollector.addError(
                'children_processing',
                `Failed to process expandable table child ${index}: ${
                  error instanceof Error ? error.message : 'Unknown error'
                }`,
                child.nodeType === Node.ELEMENT_NODE
                  ? (child as Element).outerHTML
                  : child.textContent?.substring(0, 100),
                `${currentPath}.expand-table-wrapper[${index}]`,
                error instanceof Error ? error : undefined
              );
            }
          });

          return {
            type: 'expandable-table',
            props: {
              defaultCollapsed: false,
              toggleText: undefined,
            },
            children,
            originalHTML: el.outerHTML,
          };
        }

        // BADGE: <badge>
        if (tag === 'badge') {
          const text = el.getAttribute('text') || el.textContent?.trim() || '';
          const color = el.getAttribute('color') || 'blue';
          const icon = el.getAttribute('icon') || undefined;

          return {
            type: 'badge',
            props: {
              text,
              color,
              icon,
            },
            children: [],
            originalHTML: el.outerHTML,
          };
        }

        // BADGE-TOOLTIP: <badge-tooltip>
        if (tag === 'badge-tooltip') {
          const text = el.getAttribute('text') || el.textContent?.trim() || '';
          const color = el.getAttribute('color') || 'blue';
          const icon = el.getAttribute('icon') || undefined;
          const tooltip = el.getAttribute('tooltip') || undefined;

          return {
            type: 'badge-tooltip',
            props: {
              text,
              color,
              icon,
              tooltip,
            },
            children: [],
            originalHTML: el.outerHTML,
          };
        }

        // ASSISTANT CUSTOMIZABLE: <assistant>
        if (tag === 'assistant') {
          hasAssistantElements = true;
          const defaultValue = el.textContent?.trim() || '';
          const assistantId = el.getAttribute('data-assistant-id') || `assistant-${path}`;
          const assistantType = el.getAttribute('data-assistant-type') || 'query';

          // Auto-detect inline vs block based on content
          const inline = !el.querySelector('pre, code') && defaultValue.length < 100;

          return {
            type: 'assistant-customizable',
            props: {
              defaultValue,
              assistantId,
              assistantType,
              inline,
            },
            children: [],
            originalHTML: el.outerHTML,
          };
        }

        // COLLAPSIBLE SECTION: <div class="collapse"> (but not collapse-content, collapse-trigger, etc.)
        if (
          tag === 'div' &&
          el.classList.contains('collapse') && // More specific than regex
          !el.classList.contains('collapse-content') && // Don't match collapse-content
          !el.classList.contains('collapse-trigger') && // Don't match collapse-trigger
          !el.classList.contains('collapse-section') && // Don't match our own generated class
          !/\binteractive\b/.test(el.className || '') // Don't interfere with interactive elements
        ) {
          hasExpandableTables = true;
          const triggerEl = el.querySelector('.collapse-trigger');
          const contentEl = el.querySelector('.collapse-content');

          let toggleText = 'Toggle section';
          if (triggerEl) {
            // Extract text from trigger, excluding icon text
            const triggerTextEl = triggerEl.querySelector('span:first-child') || triggerEl;
            toggleText = triggerTextEl.textContent?.trim() || 'Toggle section';
          }

          // Parse the content as React components instead of raw HTML
          const children: Array<ParsedElement | string> = [];
          if (contentEl) {
            contentEl.childNodes.forEach((child, index) => {
              try {
                const walked = walk(child, `${currentPath}.collapse-content[${index}]`);
                if (walked) {
                  children.push(walked);
                }
              } catch (error) {
                errorCollector.addError(
                  'children_processing',
                  `Failed to process collapse content child ${index}: ${
                    error instanceof Error ? error.message : 'Unknown error'
                  }`,
                  child.nodeType === Node.ELEMENT_NODE
                    ? (child as Element).outerHTML
                    : child.textContent?.substring(0, 100),
                  `${currentPath}.collapse-content[${index}]`,
                  error instanceof Error ? error : undefined
                );
              }
            });
          }

          return {
            type: 'expandable-table',
            props: {
              // Don't pass content as HTML string anymore
              defaultCollapsed: true, // Most collapse sections start collapsed
              toggleText,
              isCollapseSection: true, // Use a boolean flag instead of className
            },
            children, // Pass parsed children instead
            originalHTML: el.outerHTML,
          };
        }

        // NOTE: Interactive HTML parsing (class="interactive" + data-targetaction) was removed
        // in this commit. Interactive elements are now only produced by the JSON parser path
        // (json-parser.ts). HTML containing these attributes falls through to the generic
        // element handler below and renders as plain HTML. See REMOVE-HTML-DYNAMICS.md.

        // Process children for normal HTML elements
        const children: Array<ParsedElement | string> = [];
        el.childNodes.forEach((child, index) => {
          try {
            const walked = walk(child, `${currentPath}[${index}]`);
            if (walked) {
              children.push(walked);
            }
          } catch (error) {
            errorCollector.addError(
              'children_processing',
              `Failed to process child ${index}: ${error instanceof Error ? error.message : 'Unknown error'}`,
              child.nodeType === Node.ELEMENT_NODE
                ? (child as Element).outerHTML
                : child.textContent?.substring(0, 100),
              `${currentPath}[${index}]`,
              error instanceof Error ? error : undefined
            );
          }
        });

        // Use safe attribute mapping for standard HTML elements
        const safeProps = mapHtmlAttributesToReactProps(el, errorCollector);

        // Render as standard HTML element (div, p, h2, etc)
        return {
          type: tag,
          props: safeProps,
          children,
          originalHTML: el.outerHTML,
        };
      }

      return null;
    } catch (error) {
      errorCollector.addError(
        'element_creation',
        `Failed to process node: ${error instanceof Error ? error.message : 'Unknown error'}`,
        node.nodeType === Node.ELEMENT_NODE ? (node as Element).outerHTML : node.textContent?.substring(0, 100),
        path,
        error instanceof Error ? error : undefined
      );
      return null;
    }
  }

  // Walk top-level children of root
  try {
    root.childNodes.forEach((child, index) => {
      try {
        const res = walk(child, `root[${index}]`);
        if (res && typeof res !== 'string') {
          elements.push(res);
        }
      } catch (error) {
        errorCollector.addError(
          'element_creation',
          `Failed to process top-level element ${index}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          child.nodeType === Node.ELEMENT_NODE ? (child as Element).outerHTML : child.textContent?.substring(0, 100),
          `root[${index}]`,
          error instanceof Error ? error : undefined
        );
      }
    });
  } catch (error) {
    errorCollector.addError(
      'html_parsing',
      `Failed to walk DOM tree: ${error instanceof Error ? error.message : 'Unknown error'}`,
      root.outerHTML.substring(0, 200),
      'walk',
      error instanceof Error ? error : undefined
    );
  }

  // Fail-fast: if we have critical errors and no elements, don't provide fallback
  if (errorCollector.hasErrors() && elements.length === 0) {
    return errorCollector.getResult<ParsedContent>();
  }

  // Success case: return parsed content
  const parsedContent: ParsedContent = {
    elements,
    hasInteractiveElements,
    hasCodeBlocks,
    hasExpandableTables,
    hasImages,
    hasVideos,
    hasAssistantElements,
  };

  return errorCollector.getResult(parsedContent);
}
