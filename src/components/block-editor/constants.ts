/**
 * Block Editor Constants
 *
 * Block type metadata and configuration for the block-based editor.
 */

import type { BlockType, BlockTypeMetadata } from './types';

/**
 * Metadata for all block types
 * Used in the block palette and throughout the editor
 */
export const BLOCK_TYPE_METADATA: Record<BlockType, BlockTypeMetadata> = {
  markdown: {
    type: 'markdown',
    icon: '📝',
    grafanaIcon: 'file-alt',
    name: 'Markdown',
    description: 'Formatted text with headings, lists, and code',
  },
  html: {
    type: 'html',
    icon: '🔧',
    grafanaIcon: 'code',
    name: 'HTML',
    description: 'Raw HTML content (sanitized)',
  },
  image: {
    type: 'image',
    icon: '🖼️',
    grafanaIcon: 'gf-landscape',
    name: 'Image',
    description: 'Embedded image with optional dimensions',
  },
  video: {
    type: 'video',
    icon: '🎬',
    grafanaIcon: 'video',
    name: 'Video',
    description: 'YouTube or native video embed',
  },
  section: {
    type: 'section',
    icon: '📂',
    grafanaIcon: 'folder',
    name: 'Section',
    description: 'Container for grouped interactive steps',
  },
  conditional: {
    type: 'conditional',
    icon: '🔀',
    grafanaIcon: 'code-branch',
    name: 'Conditional',
    description: 'Show different content based on conditions',
  },
  interactive: {
    type: 'interactive',
    icon: '⚡',
    grafanaIcon: 'bolt',
    name: 'Interactive',
    description: 'Single-action step with Show me / Do it',
  },
  multistep: {
    type: 'multistep',
    icon: '📋',
    grafanaIcon: 'list-ol',
    name: 'Multistep',
    description: 'Automated sequence of actions',
  },
  guided: {
    type: 'guided',
    icon: '🧭',
    grafanaIcon: 'compass',
    name: 'Guided',
    description: 'User-performed sequence with detection',
  },
  quiz: {
    type: 'quiz',
    icon: '❓',
    grafanaIcon: 'question-circle',
    name: 'Quiz',
    description: 'Knowledge assessment with single or multiple choice',
  },
  input: {
    type: 'input',
    icon: '📝',
    grafanaIcon: 'keyboard',
    name: 'Input',
    description: 'Collect user responses for use as variables',
  },
};

/**
 * Ordered list of block types for the palette.
 * Note: 'html' is intentionally excluded - it's only supported for legacy content.
 */
export const BLOCK_TYPE_ORDER: BlockType[] = [
  'markdown',
  'image',
  'video',
  'section',
  'conditional',
  'interactive',
  'multistep',
  'guided',
  'quiz',
  'input',
];

/**
 * Local storage key for persisting editor state
 */
export const BLOCK_EDITOR_STORAGE_KEY = 'pathfinder-block-editor-state';

/**
 * Local storage key for persisting recording mode state
 * Allows recording to survive page refreshes (e.g., when saving a dashboard)
 */
export const RECORDING_STATE_STORAGE_KEY = 'pathfinder-block-editor-recording-state';

/**
 * Default guide metadata for new guides
 */
export const DEFAULT_GUIDE_METADATA = {
  id: 'new-guide',
  title: 'New Guide',
  match: {
    urlPrefix: [],
    tags: [],
  },
};

/**
 * Interactive action types with their display info
 */
export const INTERACTIVE_ACTIONS = [
  { value: 'highlight', label: '⭐ Highlight', description: 'Click/Highlight an element' },
  { value: 'button', label: '🖱️ Button', description: 'Click a button by text' },
  { value: 'formfill', label: '📝 Form Fill', description: 'Fill an input field' },
  { value: 'navigate', label: '🧭 Navigate', description: 'Go to a URL' },
  { value: 'hover', label: '👆 Hover', description: 'Hover over an element' },
  { value: 'noop', label: '📖 Info', description: 'Non-interactive informational step' },
] as const;

/**
 * Video provider options
 */
export const VIDEO_PROVIDERS = [
  { value: 'youtube', label: 'YouTube' },
  { value: 'native', label: 'Native HTML5' },
] as const;
