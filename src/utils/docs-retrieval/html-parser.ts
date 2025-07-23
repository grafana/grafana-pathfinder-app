// HTML Parser for React Component Tree Conversion
// Converts raw HTML into structured data that can be rendered as React components

export interface ParsedElement {
  type: string;
  props: Record<string, any>;
  children: Array<ParsedElement | string>;
  originalHTML?: string; // Keep original HTML for fallback
}

export interface ParsedContent {
  elements: ParsedElement[];
  hasInteractiveElements: boolean;
  hasCodeBlocks: boolean;
  hasExpandableTables: boolean;
  hasImages: boolean;
}

/**
 * Safe attribute mapping for React props
 * Filters out invalid attributes and maps HTML attributes to React props
 */
function mapHtmlAttributesToReactProps(element: Element): Record<string, any> {
  const props: Record<string, any> = {};
  
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
    }
  }

  return props;
}

/**
 * Main HTML parser that identifies special patterns and converts them to React component data
 * Handles interactive elements, code blocks, expandable tables, images, and other special content
 */
export function parseHTMLToComponents(html: string, baseUrl?: string): ParsedContent {
    const parser = new DOMParser();
    // Always parse as a fragment (prevents html/body wrapping).
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const root = doc.body.firstElementChild!;
  
    const elements: ParsedElement[] = [];
    let hasInteractiveElements = false;
    let hasCodeBlocks = false;
    let hasExpandableTables = false;
    let hasImages = false;
  
    function walk(node: Element | ChildNode): ParsedElement | string | null {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? '';
        return text.trim() ? text : null;
      }
  
      // Handle element nodes
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        const tag = el.tagName.toLowerCase();

        // Skip problematic elements that often cause React issues
        if (['script', 'style', 'meta', 'link', 'base'].includes(tag)) {
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
  
        // CODE BLOCK: <pre> (convert all pre elements to CodeBlock components)
        if (tag === 'pre') {
          hasCodeBlocks = true;
          const codeEl = el.querySelector('code');
          const code = codeEl ? codeEl.textContent : el.textContent;
          
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
          stepNodes.forEach((stepEl) => {
            const step = walk(stepEl);
            if (step && typeof step !== 'string') stepElements.push(step);
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
          return {
            type: 'interactive-step',
            props: {
              targetAction: el.getAttribute('data-targetaction'),
              refTarget: el.getAttribute('data-reftarget'),
              targetValue: el.getAttribute('data-targetvalue'),
              requirements: el.getAttribute('data-requirements'),
              outcomes: el.getAttribute('data-outcomes'),
              title: el.textContent?.trim(),
            },
            children: [],
            originalHTML: el.outerHTML,
          };
        }
  
        // Otherwise, recursively walk children for normal HTML elements
        const children: Array<ParsedElement | string> = [];
        el.childNodes.forEach((child) => {
          const walked = walk(child);
          if (walked) children.push(walked);
        });

        // Use safe attribute mapping for standard HTML elements
        const safeProps = mapHtmlAttributesToReactProps(el);
  
        // Render as standard HTML element (div, p, h2, etc)
        return {
          type: tag,
          props: safeProps,
          children,
          originalHTML: el.outerHTML,
        };
      }
  
      return null;
    }
  
    // Walk top-level children of root (the wrapping <div>)
    root.childNodes.forEach((child) => {
        const res = walk(child);
        if (res && typeof res !== "string") elements.push(res);
      });
  
    // Fallback: if nothing parsed, show raw HTML
    if (elements.length === 0) {
      elements.push({
        type: 'raw-html',
        props: { html },
        children: [],
        originalHTML: html,
      });
    }
  
    return {
      elements,
      hasInteractiveElements,
      hasCodeBlocks,
      hasExpandableTables,
      hasImages,
    };
  }
  
