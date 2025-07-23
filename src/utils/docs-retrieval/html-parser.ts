// HTML Parser for React Component Tree Conversion
// Converts raw HTML into structured data that can be rendered as React components
// Implements fail-fast principle with proper error propagation

import { ParseError, ParseResult, ParsedElement, ParsedContent, ContentParseResult } from './content.types';

// Re-export for convenience
export type { ParsedElement, ParsedContent };

/**
 * Error collection utility for parsing operations
 */
class ParsingErrorCollector {
  private errors: ParseError[] = [];
  private warnings: string[] = [];

  addError(type: ParseError['type'], message: string, element?: string, location?: string, originalError?: Error): void {
    this.errors.push({
      type,
      message,
      element: element?.substring(0, 200), // Limit element size for readability
      location,
      originalError
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
      warnings: this.warnings
    };
  }
}

/**
 * Safe attribute mapping for React props
 * Now with proper error collection instead of silent failures
 */
function mapHtmlAttributesToReactProps(element: Element, errorCollector: ParsingErrorCollector): Record<string, any> {
  const props: Record<string, any> = {};
  
  try {
    // HTML to React attribute mapping
    const attributeMap: Record<string, string> = {
      'class': 'className',
      'for': 'htmlFor',
      'tabindex': 'tabIndex',
      'contenteditable': 'contentEditable',
      'spellcheck': 'spellCheck',
      'readonly': 'readOnly',
      'maxlength': 'maxLength',
      'cellpadding': 'cellPadding',
      'cellspacing': 'cellSpacing',
      'rowspan': 'rowSpan',
      'colspan': 'colSpan',
      'usemap': 'useMap',
      'frameborder': 'frameBorder',
    };

    // Attributes that should be skipped or handled specially
    const skipAttributes = new Set([
      'style', // Will be handled separately if needed
      'xmlns', // Not needed in React
    ]);

    // Valid HTML attributes that React accepts
    const validAttributes = new Set([
      'id', 'title', 'lang', 'dir', 'role', 'aria-label', 'aria-describedby', 
      'aria-expanded', 'aria-hidden', 'aria-live', 'aria-atomic', 'aria-relevant',
      'href', 'target', 'rel', 'download', 'src', 'alt', 'width', 'height',
      'type', 'name', 'value', 'placeholder', 'disabled', 'checked', 'selected',
      'multiple', 'size', 'accept', 'autoComplete', 'autoFocus', 'required',
      'rows', 'cols', 'wrap', 'min', 'max', 'step', 'pattern',
    ]);

    for (const attr of element.attributes) {
      try {
        const attrName = attr.name.toLowerCase();
        const attrValue = attr.value;

        // Skip problematic attributes
        if (skipAttributes.has(attrName)) {
          continue;
        }

        // Handle data-* and aria-* attributes (React accepts these as-is)
        if (attrName.startsWith('data-') || attrName.startsWith('aria-')) {
          props[attrName] = attrValue;
          continue;
        }

        // Map HTML attributes to React props
        const reactPropName = attributeMap[attrName] || attrName;

        // Only include known valid attributes
        if (validAttributes.has(attrName) || attributeMap[attrName]) {
          // Convert boolean attributes
          if (attrValue === '' || attrValue === attrName) {
            props[reactPropName] = true;
          } else {
            props[reactPropName] = attrValue;
          }
        } else {
          errorCollector.addWarning(`Unknown HTML attribute '${attrName}' on ${element.tagName} element`);
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
 */
export function parseHTMLToComponents(html: string, baseUrl?: string): ContentParseResult {
  const errorCollector = new ParsingErrorCollector();
  
  // Validate input
  if (!html || typeof html !== 'string') {
    errorCollector.addError('html_parsing', 'Invalid HTML input: must be a non-empty string', html);
    return errorCollector.getResult<ParsedContent>();
  }

  let doc: Document;
  let root: Element;

  try {
    const parser = new DOMParser();
    // Always parse as a fragment (prevents html/body wrapping)
    doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    
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

  function walk(node: Element | ChildNode, path: string = 'root'): ParsedElement | string | null {
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

        // Skip problematic elements that often cause React issues
        if (['script', 'style', 'meta', 'link', 'base'].includes(tag)) {
          errorCollector.addWarning(`Skipping potentially problematic element: ${tag}`);
          return null;
        }

        // IMAGE: <img>
        if (tag === 'img') {
          hasImages = true;
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
            },
            children: [],
            originalHTML: el.outerHTML,
          };
        }

        // CODE BLOCK: <pre>
        if (tag === 'pre') {
          hasCodeBlocks = true;
          const codeEl = el.querySelector('code');
          const code = codeEl ? codeEl.textContent : el.textContent;
          
          if (!code) {
            errorCollector.addWarning(`Empty code block found at ${currentPath}`);
          }
          
          // Try to detect language from class names
          const languageMatch = (el.className || '').match(/language-([^\s"]+)/) || 
                                (codeEl?.className || '').match(/language-([^\s"]+)/);
          
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
        if (
          tag === 'div' &&
          /\bexpand-table-wrapper\b/.test(el.className || '')
        ) {
          hasExpandableTables = true;
          const table = el.querySelector('table');
          return {
            type: 'expandable-table',
            props: {
              content: table ? table.outerHTML : el.innerHTML,
              defaultCollapsed: false,
              toggleText: undefined,
            },
            children: [],
            originalHTML: el.outerHTML,
          };
        }

        // INTERACTIVE SECTION
        if (
          /\binteractive\b/.test(el.className || '') &&
          el.getAttribute('data-targetaction') === 'sequence'
        ) {
          hasInteractiveElements = true;
          const titleEl = el.querySelector('h1,h2,h3,h4,h5,h6');
          const title = titleEl ? titleEl.textContent?.trim() : 'Interactive Section';
          const stepNodes = el.querySelectorAll('li.interactive[data-targetaction]');
          const stepElements: ParsedElement[] = [];
          
          stepNodes.forEach((stepEl, index) => {
            try {
              const step = walk(stepEl, `${currentPath}.step[${index}]`);
              if (step && typeof step !== 'string') stepElements.push(step);
            } catch (error) {
              errorCollector.addError(
                'children_processing',
                `Failed to process interactive step ${index}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                stepEl.outerHTML,
                `${currentPath}.step[${index}]`,
                error instanceof Error ? error : undefined
              );
            }
          });
          
          return {
            type: 'interactive-section',
            props: {
              title,
              isSequence: true,
              requirements: el.getAttribute('data-requirements'),
              outcomes: el.getAttribute('data-outcomes'),
            },
            children: stepElements,
            originalHTML: el.outerHTML,
          };
        }

        // INTERACTIVE STEP (outside of section)
        if (
          /\binteractive\b/.test(el.className || '') &&
          el.getAttribute('data-targetaction') &&
          el.getAttribute('data-targetaction') !== 'sequence'
        ) {
          hasInteractiveElements = true;
          
          // Validate required attributes for interactive elements
          const targetAction = el.getAttribute('data-targetaction');
          const refTarget = el.getAttribute('data-reftarget');
          
          if (!refTarget) {
            errorCollector.addError(
              'element_creation',
              `Interactive element missing required 'data-reftarget' attribute`,
              el.outerHTML,
              currentPath
            );
          }
          
          return {
            type: 'interactive-step',
            props: {
              targetAction,
              refTarget,
              targetValue: el.getAttribute('data-targetvalue'),
              requirements: el.getAttribute('data-requirements'),
              outcomes: el.getAttribute('data-outcomes'),
              title: el.textContent?.trim(),
            },
            children: [],
            originalHTML: el.outerHTML,
          };
        }

        // Process children for normal HTML elements
        const children: Array<ParsedElement | string> = [];
        el.childNodes.forEach((child, index) => {
          try {
            const walked = walk(child, `${currentPath}[${index}]`);
            if (walked) children.push(walked);
          } catch (error) {
            errorCollector.addError(
              'children_processing',
              `Failed to process child ${index}: ${error instanceof Error ? error.message : 'Unknown error'}`,
              child.nodeType === Node.ELEMENT_NODE ? (child as Element).outerHTML : child.textContent?.substring(0, 100),
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
        if (res && typeof res !== "string") elements.push(res);
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
  };

  return errorCollector.getResult(parsedContent);
}
  
