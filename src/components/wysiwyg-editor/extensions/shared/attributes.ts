/**
 * Shared attribute definitions for interactive Tiptap extensions
 * These attributes are used across multiple custom node/mark types
 */

/**
 * Creates the standard 'class' attribute configuration
 */
export function createClassAttribute(defaultValue: string | null = null) {
  return {
    default: defaultValue,
    parseHTML: (element: HTMLElement) => element.getAttribute('class'),
    renderHTML: (attributes: Record<string, any>) => {
      if (!attributes.class) {
        return {};
      }
      return { class: attributes.class };
    },
  };
}

/**
 * Creates the standard 'id' attribute configuration
 */
export function createIdAttribute() {
  return {
    default: null,
    parseHTML: (element: HTMLElement) => element.getAttribute('id'),
    renderHTML: (attributes: Record<string, any>) => {
      if (!attributes.id) {
        return {};
      }
      return { id: attributes.id };
    },
  };
}

/**
 * Creates the 'data-targetaction' attribute configuration
 */
export function createTargetActionAttribute(defaultValue: string | null = null) {
  return {
    default: defaultValue,
    parseHTML: (element: HTMLElement) => element.getAttribute('data-targetaction'),
    renderHTML: (attributes: Record<string, any>) => {
      if (!attributes['data-targetaction']) {
        return {};
      }
      return { 'data-targetaction': attributes['data-targetaction'] };
    },
  };
}

/**
 * Creates the 'data-reftarget' attribute configuration
 */
export function createRefTargetAttribute() {
  return {
    default: null,
    parseHTML: (element: HTMLElement) => element.getAttribute('data-reftarget'),
    renderHTML: (attributes: Record<string, any>) => {
      if (!attributes['data-reftarget']) {
        return {};
      }
      return { 'data-reftarget': attributes['data-reftarget'] };
    },
  };
}

/**
 * Creates the 'data-targetvalue' attribute configuration
 */
export function createTargetValueAttribute() {
  return {
    default: null,
    parseHTML: (element: HTMLElement) => element.getAttribute('data-targetvalue'),
    renderHTML: (attributes: Record<string, any>) => {
      if (!attributes['data-targetvalue']) {
        return {};
      }
      return { 'data-targetvalue': attributes['data-targetvalue'] };
    },
  };
}

/**
 * Creates the 'data-requirements' attribute configuration
 */
export function createRequirementsAttribute() {
  return {
    default: null,
    parseHTML: (element: HTMLElement) => element.getAttribute('data-requirements'),
    renderHTML: (attributes: Record<string, any>) => {
      if (!attributes['data-requirements']) {
        return {};
      }
      return { 'data-requirements': attributes['data-requirements'] };
    },
  };
}

/**
 * Creates the 'data-doit' attribute configuration
 */
export function createDoItAttribute() {
  return {
    default: null,
    parseHTML: (element: HTMLElement) => element.getAttribute('data-doit'),
    renderHTML: (attributes: Record<string, any>) => {
      if (!attributes['data-doit']) {
        return {};
      }
      return { 'data-doit': attributes['data-doit'] };
    },
  };
}

/**
 * Creates the 'text' attribute configuration for atomic nodes.
 * Stores the display text as an attribute since atomic nodes cannot have content.
 * Falls back to extracting text from element content when parsing HTML.
 */
export function createTextAttribute() {
  return {
    default: '',
    parseHTML: (element: HTMLElement) => {
      // First try data-text attribute, then fall back to text content
      const dataText = element.getAttribute('data-text');
      if (dataText) {
        return dataText;
      }
      // Extract text content, excluding badge elements and comments
      const clone = element.cloneNode(true) as HTMLElement;
      const badges = clone.querySelectorAll('.action-badge');
      badges.forEach((badge) => badge.remove());
      const comments = clone.querySelectorAll('.interactive-comment');
      comments.forEach((comment) => comment.remove());
      return clone.textContent?.trim() || '';
    },
    renderHTML: (attributes: Record<string, any>) => {
      // Store text in data-text attribute for persistence
      if (!attributes.text) {
        return {};
      }
      return { 'data-text': attributes.text };
    },
  };
}

/**
 * Creates the 'tooltip' attribute configuration for atomic interactive nodes.
 * Stores the tooltip/comment text as an attribute, keeping it part of the step.
 * Falls back to extracting from nested interactive-comment elements when parsing HTML.
 */
export function createTooltipAttribute() {
  return {
    default: '',
    parseHTML: (element: HTMLElement) => {
      // First try data-tooltip attribute
      const dataTooltip = element.getAttribute('data-tooltip');
      if (dataTooltip) {
        return dataTooltip;
      }
      // Fall back to extracting from nested interactive-comment elements
      const commentEl = element.querySelector('.interactive-comment');
      if (commentEl) {
        // Clone and remove badges
        const clone = commentEl.cloneNode(true) as HTMLElement;
        const badges = clone.querySelectorAll('.action-badge');
        badges.forEach((badge) => badge.remove());
        return clone.textContent?.trim() || '';
      }
      return '';
    },
    renderHTML: (attributes: Record<string, any>) => {
      // Store tooltip in data-tooltip attribute for persistence
      if (!attributes.tooltip) {
        return {};
      }
      return { 'data-tooltip': attributes.tooltip };
    },
  };
}
