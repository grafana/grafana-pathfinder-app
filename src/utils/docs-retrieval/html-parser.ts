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
  
        // CODE BLOCK: <pre><code>
        if (
          tag === 'pre' &&
          /(journey-code-block|docs-code-snippet|language-)/.test(el.className)
        ) {
          hasCodeBlocks = true;
          const codeEl = el.querySelector('code');
          const code = codeEl ? codeEl.textContent : el.textContent;
          const languageMatch = el.className.match(/language-([^\s"]+)/);
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
  
        // EXPANDABLE TABLE: <div class="expand-table-wrapper">
        if (
          tag === 'div' &&
          /\bexpand-table-wrapper\b/.test(el.className)
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
          /\binteractive\b/.test(el.className) &&
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
          /\binteractive\b/.test(el.className) &&
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
  
        // Render as standard HTML element (div, p, h2, etc)
        return {
          type: tag,
          props: Object.fromEntries(
            [...el.attributes].map((a) => [a.name === 'class' ? 'className' : a.name, a.value])
          ),
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
  
