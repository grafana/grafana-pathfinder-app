/**
 * Block Editor Constants
 *
 * Block type metadata and configuration for the block-based editor.
 */

import { StorageKeys } from '../../lib/storage-keys';

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
    grafanaIcon: 'brackets-curly',
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
    grafanaIcon: 'gf-layout-simple',
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
  collapsible: {
    type: 'collapsible',
    icon: '📖',
    grafanaIcon: 'angle-down',
    name: 'Collapsible',
    description: 'Hide content behind a toggle',
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
  terminal: {
    type: 'terminal',
    icon: '💻',
    grafanaIcon: 'brackets-curly',
    name: 'Terminal',
    description: 'Shell command with copy and execute buttons',
  },
  'terminal-connect': {
    type: 'terminal-connect',
    icon: '🔌',
    grafanaIcon: 'link',
    name: 'Terminal connect',
    description: 'Button to open and connect to the terminal',
  },
  challenge: {
    type: 'challenge',
    icon: '🏆',
    grafanaIcon: 'shield-exclamation',
    name: 'Challenge',
    description: 'CTF-style task in a Coda VM with progressive hints',
  },
  'code-block': {
    type: 'code-block',
    icon: '📋',
    grafanaIcon: 'document-info',
    name: 'Code block',
    description: 'Code snippet with copy and insert into editor',
  },
  'grot-guide': {
    type: 'grot-guide',
    icon: '🗺️',
    grafanaIcon: 'map-marker',
    name: 'Grot guide',
    description: 'Choose-your-own-adventure decision tree',
  },
  'snippet-ref': {
    type: 'snippet-ref',
    icon: '🧩',
    grafanaIcon: 'share-alt',
    name: 'Snippet',
    description: 'Reuse a published snippet by reference (always loads the latest)',
  },
  assistant: {
    type: 'assistant',
    icon: '✨',
    grafanaIcon: 'ai',
    name: 'Assistant',
    description: 'AI-customizable container (authored via markdown block customization)',
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
  'collapsible',
  'conditional',
  'interactive',
  'multistep',
  'guided',
  'terminal',
  'terminal-connect',
  'challenge',
  'code-block',
  'quiz',
  'input',
  'grot-guide',
  'snippet-ref',
];

/**
 * Palette groupings — drives the section headers in `BlockPalette`.
 * Order is preserved; types within each group keep their `BLOCK_TYPE_ORDER`
 * relative ordering.
 *
 * - **Content** — passive, author-authored material the user reads.
 * - **Interactive** — blocks that require user action or input at runtime.
 * - **Structure** — containers and special-purpose framing blocks.
 */
export const BLOCK_TYPE_GROUPS = [
  {
    id: 'content',
    label: 'Content',
    types: ['markdown', 'image', 'video', 'code-block'],
  },
  {
    id: 'interactive',
    label: 'Interactive',
    types: ['interactive', 'multistep', 'guided', 'input', 'quiz', 'terminal', 'terminal-connect', 'challenge'],
  },
  {
    id: 'structure',
    label: 'Structure',
    types: ['section', 'collapsible', 'conditional', 'grot-guide'],
  },
  {
    id: 'reusable',
    label: 'Reusable',
    types: ['snippet-ref'],
  },
] as const satisfies ReadonlyArray<{
  id: 'content' | 'interactive' | 'structure' | 'reusable';
  label: string;
  types: readonly BlockType[];
}>;

/**
 * Block types deliberately absent from the palette groups.
 *
 * - `html` is legacy-only; authors should use markdown.
 * - `assistant` is authored by toggling AI customization on a markdown block,
 *   not as a standalone palette entry.
 */
export const PALETTE_EXCLUDED_BLOCK_TYPES = ['html', 'assistant'] as const satisfies readonly BlockType[];

type GroupedBlockType = (typeof BLOCK_TYPE_GROUPS)[number]['types'][number];
type UngroupedBlockType = Exclude<BlockType, GroupedBlockType | (typeof PALETTE_EXCLUDED_BLOCK_TYPES)[number]>;

/**
 * Compile-time ratchet: `BlockPalette` renders by mapping `BLOCK_TYPE_GROUPS`,
 * so a block type in neither a group nor the exclusion list is unreachable in
 * the UI with no other symptom. (`challenge` was in exactly that state.)
 * Adding a block type therefore forces a deliberate decision here.
 */
const _palettePartitionIsTotal: UngroupedBlockType extends never
  ? true
  : ['block types missing from BLOCK_TYPE_GROUPS and PALETTE_EXCLUDED_BLOCK_TYPES:', UngroupedBlockType] = true;
void _palettePartitionIsTotal;

/**
 * Local storage key for persisting editor state.
 * Canonical value lives in the centralized `StorageKeys` registry.
 */
export const BLOCK_EDITOR_STORAGE_KEY = StorageKeys.BLOCK_EDITOR_STATE;

/**
 * Local storage key for persisting recording mode state
 * Allows recording to survive page refreshes (e.g., when saving a dashboard)
 */
export const RECORDING_STATE_STORAGE_KEY = StorageKeys.BLOCK_EDITOR_RECORDING_STATE;

/**
 * Local storage key for persisting backend tracking state (resource name, status).
 * Ensures the correct save/update button is shown after a page refresh.
 */
export const BACKEND_TRACKING_STORAGE_KEY = StorageKeys.BLOCK_EDITOR_BACKEND_TRACKING;

/**
 * Default guide metadata for new guides
 */
export const DEFAULT_GUIDE_METADATA = {
  id: 'new-guide',
  title: 'New guide',
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
  { value: 'popout', label: '🪟 Popout', description: 'Dock or undock the guide panel' },
] as const;

/**
 * Target mode options for popout interactive actions.
 * - 'floating' undocks the guide into a floating window.
 * - 'sidebar' docks the guide back into the Grafana sidebar.
 */
export const POPOUT_TARGET_MODES = [
  { value: 'floating', label: 'Undock (move to floating window)' },
  { value: 'sidebar', label: 'Dock (return to sidebar)' },
] as const;

/**
 * Desired end state options for toggle targets, shared by the top-level
 * interactive block form and the nested step editor.
 */
export const TARGET_STATE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Click unconditionally' },
  { value: 'true', label: 'On — expanded, pressed or checked' },
  { value: 'false', label: 'Off — collapsed, unpressed or unchecked' },
];

/**
 * Author-typed target state → the authored value, with `''` meaning unset.
 *
 * Stays a string. The editor already holds the value as one (the select above
 * emits `'true'`/`'false'`), and `targetstate` is persisted as a string so the
 * backend InteractiveGuide CRD can carry it — that schema cannot model a
 * boolean-or-string field, and a raw boolean would be rejected on write.
 */
export function parseAuthoredTargetState(value: string): string | undefined {
  return value.trim() || undefined;
}

/**
 * Video provider options
 */
export const VIDEO_PROVIDERS = [
  { value: 'youtube', label: 'YouTube' },
  { value: 'vimeo', label: 'Vimeo' },
  { value: 'native', label: 'Native HTML5' },
] as const;
