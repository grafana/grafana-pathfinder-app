/**
 * Node View Factory
 *
 * Factory functions for creating node views with interactive elements.
 * All interactive nodes display a lightning bolt (⚡) indicator that users can click to edit attributes.
 *
 * ## Usage
 *
 * - `createListItemNodeView`: For interactive list items (<li>)
 * - `createSpanNodeView`: For inline interactive spans (<span>)
 * - `createSequenceSectionNodeView`: For block-level sequence sections (span with block content)
 * - `createInteractiveNodeView`: Generic factory for custom node types
 *
 * ## Lightning Bolt Behavior
 *
 * The lightning bolt is conditionally shown based on:
 * - For list items: Only shown if the item has class="interactive"
 * - For spans and sequences: Always shown (configurable)
 */

// SECURITY: Allowlist of safe HTML attributes to prevent event handler injection (F5)
// Only these attributes can be set on interactive elements
const ALLOWED_ATTRIBUTES = [
  'class',
  'id',
  'data-targetaction',
  'data-reftarget',
  'data-requirements',
  'data-doit',
  'role',
  'tabindex',
  'aria-label',
] as const;

export interface NodeViewConfig {
  tagName: keyof HTMLElementTagNameMap;
  showLightning?: boolean;
  contentDisplay?: 'contents' | 'inline' | 'block';
}

/**
 * Creates a lightning bolt element for interactive nodes
 * Now keyboard accessible with proper ARIA attributes
 */
export function createLightningBolt(): HTMLSpanElement {
  const lightning = document.createElement('span');
  lightning.className = 'interactive-lightning';
  lightning.textContent = '⚡';

  // Make keyboard accessible
  lightning.setAttribute('role', 'button');
  lightning.setAttribute('tabindex', '0');
  lightning.setAttribute('aria-label', 'Edit interactive settings');

  // Add keyboard event handler for Enter and Space keys
  lightning.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      // Trigger a click event which will be handled by the InteractiveClickHandler
      lightning.click();
    }
  });

  return lightning;
}

/**
 * Applies HTML attributes to a DOM element
 * SECURITY: Only allows attributes from ALLOWED_ATTRIBUTES to prevent event handler injection (F5)
 */
export function applyAttributes(element: HTMLElement, attributes: Record<string, any>): void {
  Object.entries(attributes).forEach(([key, value]) => {
    // SECURITY: Filter attributes against allowlist to prevent event handler injection (F5)
    if (value !== null && value !== undefined && ALLOWED_ATTRIBUTES.includes(key as any)) {
      element.setAttribute(key, String(value));
    }
  });
}

/**
 * Creates an interactive node view with lightning bolt indicator
 * @param config - Configuration for the node view
 * @param attributes - HTML attributes to apply
 * @param shouldShowLightning - Function to determine if lightning should be shown
 */
export function createInteractiveNodeView(
  config: NodeViewConfig,
  attributes: Record<string, any>,
  shouldShowLightning?: (attrs: Record<string, any>) => boolean
): { dom: HTMLElement; contentDOM: HTMLElement } {
  const { tagName, contentDisplay = 'contents' } = config;

  const dom = document.createElement(tagName);
  applyAttributes(dom, attributes);

  // Determine if we should show the lightning bolt
  const showLightning = shouldShowLightning ? shouldShowLightning(attributes) : config.showLightning !== false;

  if (showLightning) {
    const lightning = createLightningBolt();
    dom.appendChild(lightning);
  }

  // Create content wrapper
  const contentDOM = document.createElement(tagName === 'li' || tagName === 'span' ? 'div' : 'span');

  if (contentDisplay === 'contents') {
    contentDOM.style.display = 'contents';
  } else if (contentDisplay === 'inline') {
    contentDOM.style.display = 'inline';
  }

  dom.appendChild(contentDOM);

  return { dom, contentDOM };
}

/**
 * Creates a node view specifically for list items
 */
export function createListItemNodeView(attributes: Record<string, any>): { dom: HTMLElement; contentDOM: HTMLElement } {
  return createInteractiveNodeView(
    { tagName: 'li', contentDisplay: 'contents' },
    attributes,
    (attrs) => attrs.class?.includes('interactive')
  );
}

/**
 * Configuration for span-based node views
 */
export interface SpanNodeViewConfig {
  showLightning?: boolean;
  contentTag?: 'span' | 'div';
  contentDisplay?: 'inline' | 'contents';
}

/**
 * Creates a unified node view for span-based elements
 * Consolidates createSpanNodeView and createSequenceSectionNodeView
 *
 * @param attributes - HTML attributes to apply
 * @param config - Configuration options
 */
export function createSpanNodeView(
  attributes: Record<string, any>,
  config: SpanNodeViewConfig | boolean = {}
): { dom: HTMLElement; contentDOM: HTMLElement } {
  // Handle legacy boolean parameter (showLightning)
  const finalConfig: SpanNodeViewConfig =
    typeof config === 'boolean'
      ? { showLightning: config, contentTag: 'span', contentDisplay: 'inline' }
      : {
          showLightning: config.showLightning !== false,
          contentTag: config.contentTag || 'span',
          contentDisplay: config.contentDisplay || 'inline',
        };

  const dom = document.createElement('span');
  applyAttributes(dom, attributes);

  if (finalConfig.showLightning) {
    const lightning = createLightningBolt();
    dom.appendChild(lightning);
  }

  const contentDOM = document.createElement(finalConfig.contentTag || 'span');
  if (finalConfig.contentDisplay === 'contents') {
    contentDOM.style.display = 'contents';
  }
  dom.appendChild(contentDOM);

  return { dom, contentDOM };
}

/**
 * Creates a node view for sequence sections (block-level spans)
 * This is now a convenience wrapper around createSpanNodeView
 */
export function createSequenceSectionNodeView(
  attributes: Record<string, any>
): { dom: HTMLElement; contentDOM: HTMLElement } {
  return createSpanNodeView(attributes, {
    showLightning: true,
    contentTag: 'div',
    contentDisplay: 'contents',
  });
}

