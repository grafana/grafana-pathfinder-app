/**
 * Node View Factory
 *
 * Factory functions for creating node views with interactive elements.
 * Each interactive node displays an action-specific emoji indicator that users can click to edit attributes.
 *
 * ## Usage
 *
 * - `createListItemNodeView`: For interactive list items (<li>)
 * - `createSpanNodeView`: For inline interactive spans (<span>)
 * - `createSequenceSectionNodeView`: For block-level sequence sections (span with block content)
 * - `createInteractiveNodeView`: Generic factory for custom node types
 *
 * ## Action Indicator Behavior
 *
 * The action indicator emoji is determined by the `data-targetaction` attribute:
 * - For list items: Only shown if the item has class="interactive"
 * - For spans and sequences: Always shown (configurable)
 * - The emoji matches the action type (e.g., 🔘 for button, ✨ for highlight)
 */

import { getActionIcon, DATA_ATTRIBUTES } from '../../../../constants/interactive-config';

// SECURITY: Allowlist of safe HTML attributes to prevent event handler injection (F5)
// Only these attributes can be set on interactive elements
const ALLOWED_ATTRIBUTES = [
  'class',
  'id',
  'data-targetaction',
  'data-reftarget',
  'data-targetvalue',
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
 * Creates an action indicator element for interactive nodes
 * Displays action-specific emoji based on data-targetaction attribute
 * Now keyboard accessible with proper ARIA attributes
 *
 * @param actionType - Optional action type (e.g., 'button', 'highlight')
 */
export function createActionIndicator(actionType?: string): HTMLSpanElement {
  const indicator = document.createElement('span');
  indicator.className = 'interactive-lightning';
  indicator.textContent = getActionIcon(actionType ?? '');

  // Make keyboard accessible
  indicator.setAttribute('role', 'button');
  indicator.setAttribute('tabindex', '0');
  indicator.setAttribute('aria-label', 'Edit interactive settings');

  // Add keyboard event handler for Enter and Space keys
  indicator.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      // Trigger a click event which will be handled by the InteractiveClickHandler
      indicator.click();
    }
  });

  return indicator;
}

/**
 * @deprecated Use createActionIndicator instead
 * Kept for backward compatibility
 */
export function createLightningBolt(): HTMLSpanElement {
  return createActionIndicator();
}

/**
 * Creates an info icon element for comment nodes
 * Similar to lightning bolt but uses blue info icon
 */
export function createInfoIcon(): HTMLSpanElement {
  const infoIcon = document.createElement('span');
  infoIcon.className = 'interactive-info-icon';
  infoIcon.textContent = 'ℹ️'; // Blue info emoji

  // Make keyboard accessible (same pattern as lightning bolt)
  infoIcon.setAttribute('role', 'button');
  infoIcon.setAttribute('tabindex', '0');
  infoIcon.setAttribute('aria-label', 'Edit comment');

  // Add keyboard event handler
  infoIcon.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      infoIcon.click();
    }
  });

  return infoIcon;
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
 * Creates an interactive node view with action indicator
 * @param config - Configuration for the node view
 * @param attributes - HTML attributes to apply
 * @param shouldShowIndicator - Function to determine if indicator should be shown
 */
export function createInteractiveNodeView(
  config: NodeViewConfig,
  attributes: Record<string, any>,
  shouldShowIndicator?: (attrs: Record<string, any>) => boolean
): { dom: HTMLElement; contentDOM: HTMLElement } {
  const { tagName, contentDisplay = 'contents' } = config;

  const dom = document.createElement(tagName);
  applyAttributes(dom, attributes);

  // Determine if we should show the action indicator
  const showIndicator = shouldShowIndicator ? shouldShowIndicator(attributes) : config.showLightning !== false;

  if (showIndicator) {
    // Extract action type from data-targetaction attribute
    const actionType = attributes[DATA_ATTRIBUTES.TARGET_ACTION];
    const indicator = createActionIndicator(actionType);
    dom.appendChild(indicator);
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
  return createInteractiveNodeView({ tagName: 'li', contentDisplay: 'contents' }, attributes, (attrs) =>
    attrs.class?.includes('interactive')
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
    // Extract action type from data-targetaction attribute
    const actionType = attributes[DATA_ATTRIBUTES.TARGET_ACTION];
    const indicator = createActionIndicator(actionType);
    dom.appendChild(indicator);
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
export function createSequenceSectionNodeView(attributes: Record<string, any>): {
  dom: HTMLElement;
  contentDOM: HTMLElement;
} {
  return createSpanNodeView(attributes, {
    showLightning: true,
    contentTag: 'div',
    contentDisplay: 'contents',
  });
}
