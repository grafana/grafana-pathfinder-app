/**
 * JSON Guide Type Definitions
 *
 * Structured format for interactive guides that converts to ParsedElement[]
 * for rendering through the existing content pipeline.
 */

// ============ ROOT STRUCTURE ============

/**
 * Root structure for a JSON-based interactive guide.
 */
export interface JsonGuide {
  /** Unique identifier for the guide */
  id: string;
  /** Display title for the guide */
  title: string;
  /** Content blocks that make up the guide */
  blocks: JsonBlock[];
  /** Optional metadata for recommendation matching */
  match?: JsonMatchMetadata;
}

/**
 * Metadata for determining when to recommend a guide.
 */
export interface JsonMatchMetadata {
  /** URL prefixes where this guide is relevant */
  urlPrefix?: string[];
  /** Tags for categorization and filtering */
  tags?: string[];
}

// ============ BLOCK UNION ============

/**
 * Discriminated union of all supported block types.
 * The `type` field determines which block interface applies.
 */
export type JsonBlock =
  | JsonMarkdownBlock
  | JsonHtmlBlock
  | JsonSectionBlock
  | JsonInteractiveBlock
  | JsonMultistepBlock
  | JsonGuidedBlock
  | JsonImageBlock
  | JsonVideoBlock
  | JsonQuizBlock;

// ============ CONTENT BLOCKS ============

/**
 * Markdown content block.
 * Content is rendered as formatted text with support for
 * headings, bold, italic, code, links, and lists.
 */
export interface JsonMarkdownBlock {
  type: 'markdown';
  /** Markdown-formatted content */
  content: string;
}

/**
 * Raw HTML content block.
 * Used for migration path from HTML guides - prefer markdown for new content.
 * HTML is sanitized before rendering.
 */
export interface JsonHtmlBlock {
  type: 'html';
  /** Raw HTML content (will be sanitized) */
  content: string;
}

/**
 * Image block for displaying images.
 */
export interface JsonImageBlock {
  type: 'image';
  /** Image source URL */
  src: string;
  /** Alt text for accessibility */
  alt?: string;
  /** Display width in pixels */
  width?: number;
  /** Display height in pixels */
  height?: number;
}

/**
 * Video block for embedded video content.
 */
export interface JsonVideoBlock {
  type: 'video';
  /** Video source URL */
  src: string;
  /** Video provider - determines embed method */
  provider?: 'youtube' | 'native';
  /** Video title for accessibility */
  title?: string;
}

// ============ SECTION BLOCK ============

/**
 * Section block that acts as a sequence container.
 * Sections group related interactive steps and provide
 * sequential execution with "Do Section" functionality.
 */
export interface JsonSectionBlock {
  type: 'section';
  /** Optional HTML id for the section */
  id?: string;
  /** Section title displayed as a heading */
  title?: string;
  /** Nested blocks within this section */
  blocks: JsonBlock[];
  /** Requirements that must be met before this section is accessible */
  requirements?: string[];
  /** Objectives tracked for completion of this section */
  objectives?: string[];
}

// ============ INTERACTIVE BLOCKS ============

/**
 * Action types for JSON guide interactive elements.
 * Named differently from collaboration.types.ts InteractiveAction to avoid conflicts.
 */
export type JsonInteractiveAction = 'highlight' | 'button' | 'formfill' | 'navigate' | 'hover';

/**
 * Single-action interactive step.
 * Renders with "Show me" and "Do it" buttons by default.
 * Use showMe/doIt to control button visibility.
 */
export interface JsonInteractiveBlock {
  type: 'interactive';
  /** The action to perform */
  action: JsonInteractiveAction;
  /** CSS selector or Grafana selector for the target element */
  reftarget: string;
  /** Value for formfill actions */
  targetvalue?: string;
  /** Markdown description shown to the user */
  content: string;
  /** Tooltip/comment shown when highlighting the element */
  tooltip?: string;
  /** Requirements that must be met for this step */
  requirements?: string[];
  /** Objectives tracked for this step */
  objectives?: string[];
  /** Whether this step can be skipped if requirements fail */
  skippable?: boolean;
  /** Hint shown when step cannot be completed */
  hint?: string;

  // ---- Button Visibility ----
  /** Whether to show the "Show me" button (default: true) */
  showMe?: boolean;
  /** Whether to show the "Do it" button (default: true) */
  doIt?: boolean;

  // ---- Execution Control ----
  /** Mark step as complete BEFORE action executes (default: false) */
  completeEarly?: boolean;
  /** Post-action verification requirement (e.g., "on-page:/dashboard") */
  verify?: string;
}

/**
 * Multi-step block for automated action sequences.
 * System performs all steps automatically when "Do it" is clicked.
 */
export interface JsonMultistepBlock {
  type: 'multistep';
  /** Markdown description shown to the user */
  content: string;
  /** Sequence of steps to execute automatically */
  steps: JsonStep[];
  /** Requirements for the entire multistep block */
  requirements?: string[];
  /** Objectives tracked for this block */
  objectives?: string[];
  /** Whether this block can be skipped */
  skippable?: boolean;
}

/**
 * Guided block for user-performed action sequences.
 * System highlights elements and waits for user to perform actions.
 */
export interface JsonGuidedBlock {
  type: 'guided';
  /** Markdown description shown to the user */
  content: string;
  /** Sequence of steps for user to perform */
  steps: JsonStep[];
  /** Timeout per step in milliseconds (default: 30000) */
  stepTimeout?: number;
  /** Requirements for the entire guided block */
  requirements?: string[];
  /** Objectives tracked for this block */
  objectives?: string[];
  /** Whether this block can be skipped */
  skippable?: boolean;
  /** Whether to mark complete when user performs action early */
  completeEarly?: boolean;
}

// ============ STEP (shared by multistep & guided) ============

/**
 * Individual step within a multistep or guided block.
 * The parent block type determines execution semantics:
 * - multistep: steps are executed automatically
 * - guided: steps highlight and wait for user action
 */
export interface JsonStep {
  /** The action to perform or wait for */
  action: JsonInteractiveAction;
  /** CSS selector or Grafana selector for the target element */
  reftarget: string;
  /** Value for formfill actions */
  targetvalue?: string;
  /** Requirements for this specific step */
  requirements?: string[];
  /** Tooltip shown during this step (multistep) */
  tooltip?: string;
  /** Description shown in the steps panel (guided) */
  description?: string;
  /** Whether this step can be skipped (guided only) */
  skippable?: boolean;
}

// ============ QUIZ BLOCK ============

/**
 * Quiz block for knowledge assessment.
 * Supports single or multiple choice questions with configurable completion modes.
 */
export interface JsonQuizBlock {
  type: 'quiz';
  /** The question text (supports markdown) */
  question: string;
  /** Answer choices */
  choices: JsonQuizChoice[];
  /** Allow multiple correct answers (checkbox style vs radio buttons) */
  multiSelect?: boolean;
  /** Completion mode: correct-only requires right answer, max-attempts reveals after X tries */
  completionMode?: 'correct-only' | 'max-attempts';
  /** Max attempts before revealing answer (only for max-attempts mode, default: 3) */
  maxAttempts?: number;
  /** Requirements that must be met for this quiz */
  requirements?: string[];
  /** Whether quiz can be skipped */
  skippable?: boolean;
}

/**
 * Individual choice for a quiz question.
 */
export interface JsonQuizChoice {
  /** Choice identifier (e.g., "a", "b", "c") */
  id: string;
  /** Choice text (supports markdown) */
  text: string;
  /** Is this a correct answer? */
  correct?: boolean;
  /** Hint shown when this wrong choice is selected */
  hint?: string;
}

// ============ TYPE GUARDS ============

/**
 * Type guard for JsonMarkdownBlock
 */
export function isMarkdownBlock(block: JsonBlock): block is JsonMarkdownBlock {
  return block.type === 'markdown';
}

/**
 * Type guard for JsonHtmlBlock
 */
export function isHtmlBlock(block: JsonBlock): block is JsonHtmlBlock {
  return block.type === 'html';
}

/**
 * Type guard for JsonSectionBlock
 */
export function isSectionBlock(block: JsonBlock): block is JsonSectionBlock {
  return block.type === 'section';
}

/**
 * Type guard for JsonInteractiveBlock
 */
export function isInteractiveBlock(block: JsonBlock): block is JsonInteractiveBlock {
  return block.type === 'interactive';
}

/**
 * Type guard for JsonMultistepBlock
 */
export function isMultistepBlock(block: JsonBlock): block is JsonMultistepBlock {
  return block.type === 'multistep';
}

/**
 * Type guard for JsonGuidedBlock
 */
export function isGuidedBlock(block: JsonBlock): block is JsonGuidedBlock {
  return block.type === 'guided';
}

/**
 * Type guard for JsonImageBlock
 */
export function isImageBlock(block: JsonBlock): block is JsonImageBlock {
  return block.type === 'image';
}

/**
 * Type guard for JsonVideoBlock
 */
export function isVideoBlock(block: JsonBlock): block is JsonVideoBlock {
  return block.type === 'video';
}

/**
 * Type guard for JsonQuizBlock
 */
export function isQuizBlock(block: JsonBlock): block is JsonQuizBlock {
  return block.type === 'quiz';
}
