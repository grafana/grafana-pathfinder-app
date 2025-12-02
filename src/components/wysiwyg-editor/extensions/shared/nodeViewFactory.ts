/**
 * Node View Factory
 *
 * Factory functions for creating node views with interactive elements.
 * Each interactive node displays a text badge indicator that users can click to edit attributes.
 *
 * ## Usage
 *
 * - `createListItemNodeView`: For interactive list items (<li>)
 * - `createSpanNodeView`: For inline interactive spans (<span>)
 * - `createSequenceSectionNodeView`: For block-level sequence sections (span with block content)
 * - `createInteractiveNodeView`: Generic factory for custom node types
 *
 * ## Action Badge Behavior
 *
 * The badge text and color is determined by the `data-targetaction` attribute:
 * - For list items: Only shown if the item has class="interactive"
 * - For spans and sequences: Always shown (configurable)
 * - Color-coded by type: blue for sections, purple for multistep, teal for guided, amber for steps
 */

import { DATA_ATTRIBUTES, getActionBadge } from '../../../../constants/interactive-config';

// Re-export for convenience
export { getActionBadge };

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
  'data-text',
  'data-tooltip',
  'role',
  'tabindex',
  'aria-label',
] as const;

export interface NodeViewConfig {
  tagName: keyof HTMLElementTagNameMap;
  showBadge?: boolean;
  /** @deprecated Use showBadge instead */
  showLightning?: boolean;
  contentDisplay?: 'contents' | 'inline' | 'block';
}

/**
 * Creates an action badge element for interactive nodes
 * Displays a color-coded text badge based on data-targetaction attribute
 * Keyboard accessible with proper ARIA attributes
 *
 * @param actionType - Optional action type (e.g., 'button', 'highlight')
 */
export function createActionBadge(actionType?: string): HTMLSpanElement {
  const badge = document.createElement('span');
  const type = actionType || '';
  const label = getActionBadge(type);

  // Base class + type-specific modifier class
  badge.className = `action-badge action-badge--${type || 'default'}`;
  badge.textContent = label;

  // Make keyboard accessible
  badge.setAttribute('role', 'button');
  badge.setAttribute('tabindex', '0');
  badge.setAttribute('aria-label', `Edit ${label.toLowerCase()} settings`);

  // Add keyboard event handler for Enter and Space keys
  badge.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      // Trigger a click event which will be handled by the InteractiveClickHandler
      badge.click();
    }
  });

  return badge;
}

/**
 * Creates an action indicator element for interactive nodes
 * @deprecated Use createActionBadge instead - kept for backward compatibility
 */
export function createActionIndicator(actionType?: string): HTMLSpanElement {
  return createActionBadge(actionType);
}

/**
 * @deprecated Use createActionBadge instead
 * Kept for backward compatibility
 */
export function createLightningBolt(): HTMLSpanElement {
  return createActionBadge();
}

/**
 * Creates a note badge element for comment nodes
 * Color-coded orange badge to distinguish from action badges
 */
export function createNoteBadge(): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = 'action-badge action-badge--note';
  badge.textContent = 'Note';

  // Make keyboard accessible (same pattern as action badge)
  badge.setAttribute('role', 'button');
  badge.setAttribute('tabindex', '0');
  badge.setAttribute('aria-label', 'Edit note');

  // Add keyboard event handler
  badge.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      badge.click();
    }
  });

  return badge;
}

/**
 * Creates an info icon element for comment nodes
 * @deprecated Use createNoteBadge instead - kept for backward compatibility
 */
export function createInfoIcon(): HTMLSpanElement {
  return createNoteBadge();
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
 * Creates an interactive node view with action badge
 * @param config - Configuration for the node view
 * @param attributes - HTML attributes to apply
 * @param shouldShowBadge - Function to determine if badge should be shown
 */
export function createInteractiveNodeView(
  config: NodeViewConfig,
  attributes: Record<string, any>,
  shouldShowBadge?: (attrs: Record<string, any>) => boolean
): { dom: HTMLElement; contentDOM: HTMLElement } {
  const { tagName, contentDisplay = 'contents' } = config;

  const dom = document.createElement(tagName);
  applyAttributes(dom, attributes);

  // Determine if we should show the action badge (support both showBadge and legacy showLightning)
  const showBadge = shouldShowBadge
    ? shouldShowBadge(attributes)
    : config.showBadge !== false && config.showLightning !== false;

  if (showBadge) {
    // Extract action type from data-targetaction attribute
    const actionType = attributes[DATA_ATTRIBUTES.TARGET_ACTION];
    const badge = createActionBadge(actionType);
    dom.appendChild(badge);
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
  showBadge?: boolean;
  /** @deprecated Use showBadge instead */
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
  // Handle legacy boolean parameter (showLightning/showBadge)
  const finalConfig: SpanNodeViewConfig =
    typeof config === 'boolean'
      ? { showBadge: config, contentTag: 'span', contentDisplay: 'inline' }
      : {
          showBadge: config.showBadge !== false && config.showLightning !== false,
          contentTag: config.contentTag || 'span',
          contentDisplay: config.contentDisplay || 'inline',
        };

  const dom = document.createElement('span');
  applyAttributes(dom, attributes);

  if (finalConfig.showBadge) {
    // Extract action type from data-targetaction attribute
    const actionType = attributes[DATA_ATTRIBUTES.TARGET_ACTION];
    const badge = createActionBadge(actionType);
    dom.appendChild(badge);
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
    showBadge: true,
    contentTag: 'div',
    contentDisplay: 'contents',
  });
}

/**
 * Creates an atomic node view for interactive spans
 * Atomic nodes cannot be edited directly - they render text from attributes.
 * No contentDOM is returned since content cannot be edited.
 *
 * @param attributes - HTML attributes to apply to the DOM element
 * @param text - The display text for the atomic node
 * @param tooltip - Optional tooltip/comment text - shows Note badge if present
 */
export function createAtomicSpanNodeView(
  attributes: Record<string, any>,
  text = '',
  tooltip = ''
): { dom: HTMLElement } {
  const dom = document.createElement('span');
  applyAttributes(dom, attributes);

  // Make the node non-editable to prevent cursor from entering
  dom.setAttribute('contenteditable', 'false');

  // Add action badge
  const actionType = attributes[DATA_ATTRIBUTES.TARGET_ACTION];
  const badge = createActionBadge(actionType);
  dom.appendChild(badge);

  // Add text span (read-only, from attribute)
  const textSpan = document.createElement('span');
  textSpan.className = 'interactive-text';
  // SECURITY: Use textContent for safe text insertion (F3)
  textSpan.textContent = text;
  dom.appendChild(textSpan);

  // Add Note badge if tooltip is present (comment is part of the step)
  if (tooltip && tooltip.trim()) {
    const noteBadge = createNoteBadge();
    dom.appendChild(noteBadge);
  }

  // No contentDOM - atomic node cannot have editable content
  return { dom };
}

/**
 * Creates an atomic node view for interactive comments
 * Comments display only a badge (Note) with no visible text.
 * The text is stored in attributes and shown in the edit modal.
 *
 * @param attributes - HTML attributes to apply to the DOM element
 */
export function createAtomicCommentNodeView(attributes: Record<string, any>): { dom: HTMLElement } {
  const dom = document.createElement('span');
  applyAttributes(dom, attributes);

  // Make the node non-editable to prevent cursor from entering
  dom.setAttribute('contenteditable', 'false');

  // Add note badge
  const badge = createNoteBadge();
  dom.appendChild(badge);

  // No contentDOM - atomic node, no visible text (shown in modal only)
  return { dom };
}
