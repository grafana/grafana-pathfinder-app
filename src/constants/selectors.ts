// Code block selectors for copy button functionality
export const CODE_BLOCK_SELECTORS = [
  'pre.journey-code-block', // Learning journey code blocks
  'pre.docs-code-snippet', // Single docs code blocks
  'pre[class*="language-"]', // Language-specific blocks
  'pre:has(code)', // Any pre with code inside
  'pre', // Fallback to any pre element
];

// Interactive element selectors
export const INTERACTIVE_SELECTORS = {
  JOURNEY_START: '[data-journey-start="true"]',
  SIDE_JOURNEY_LINK: '[data-side-journey-link]',
  RELATED_JOURNEY_LINK: '[data-related-journey-link]',
  COLLAPSIBLE_SECTION: '.journey-collapse',
  COLLAPSIBLE_TRIGGER: '.journey-collapse-trigger',
  COLLAPSIBLE_CONTENT: '.journey-collapse-content',
  COLLAPSIBLE_ICON: '.journey-collapse-icon',
  EXPAND_TABLE_BUTTON: '.expand-table-btn',
  RESPONSIVE_TABLE_WRAPPER: '.responsive-table-wrapper',
  EXPAND_TABLE_WRAPPER: '.expand-table-wrapper',
} as const;

// Copy button selectors
export const COPY_BUTTON_SELECTORS = {
  EXISTING_BUTTONS:
    '.code-copy-button, button[title*="copy" i], button[aria-label*="copy" i], .copy-button, .copy-btn, .btn-copy',
  CODE_COPY_BUTTON: '.code-copy-button',
  INLINE_CODE_COPY_BUTTON: '.inline-code-copy-button',
} as const;

// Event types for interactive elements
export const INTERACTIVE_EVENT_TYPES = [
  'interactive-highlight',
  'interactive-formfill',
  'interactive-button',
  'interactive-sequence',
] as const;

// Image lightbox related
export const IMAGE_LIGHTBOX = {
  MODAL_CLASS: 'journey-image-modal',
  BACKDROP_CLASS: 'journey-image-modal-backdrop',
  CONTAINER_CLASS: 'journey-image-modal-container',
  HEADER_CLASS: 'journey-image-modal-header',
  TITLE_CLASS: 'journey-image-modal-title',
  CLOSE_CLASS: 'journey-image-modal-close',
  CONTENT_CLASS: 'journey-image-modal-content',
  IMAGE_CLASS: 'journey-image-modal-image',
  EXCLUDED_CLASS: 'journey-conclusion-header',
} as const;

// Tab configuration
export const TAB_CONFIG = {
  RECOMMENDATIONS_ID: 'recommendations',
  ID_PREFIX: 'journey-tab',
  MIN_WIDTH: '140px',
  MAX_WIDTH: '220px',
} as const;

// Code copy button configuration
export const CODE_COPY_CONFIG = {
  BUTTON_MIN_WIDTH: '70px',
  INLINE_BUTTON_SIZE: '16px',
  RESET_DELAY_MS: 2000,
  INLINE_RESET_DELAY_MS: 1500,
  PADDING_RIGHT: '24px',
} as const;

// Interactive sequence configuration
export const INTERACTIVE_CONFIG = {
  SEQUENCE_DELAY_MS: 2000,
  HIGHLIGHT_BORDER: '1px solid red',
} as const;

// URL patterns
export const URL_PATTERNS = {
  GRAFANA_BASE: 'https://grafana.com',
} as const;
