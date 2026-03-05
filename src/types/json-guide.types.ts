/**
 * JSON Guide Type Definitions
 *
 * Structured format for interactive guides that converts to ParsedElement[]
 * for rendering through the existing content pipeline.
 */

// ============ ROOT STRUCTURE ============

/**
 * Root structure for a JSON-based interactive guide.
 * @coupling Zod schema: JsonGuideSchema in json-guide.schema.ts
 */
export interface JsonGuide {
  /** Schema version for forward compatibility (e.g., "1.0.0", "1.1.0") */
  schemaVersion?: '1.0.0' | '1.1.0' | string;
  /** Unique identifier for the guide */
  id: string;
  /** Display title for the guide */
  title: string;
  /** Content blocks that make up the guide */
  blocks: JsonBlock[];
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
  | JsonConditionalBlock
  | JsonInteractiveBlock
  | JsonMultistepBlock
  | JsonGuidedBlock
  | JsonImageBlock
  | JsonVideoBlock
  | JsonQuizBlock
  | JsonAssistantBlock
  | JsonInputBlock
  | JsonTerminalBlock;

// ============ ASSISTANT CUSTOMIZATION PROPS ============

/**
 * Assistant customization properties.
 * Can be added to blocks that support AI-powered customization.
 * When assistantEnabled is true, the block will show a "Customize" button
 * that uses Grafana Assistant to adapt content to the user's environment.
 */
export interface AssistantProps {
  /** Enable AI customization for this block */
  assistantEnabled?: boolean;
  /** Unique ID for localStorage persistence (auto-generated if not provided) */
  assistantId?: string;
  /** Type of content - affects AI prompts and customization behavior */
  assistantType?: 'query' | 'config' | 'code' | 'text';
}

// ============ CONTENT BLOCKS ============

/**
 * Markdown content block.
 * Content is rendered as formatted text with support for
 * headings, bold, italic, code, links, and lists.
 */
export interface JsonMarkdownBlock extends AssistantProps {
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
  /** Start time in seconds */
  start?: number;
  /** End time in seconds */
  end?: number;
}

/**
 * Assistant wrapper block for AI-customizable content.
 * Wraps multiple child blocks, each getting their own customize button.
 * Uses Grafana Assistant to customize content based on user's datasources and environment.
 */
export interface JsonAssistantBlock {
  type: 'assistant';
  /** Unique ID prefix for wrapped elements (auto-generated if not provided) */
  assistantId?: string;
  /** Type of content - affects AI prompts and customization behavior */
  assistantType?: 'query' | 'config' | 'code' | 'text';
  /** Child blocks to wrap with assistant functionality */
  blocks: JsonBlock[];
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

// ============ CONDITIONAL BLOCK ============

/**
 * Display mode for conditional blocks.
 * - 'inline': Content renders directly without wrapper (default)
 * - 'section': Content wrapped with section styling, collapse controls, and "Do" button
 */
export type ConditionalDisplayMode = 'inline' | 'section';

/**
 * Configuration for a conditional section branch.
 * Each branch (pass/fail) can have its own section configuration.
 */
export interface ConditionalSectionConfig {
  /** Section title for this branch */
  title?: string;
  /** Requirements that must be met before this section is accessible */
  requirements?: string[];
  /** Objectives tracked for completion of this section */
  objectives?: string[];
}

/**
 * Conditional block that shows different content based on conditions.
 * Evaluates conditions at runtime and displays the appropriate branch.
 * Uses the same condition syntax as requirements (e.g., has-datasource:prometheus).
 */
export interface JsonConditionalBlock {
  type: 'conditional';
  /** Conditions that determine which branch to show (uses requirement syntax) */
  conditions: string[];
  /** Blocks shown when ALL conditions pass */
  whenTrue: JsonBlock[];
  /** Blocks shown when ANY condition fails */
  whenFalse: JsonBlock[];
  /** Optional description for authors (not shown to users) */
  description?: string;
  /** Display mode: 'inline' (default) or 'section' for section-styled rendering */
  display?: ConditionalDisplayMode;
  /** Target element for exists-reftarget condition (CSS selector or button text) */
  reftarget?: string;
  /** Section config for the 'pass' branch (only used when display is 'section') */
  whenTrueSectionConfig?: ConditionalSectionConfig;
  /** Section config for the 'fail' branch (only used when display is 'section') */
  whenFalseSectionConfig?: ConditionalSectionConfig;
}

// ============ INTERACTIVE BLOCKS ============

/**
 * Action types for JSON guide interactive elements.
 * Named differently from collaboration.types.ts InteractiveAction to avoid conflicts.
 */
export type JsonInteractiveAction = 'highlight' | 'button' | 'formfill' | 'navigate' | 'hover' | 'noop';

/**
 * Single-action interactive step.
 * Renders with "Show me" and "Do it" buttons by default.
 * Use showMe/doIt to control button visibility.
 * Supports AI customization via AssistantProps.
 */
export interface JsonInteractiveBlock extends AssistantProps {
  type: 'interactive';
  /** The action to perform */
  action: JsonInteractiveAction;
  /** CSS selector or Grafana selector for the target element (optional for noop actions) */
  reftarget?: string;
  /** Value for formfill actions (supports regex patterns starting with ^ or $ or enclosed in /pattern/) */
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
  /** Hint shown when form validation fails (for formfill actions with regex patterns) */
  formHint?: string;
  /** Enable strict validation for formfill (require targetvalue match). Default: false (any non-empty input) */
  validateInput?: boolean;

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

  // ---- Lazy Render Support ----
  /** Enable progressive scroll discovery for virtualized containers (default: false) */
  lazyRender?: boolean;
  /** CSS selector for the scroll container when lazyRender is enabled (default: ".scrollbar-view") */
  scrollContainer?: string;
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
  /** CSS selector or Grafana selector for the target element (optional for noop actions) */
  reftarget?: string;
  /** Value for formfill actions (supports regex patterns starting with ^ or $ or enclosed in /pattern/) */
  targetvalue?: string;
  /** Requirements for this specific step */
  requirements?: string[];
  /** Tooltip shown during this step (multistep) */
  tooltip?: string;
  /** Description shown in the steps panel (guided) */
  description?: string;
  /** Whether this step can be skipped (guided only) */
  skippable?: boolean;
  /** Hint shown when form validation fails (for formfill actions with regex patterns) */
  formHint?: string;
  /** Enable strict validation for formfill (require targetvalue match). Default: false (any non-empty input) */
  validateInput?: boolean;
  /** Enable progressive scroll discovery for virtualized containers (default: false) */
  lazyRender?: boolean;
  /** CSS selector for the scroll container when lazyRender is enabled */
  scrollContainer?: string;
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

// ============ INPUT BLOCK ============

/**
 * Input block for collecting user responses.
 * Responses can be stored and used as variables elsewhere in the guide:
 * - As requirements (e.g., "var-policyAccepted:true")
 * - As variable substitution in content (e.g., "{{datasourceName}}")
 * - As targetvalue in interactive blocks
 * - As variable substitution in reftarget selectors (e.g., "button:contains({{myDatasource}})")
 */
export interface JsonInputBlock {
  type: 'input';
  /** The prompt/question text (supports markdown) */
  prompt: string;
  /** Input type determines the UI: text input, checkbox, or datasource picker */
  inputType: 'text' | 'boolean' | 'datasource';
  /** Variable name for storing/referencing the response */
  variableName: string;
  /** Placeholder text (for text input) */
  placeholder?: string;
  /** Label for boolean checkbox */
  checkboxLabel?: string;
  /** Default value */
  defaultValue?: string | boolean;
  /** Whether a response is required to proceed */
  required?: boolean;
  /** Regex pattern for text validation */
  pattern?: string;
  /** Message shown when validation fails */
  validationMessage?: string;
  /** Requirements that must be met for this input */
  requirements?: string[];
  /** Whether this input can be skipped */
  skippable?: boolean;
  /** Filter datasources by type (e.g., 'prometheus', 'loki'). Only used when inputType is 'datasource'. */
  datasourceFilter?: string;
}

// ============ TERMINAL BLOCK ============

/**
 * Terminal command block.
 * Renders a shell command with "Copy" and "Exec" buttons.
 * Copy copies to clipboard; Exec sends the command to the connected Coda terminal.
 * Participates in sections and step counting like other interactive blocks.
 * @coupling Zod schema: JsonTerminalBlockSchema in json-guide.schema.ts
 */
export interface JsonTerminalBlock {
  type: 'terminal';
  /** The shell command to display and execute */
  command: string;
  /** Markdown description shown to the user */
  content: string;
  /** Requirements that must be met for this step */
  requirements?: string[];
  /** Objectives tracked for this step */
  objectives?: string[];
  /** Whether this step can be skipped if requirements fail */
  skippable?: boolean;
  /** Hint shown when step cannot be completed */
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
 * Type guard for JsonConditionalBlock
 */
export function isConditionalBlock(block: JsonBlock): block is JsonConditionalBlock {
  return block.type === 'conditional';
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

/**
 * Type guard for JsonAssistantBlock
 */
export function isAssistantBlock(block: JsonBlock): block is JsonAssistantBlock {
  return block.type === 'assistant';
}

/**
 * Type guard for JsonInputBlock
 */
export function isInputBlock(block: JsonBlock): block is JsonInputBlock {
  return block.type === 'input';
}

/**
 * Type guard for JsonTerminalBlock
 */
export function isTerminalBlock(block: JsonBlock): block is JsonTerminalBlock {
  return block.type === 'terminal';
}

/**
 * Type guard to check if a block has assistant customization enabled
 */
export function hasAssistantEnabled(block: JsonBlock): block is JsonBlock & AssistantProps {
  return 'assistantEnabled' in block && block.assistantEnabled === true;
}
