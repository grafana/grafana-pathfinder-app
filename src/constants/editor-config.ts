/**
 * Editor-specific constants for the WYSIWYG Interactive Tutorial Editor
 * These constants are specific to the editor UI and not shared with the runtime
 */

/**
 * CSS class names used for interactive elements in the editor
 */
export const CSS_CLASSES = {
  INTERACTIVE: 'interactive',
  INTERACTIVE_COMMENT: 'interactive-comment',
  INTERACTIVE_LIGHTNING: 'interactive-lightning',
} as const;

/**
 * Tiptap node and mark type names
 */
export const NODE_TYPES = {
  LIST_ITEM: 'listItem',
  INTERACTIVE_SPAN: 'interactiveSpan',
  INTERACTIVE_COMMENT: 'interactiveComment',
  SEQUENCE_SECTION: 'sequenceSection',
} as const;

/**
 * HTML element tag names
 */
export const HTML_TAGS = {
  LIST_ITEM: 'li',
  SPAN: 'span',
  DIV: 'div',
} as const;

/**
 * UI labels for toolbar buttons and dropdowns
 */
export const EDITOR_UI_LABELS = {
  // Toolbar buttons
  BOLD: 'Bold',
  ITALIC: 'Italic',
  UNDO: 'Undo',
  REDO: 'Redo',
  INTERACTIVE: 'Add Interactive Action',
  SEQUENCE: 'Add Sequence Section',
  COMMENT: 'Interactive Comment',
  
  // Heading levels
  HEADING_NORMAL: 'Normal',
  HEADING_1: 'Heading 1',
  HEADING_2: 'Heading 2',
  HEADING_3: 'Heading 3',
  HEADING_4: 'Heading 4',
  
  // Format options
  FORMAT_CODE: 'Code',
  FORMAT_BLOCKQUOTE: 'Blockquote',
  FORMAT_HR: 'Horizontal Rule',
  
  // List types
  LIST_BULLET: 'Bullet List',
  LIST_ORDERED: 'Numbered List',
  
  // Export buttons
  COPY_HTML: 'Copy HTML',
  DOWNLOAD_HTML: 'Download HTML',
  
  // Tooltips
  TOOLTIP_BOLD: 'Bold (Ctrl+B)',
  TOOLTIP_ITALIC: 'Italic (Ctrl+I)',
  TOOLTIP_UNDO: 'Undo (Ctrl+Z)',
  TOOLTIP_REDO: 'Redo (Ctrl+Shift+Z)',
} as const;

/**
 * Default editor content and placeholder text
 */
export const EDITOR_DEFAULTS = {
  INITIAL_CONTENT: `
    <h2>Guide Example</h2>
    <p>In this guide, you'll learn (things)</p>

    <span id="guide-section-1" class="interactive" data-targetaction="sequence" data-reftarget="span#guide-section-1">
      <h3>Section 1: Getting Started</h3>
      <ul>
        <li>Do the first step</li>
      </ul>
    </span>
  `,
  
  PLACEHOLDER_TEXT: 'Start typing your tutorial content here...',
  
  DEFAULT_SECTION_ID: 'section-1',
  DEFAULT_SECTION_TITLE: 'Section Title',
} as const;

/**
 * Editor configuration values
 */
export const EDITOR_CONFIG = {
  PRINT_WIDTH: 80,
  TAB_WIDTH: 2,
  USE_TABS: false,
  HTML_WHITESPACE_SENSITIVITY: 'css' as const,
} as const;

/**
 * Timing constants for editor operations
 */
export const EDITOR_TIMING = {
  AUTO_SAVE_DEBOUNCE_MS: 1000,
  SAVING_INDICATOR_DURATION_MS: 1000,
  DOWNLOAD_CLEANUP_DELAY_MS: 100,
} as const;

// Type exports for type safety
export type NodeType = (typeof NODE_TYPES)[keyof typeof NODE_TYPES];
export type CssClass = (typeof CSS_CLASSES)[keyof typeof CSS_CLASSES];
export type HtmlTag = (typeof HTML_TAGS)[keyof typeof HTML_TAGS];

