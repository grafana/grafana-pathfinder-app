/**
 * Zod Schemas for JSON Guide Types
 *
 * Runtime validation schemas that mirror the TypeScript types in json-guide.types.ts.
 * Type coupling is verified by tests in src/validation/__tests__/type-coupling.test.ts.
 *
 * @coupling Types: json-guide.types.ts - schemas must stay in sync with types
 */

import { z } from 'zod';

// ============ PRIMITIVE SCHEMAS ============

/**
 * Schema for safe URLs (http/https only).
 */
const SafeUrlSchema = z
  .string()
  .min(1)
  .refine(
    (url) => {
      try {
        const parsed = new URL(url, 'https://example.com');
        return ['http:', 'https:'].includes(parsed.protocol);
      } catch {
        return false;
      }
    },
    { error: 'URL must use http or https protocol' }
  );

/**
 * Schema for interactive action types.
 * @coupling Type: JsonInteractiveAction
 */
export const JsonInteractiveActionSchema = z.enum([
  'highlight',
  'button',
  'formfill',
  'navigate',
  'hover',
  'noop',
  'popout',
]);

/**
 * Allowed targetvalue values for the `popout` action.
 * - 'sidebar' docks the panel back into the Grafana sidebar.
 * - 'floating' undocks the panel into a floating window.
 */
const POPOUT_TARGET_VALUES = ['sidebar', 'floating'] as const;

// ============ QUIZ SCHEMAS ============

/**
 * Schema for quiz choice.
 * @coupling Type: JsonQuizChoice
 */
export const JsonQuizChoiceSchema = z.object({
  id: z.string().min(1, 'Choice id is required').describe('Choice identifier (e.g., "a", "b", "c")'),
  text: z.string().min(1, 'Choice text is required').describe('Visible choice text'),
  correct: z.boolean().optional().describe('Mark this choice as correct'),
  hint: z.string().optional().describe('Hint shown when this choice is selected'),
});

// ============ STEP SCHEMA ============

/**
 * Schema for individual step within multistep/guided blocks.
 * @coupling Type: JsonStep
 */
export const JsonStepSchema = z
  .object({
    action: JsonInteractiveActionSchema.describe('Action to perform on target element'),
    // reftarget is optional for noop actions (informational steps)
    reftarget: z
      .string()
      .optional()
      .describe('CSS selector or data-testid for the target element (required for non-noop actions)'),

    targetvalue: z
      .string()
      .optional()
      .describe('Value for formfill or popout (formfill: input value; popout: sidebar|floating)'),
    requirements: z.array(z.string()).optional().describe('Prerequisite conditions'),
    tooltip: z.string().optional().describe('Tooltip shown on highlighted element'),
    description: z.string().optional().describe('Step description shown to the user'),
    skippable: z.boolean().optional().describe('Allow user to skip this step'),
    formHint: z.string().optional().describe('Placeholder text for formfill input fields'),
    validateInput: z.boolean().optional().describe('Strictly validate formfill input against targetvalue'),
    lazyRender: z.boolean().optional().describe('Wait for target to appear in DOM (virtual scroll support)'),
    scrollContainer: z.string().optional().describe('CSS selector of scroll container for lazy-rendered targets'),
  })
  .refine(
    (step) => {
      // Actions that don't operate on a DOM element don't require reftarget
      if (step.action === 'noop' || step.action === 'popout') {
        return true;
      }
      return step.reftarget !== undefined && step.reftarget.trim() !== '';
    },
    { error: "Non-noop actions require 'reftarget'" }
  )
  .refine(
    (step) => {
      // formfill with validateInput: true requires targetvalue
      if (step.action === 'formfill' && step.validateInput === true) {
        return step.targetvalue !== undefined && step.targetvalue !== '';
      }
      return true;
    },
    { error: "formfill with validateInput requires 'targetvalue'" }
  )
  .refine(
    (step) => {
      // popout requires a valid targetvalue indicating the target panel mode
      if (step.action === 'popout') {
        return step.targetvalue !== undefined && POPOUT_TARGET_VALUES.includes(step.targetvalue as never);
      }
      return true;
    },
    { error: "popout actions require 'targetvalue' to be 'sidebar' or 'floating'" }
  );

// ============ ASSISTANT PROPS SCHEMA ============

/**
 * Schema for assistant customization properties.
 * Can be added to blocks that support AI-powered customization.
 * @coupling Type: AssistantProps
 */
export const AssistantPropsSchema = z.object({
  assistantEnabled: z.boolean().optional(),
  assistantId: z.string().optional(),
  assistantType: z.enum(['query', 'config', 'code', 'text']).optional(),
});

// ============ CONTENT BLOCK SCHEMAS ============

/**
 * Schema for markdown block with assistant props.
 * @coupling Type: JsonMarkdownBlock
 */
export const JsonMarkdownBlockSchema = z.object({
  type: z.literal('markdown'),
  id: z.string().optional().describe('Stable identifier for edit-block / remove-block addressing'),
  content: z.string().min(1, 'Markdown content is required').describe('Markdown body shown to the user'),
  // Assistant customization props
  ...AssistantPropsSchema.shape,
});

/**
 * Schema for HTML block.
 * @coupling Type: JsonHtmlBlock
 */
export const JsonHtmlBlockSchema = z.object({
  type: z.literal('html'),
  id: z.string().optional().describe('Stable identifier for edit-block / remove-block addressing'),
  content: z.string().min(1, 'HTML content is required').describe('Sanitized HTML body shown to the user'),
});

/**
 * Schema for image block.
 * @coupling Type: JsonImageBlock
 */
export const JsonImageBlockSchema = z.object({
  type: z.literal('image'),
  id: z.string().optional().describe('Stable identifier for edit-block / remove-block addressing'),
  src: SafeUrlSchema.describe('Image URL (http/https only)'),
  alt: z.string().optional().describe('Alt text for accessibility'),
  width: z.number().optional().describe('Display width in pixels'),
  height: z.number().optional().describe('Display height in pixels'),
});

/**
 * Schema for video block.
 * @coupling Type: JsonVideoBlock
 */
export const JsonVideoBlockSchema = z.object({
  type: z.literal('video'),
  id: z.string().optional().describe('Stable identifier for edit-block / remove-block addressing'),
  src: SafeUrlSchema.describe('Video URL (http/https only)'),
  provider: z.enum(['youtube', 'native']).optional().describe('Video provider hint'),
  title: z.string().optional().describe('Display title'),
  start: z.number().min(0).optional().describe('Start time in seconds'),
  end: z.number().min(0).optional().describe('End time in seconds'),
});

// ============ INTERACTIVE BLOCK SCHEMAS ============

/**
 * Schema for single-action interactive block with assistant props.
 * @coupling Type: JsonInteractiveBlock
 */
export const JsonInteractiveBlockSchema = z
  .object({
    type: z.literal('interactive'),
    id: z.string().optional().describe('Stable identifier for edit-block / remove-block addressing'),
    action: JsonInteractiveActionSchema.describe('Action to perform on target element'),
    // reftarget is optional for noop actions (informational steps)
    reftarget: z
      .string()
      .optional()
      .describe('CSS selector or data-testid for the target element (required for non-noop actions)'),

    targetvalue: z
      .string()
      .optional()
      .describe('Value for formfill or popout (formfill: input value; popout: sidebar|floating)'),
    content: z
      .string()
      .min(1, 'Interactive content is required')
      .describe('Instructional text shown to user (markdown)'),
    tooltip: z.string().optional().describe('Tooltip shown on highlighted element'),
    requirements: z
      .array(z.string())
      .optional()
      .describe('Prerequisite conditions (e.g., on-page:/dashboards, is-admin)'),
    objectives: z.array(z.string()).optional().describe('Learning objectives this block addresses'),
    skippable: z.boolean().optional().describe('Allow user to skip this block'),
    hint: z.string().optional().describe('Hint text shown if user is stuck'),
    formHint: z.string().optional().describe('Placeholder text for formfill input fields'),
    validateInput: z.boolean().optional().describe('Strictly validate formfill input against targetvalue'),
    showMe: z.boolean().optional().describe('Enable "Show me" button (highlights target without acting)'),
    doIt: z.boolean().optional().describe('Enable "Do it" button (performs action automatically)'),
    completeEarly: z.boolean().optional().describe('Allow completion before all steps done'),
    verify: z.string().optional().describe('CSS selector to check for verification after action'),
    lazyRender: z.boolean().optional().describe('Wait for target to appear in DOM (virtual scroll support)'),
    scrollContainer: z.string().optional().describe('CSS selector of scroll container for lazy-rendered targets'),
    openGuide: z.string().optional().describe('Guide ID to open when this block completes'),
    // Assistant customization props
    ...AssistantPropsSchema.shape,
  })
  .refine(
    (block) => {
      // Actions that don't operate on a DOM element don't require reftarget
      if (block.action === 'noop' || block.action === 'popout') {
        return true;
      }
      return block.reftarget !== undefined && block.reftarget.trim() !== '';
    },
    { error: "Non-noop actions require 'reftarget'" }
  )
  .refine(
    (block) => {
      // formfill with validateInput: true requires targetvalue
      if (block.action === 'formfill' && block.validateInput === true) {
        return block.targetvalue !== undefined && block.targetvalue !== '';
      }
      return true;
    },
    { error: "formfill with validateInput requires 'targetvalue'" }
  )
  .refine(
    (block) => {
      // popout requires a valid targetvalue indicating the target panel mode
      if (block.action === 'popout') {
        return block.targetvalue !== undefined && POPOUT_TARGET_VALUES.includes(block.targetvalue as never);
      }
      return true;
    },
    { error: "popout actions require 'targetvalue' to be 'sidebar' or 'floating'" }
  );

/**
 * Schema for multistep block.
 * @coupling Type: JsonMultistepBlock
 */
export const JsonMultistepBlockSchema = z.object({
  type: z.literal('multistep'),
  id: z.string().optional().describe('Stable identifier for this block (required for container blocks via CLI)'),
  content: z.string().min(1, 'Multistep content is required').describe('Block heading/intro text'),
  steps: z
    .array(JsonStepSchema)
    .min(1, 'At least one step is required')
    .describe('Ordered steps; populated via add-step'),
  requirements: z.array(z.string()).optional().describe('Prerequisite conditions'),
  objectives: z.array(z.string()).optional().describe('Learning objectives this block addresses'),
  skippable: z.boolean().optional().describe('Allow user to skip this block'),
});

/**
 * Schema for guided block.
 * @coupling Type: JsonGuidedBlock
 */
export const JsonGuidedBlockSchema = z.object({
  type: z.literal('guided'),
  id: z.string().optional().describe('Stable identifier for this block (required for container blocks via CLI)'),
  content: z.string().min(1, 'Guided content is required').describe('Block heading/intro text'),
  steps: z
    .array(JsonStepSchema)
    .min(1, 'At least one step is required')
    .describe('Ordered steps; populated via add-step'),
  stepTimeout: z.number().optional().describe('Per-step timeout in milliseconds'),
  requirements: z.array(z.string()).optional().describe('Prerequisite conditions'),
  objectives: z.array(z.string()).optional().describe('Learning objectives this block addresses'),
  skippable: z.boolean().optional().describe('Allow user to skip this block'),
  completeEarly: z.boolean().optional().describe('Allow completion before all steps done'),
});

/**
 * Schema for quiz block.
 * @coupling Type: JsonQuizBlock
 */
export const JsonQuizBlockSchema = z.object({
  type: z.literal('quiz'),
  id: z.string().optional().describe('Stable identifier for this block (required for container blocks via CLI)'),
  question: z.string().min(1, 'Quiz question is required').describe('Question text shown to the user'),
  choices: z
    .array(JsonQuizChoiceSchema)
    .min(1, 'At least one choice is required')
    .describe('Quiz choices; populated via add-choice'),
  multiSelect: z.boolean().optional().describe('Allow selecting more than one choice'),
  completionMode: z.enum(['correct-only', 'max-attempts']).optional().describe('How the quiz is considered complete'),
  maxAttempts: z.number().optional().describe('Number of attempts allowed when completionMode=max-attempts'),
  requirements: z.array(z.string()).optional().describe('Prerequisite conditions'),
  skippable: z.boolean().optional().describe('Allow user to skip this block'),
});

/**
 * Schema for input block (collects user responses).
 * @coupling Type: JsonInputBlock
 */
export const JsonInputBlockSchema = z.object({
  type: z.literal('input'),
  id: z.string().optional().describe('Stable identifier for edit-block / remove-block addressing'),
  prompt: z.string().min(1, 'Input prompt is required').describe('Prompt shown above the input'),
  inputType: z.enum(['text', 'boolean', 'datasource']).describe('Kind of input to render'),
  variableName: z
    .string()
    .min(1, 'Variable name is required')
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Variable name must be a valid identifier')
    .describe('Variable name used to reference the captured value (valid JS identifier)'),
  placeholder: z.string().optional().describe('Placeholder text for text input'),
  checkboxLabel: z.string().optional().describe('Label shown next to a boolean checkbox'),
  defaultValue: z.union([z.string(), z.boolean()]).optional().describe('Default value (string or boolean)'),
  required: z.boolean().optional().describe('Whether the input must be provided to continue'),
  pattern: z.string().optional().describe('Regex pattern the value must match (text inputs only)'),
  validationMessage: z.string().optional().describe('Message shown when validation fails'),
  requirements: z.array(z.string()).optional().describe('Prerequisite conditions'),
  skippable: z.boolean().optional().describe('Allow user to skip this block'),
  datasourceFilter: z.string().optional().describe('Filter for datasource input (e.g., loki, prometheus)'),
});

// ============ TERMINAL BLOCK SCHEMA ============

/**
 * Schema for terminal command block.
 * @coupling Type: JsonTerminalBlock
 */
export const JsonTerminalBlockSchema = z.object({
  type: z.literal('terminal'),
  id: z.string().optional().describe('Stable identifier for edit-block / remove-block addressing'),
  command: z.string().min(1, 'Terminal command is required').describe('Command to execute in the terminal'),
  content: z.string().min(1, 'Terminal content is required').describe('Instructional text shown to the user'),
  requirements: z.array(z.string()).optional().describe('Prerequisite conditions'),
  objectives: z.array(z.string()).optional().describe('Learning objectives this block addresses'),
  skippable: z.boolean().optional().describe('Allow user to skip this block'),
  hint: z.string().optional().describe('Hint text shown if user is stuck'),
});

// ============ TERMINAL CONNECT BLOCK SCHEMA ============

/**
 * Schema for terminal connect block.
 * @coupling Type: JsonTerminalConnectBlock
 */
export const JsonTerminalConnectBlockSchema = z.object({
  type: z.literal('terminal-connect'),
  id: z.string().optional().describe('Stable identifier for edit-block / remove-block addressing'),
  content: z.string().min(1, 'Terminal connect content is required').describe('Instructional text shown to the user'),
  buttonText: z.string().optional().describe('Connect button label'),
  vmTemplate: z.string().optional().describe('VM template to provision'),
  vmApp: z.string().optional().describe('App to launch in the VM'),
  vmScenario: z.string().optional().describe('Scenario to run in the VM'),
});

// ============ CODE BLOCK SCHEMA ============

/**
 * Schema for code block (insert into Monaco editors).
 * @coupling Type: JsonCodeBlockBlock
 */
export const JsonCodeBlockBlockSchema = z.object({
  type: z.literal('code-block'),
  id: z.string().optional().describe('Stable identifier for edit-block / remove-block addressing'),
  reftarget: z
    .string()
    .min(1, 'Code block reftarget is required')
    .describe('CSS selector for the target Monaco editor'),
  language: z.string().optional().describe('Source language hint (e.g., promql, logql, sql)'),
  code: z.string().min(1, 'Code is required').describe('Code to insert into the editor'),
  content: z.string().optional().describe('Optional instructional text shown above the code'),
  requirements: z.array(z.string()).optional().describe('Prerequisite conditions'),
  objectives: z.array(z.string()).optional().describe('Learning objectives this block addresses'),
  skippable: z.boolean().optional().describe('Allow user to skip this block'),
  hint: z.string().optional().describe('Hint text shown if user is stuck'),
});

// ============ GROT GUIDE BLOCK SCHEMA ============

/**
 * Schema for a grot guide CTA button.
 * @coupling Type: GrotGuideCta
 */
export const GrotGuideCtaSchema = z.object({
  text: z.string().min(1, 'CTA text is required'),
  screenId: z.string().min(1, 'CTA screenId is required'),
});

/**
 * Schema for the grot guide welcome screen.
 * @coupling Type: GrotGuideWelcome
 */
export const GrotGuideWelcomeSchema = z.object({
  title: z.string().min(1, 'Welcome title is required'),
  body: z.string().min(1, 'Welcome body is required'),
  ctas: z.array(GrotGuideCtaSchema).min(1, 'At least one CTA is required'),
});

/**
 * Schema for a grot guide option.
 * @coupling Type: GrotGuideOption
 */
export const GrotGuideOptionSchema = z.object({
  text: z.string().min(1, 'Option text is required'),
  screenId: z.string().min(1, 'Option screenId is required'),
});

/**
 * Schema for a grot guide question screen.
 * @coupling Type: GrotGuideQuestionScreen
 */
export const GrotGuideQuestionScreenSchema = z.object({
  type: z.literal('question'),
  id: z.string().min(1, 'Screen id is required'),
  title: z.string().min(1, 'Question title is required'),
  options: z.array(GrotGuideOptionSchema).min(1, 'At least one option is required'),
});

/**
 * Schema for a grot guide link item.
 * @coupling Type: GrotGuideLinkItem
 */
export const GrotGuideLinkItemSchema = z.object({
  type: z.string().optional(),
  title: z.string().min(1, 'Link title is required'),
  linkText: z.string().min(1, 'Link text is required'),
  href: SafeUrlSchema,
});

/**
 * Schema for a grot guide result screen.
 * @coupling Type: GrotGuideResultScreen
 */
export const GrotGuideResultScreenSchema = z.object({
  type: z.literal('result'),
  id: z.string().min(1, 'Screen id is required'),
  title: z.string().min(1, 'Result title is required'),
  body: z.string().min(1, 'Result body is required'),
  links: z.array(GrotGuideLinkItemSchema).optional(),
});

/**
 * Schema for grot guide screens (discriminated union).
 * @coupling Type: GrotGuideScreen
 */
export const GrotGuideScreenSchema = z.discriminatedUnion('type', [
  GrotGuideQuestionScreenSchema,
  GrotGuideResultScreenSchema,
]);

/**
 * Schema for grot guide block — a self-contained decision tree.
 * Validates that all screenId references point to existing screen IDs.
 * @coupling Type: JsonGrotGuideBlock
 */
export const JsonGrotGuideBlockSchema = z
  .object({
    type: z.literal('grot-guide'),
    welcome: GrotGuideWelcomeSchema,
    screens: z.array(GrotGuideScreenSchema).min(1, 'At least one screen is required'),
  })
  .refine(
    (block) => {
      // Validate all screenId references resolve to existing screens
      const screenIds = new Set(block.screens.map((s) => s.id));
      for (const cta of block.welcome.ctas) {
        if (!screenIds.has(cta.screenId)) {
          return false;
        }
      }
      for (const screen of block.screens) {
        if (screen.type === 'question') {
          for (const option of screen.options) {
            if (!screenIds.has(option.screenId)) {
              return false;
            }
          }
        }
      }
      return true;
    },
    { error: 'All screenId references must point to existing screen IDs' }
  );

// ============ BLOCK UNION (Non-recursive blocks) ============

/**
 * Schema for non-recursive block types.
 * Used as building block for the full union.
 */
const NonRecursiveBlockSchema = z.union([
  JsonMarkdownBlockSchema,
  JsonHtmlBlockSchema,
  JsonImageBlockSchema,
  JsonVideoBlockSchema,
  JsonInteractiveBlockSchema,
  JsonMultistepBlockSchema,
  JsonGuidedBlockSchema,
  JsonQuizBlockSchema,
  JsonInputBlockSchema,
  JsonTerminalBlockSchema,
  JsonTerminalConnectBlockSchema,
  JsonCodeBlockBlockSchema,
  JsonGrotGuideBlockSchema,
]);

// ============ RECURSIVE BLOCK SCHEMAS ============

// Common properties for recursive blocks to avoid duplication
const SectionProps = {
  type: z.literal('section'),
  id: z.string().optional().describe('Stable identifier for the section (required for container blocks via CLI)'),
  title: z.string().optional().describe('Section heading'),
  requirements: z.array(z.string()).optional().describe('Prerequisite conditions'),
  objectives: z.array(z.string()).optional().describe('Learning objectives this section addresses'),
  autoCollapse: z.boolean().optional().describe('Collapse the section after the user completes its contents'),
};

const AssistantProps = {
  type: z.literal('assistant'),
  id: z
    .string()
    .optional()
    .describe('Stable identifier for the assistant block (required for container blocks via CLI)'),
  assistantId: z.string().optional().describe('Assistant configuration identifier'),
  assistantType: z
    .enum(['query', 'config', 'code', 'text'])
    .optional()
    .describe('Kind of AI customization to enable inside this block'),
};

/**
 * Schema for conditional section config.
 * Each branch can have its own section configuration.
 * @coupling Type: ConditionalSectionConfig
 */
const ConditionalSectionConfigSchema = z.object({
  title: z.string().optional(),
  requirements: z.array(z.string()).optional(),
  objectives: z.array(z.string()).optional(),
});

const ConditionalProps = {
  type: z.literal('conditional'),
  id: z
    .string()
    .optional()
    .describe('Stable identifier for the conditional block (required for container blocks via CLI)'),
  conditions: z
    .array(z.string())
    .min(1, 'At least one condition is required')
    .describe('Requirement expressions evaluated to choose the active branch'),
  description: z.string().optional().describe('Description shown when the conditional acts as a section'),
  display: z
    .enum(['inline', 'section'])
    .optional()
    .describe('Render the conditional inline or as a collapsible section'),
  reftarget: z.string().optional().describe('CSS selector consumed by certain conditional styles'),
  whenTrueSectionConfig: ConditionalSectionConfigSchema.optional().describe(
    'Section config applied to the whenTrue branch'
  ),
  whenFalseSectionConfig: ConditionalSectionConfigSchema.optional().describe(
    'Section config applied to the whenFalse branch'
  ),
};

const MAX_NESTING_DEPTH = 5;

// Helper to create depth-limited block schema
function createBlockSchemaWithDepth(currentDepth: number): z.ZodType {
  if (currentDepth >= MAX_NESTING_DEPTH) {
    // At max depth, only allow non-recursive blocks
    return NonRecursiveBlockSchema;
  }

  const nestedBlockSchema = z.lazy(() => createBlockSchemaWithDepth(currentDepth + 1));

  return z.union([
    NonRecursiveBlockSchema,
    z.object({
      ...SectionProps,
      blocks: z.array(nestedBlockSchema),
    }),
    z.object({
      ...AssistantProps,
      blocks: z.array(nestedBlockSchema),
    }),
    z.object({
      ...ConditionalProps,
      whenTrue: z.array(nestedBlockSchema),
      whenFalse: z.array(nestedBlockSchema),
    }),
  ]);
}

/**
 * Discriminated union schema for all block types with depth limit.
 * @coupling Type: JsonBlock
 */
export const JsonBlockSchema = createBlockSchemaWithDepth(0);

/**
 * Schema for section block (contains nested blocks).
 * Uses JsonBlockSchema which enforces depth limit globally.
 * @coupling Type: JsonSectionBlock
 */
export const JsonSectionBlockSchema = z.object({
  ...SectionProps,
  blocks: z.lazy(() => z.array(JsonBlockSchema)),
});

/**
 * Schema for assistant block (contains nested blocks).
 * Uses JsonBlockSchema which enforces depth limit globally.
 * @coupling Type: JsonAssistantBlock
 */
export const JsonAssistantBlockSchema = z.object({
  ...AssistantProps,
  blocks: z.lazy(() => z.array(JsonBlockSchema)),
});

/**
 * Schema for conditional block (contains nested blocks in two branches).
 * Uses JsonBlockSchema which enforces depth limit globally.
 * @coupling Type: JsonConditionalBlock
 */
export const JsonConditionalBlockSchema = z.object({
  ...ConditionalProps,
  whenTrue: z.lazy(() => z.array(JsonBlockSchema)),
  whenFalse: z.lazy(() => z.array(JsonBlockSchema)),
});

// ============ ROOT GUIDE SCHEMA ============

/**
 * The current version of the schema.
 */
export const CURRENT_SCHEMA_VERSION = '1.1.0';

/**
 * Root schema for JSON guide (strict - no extra fields allowed).
 * @coupling Type: JsonGuide
 */
export const JsonGuideSchemaStrict = z.object({
  schemaVersion: z.string().optional(),
  id: z.string().min(1, 'Guide id is required'),
  title: z.string().min(1, 'Guide title is required'),
  blocks: z.array(JsonBlockSchema),
});

/**
 * Root schema for JSON guide with passthrough (allows unknown fields).
 * Use this for forward compatibility - newer guides with new fields won't fail.
 * @coupling Type: JsonGuide
 */
export const JsonGuideSchema = JsonGuideSchemaStrict.loose();

// ============ TYPE INFERENCE ============

/**
 * Inferred types from schemas - use these for type checking.
 */
export type InferredJsonGuide = z.infer<typeof JsonGuideSchemaStrict>;
export type InferredJsonBlock = z.infer<typeof NonRecursiveBlockSchema>;
export type InferredJsonStep = z.infer<typeof JsonStepSchema>;
export type InferredJsonQuizChoice = z.infer<typeof JsonQuizChoiceSchema>;

// ============ KNOWN FIELDS FOR UNKNOWN FIELD DETECTION ============

/**
 * Known fields for each block type.
 * Used by unknown-fields.ts to detect unknown fields for forward compatibility warnings.
 * Keep in sync with the schemas above.
 */
export const KNOWN_FIELDS: Record<string, ReadonlySet<string>> = {
  _guide: new Set(['schemaVersion', 'id', 'title', 'blocks']),
  _step: new Set([
    'action',
    'reftarget',

    'targetvalue',
    'requirements',
    'tooltip',
    'description',
    'skippable',
    'formHint',
    'validateInput',
    'lazyRender',
    'scrollContainer',
  ]),
  _choice: new Set(['id', 'text', 'correct', 'hint']),
  markdown: new Set(['type', 'id', 'content', 'assistantEnabled', 'assistantId', 'assistantType']),
  html: new Set(['type', 'id', 'content']),
  image: new Set(['type', 'id', 'src', 'alt', 'width', 'height']),
  video: new Set(['type', 'id', 'src', 'provider', 'title', 'start', 'end']),
  interactive: new Set([
    'type',
    'id',
    'action',
    'reftarget',

    'targetvalue',
    'content',
    'tooltip',
    'requirements',
    'objectives',
    'skippable',
    'hint',
    'formHint',
    'validateInput',
    'showMe',
    'doIt',
    'completeEarly',
    'verify',
    'lazyRender',
    'scrollContainer',
    'assistantEnabled',
    'assistantId',
    'assistantType',
  ]),
  multistep: new Set(['type', 'id', 'content', 'steps', 'requirements', 'objectives', 'skippable']),
  guided: new Set([
    'type',
    'id',
    'content',
    'steps',
    'stepTimeout',
    'requirements',
    'objectives',
    'skippable',
    'completeEarly',
  ]),
  section: new Set(['type', 'id', 'title', 'blocks', 'requirements', 'objectives', 'autoCollapse']),
  conditional: new Set([
    'type',
    'id',
    'conditions',
    'whenTrue',
    'whenFalse',
    'description',
    'display',
    'reftarget',
    'whenTrueSectionConfig',
    'whenFalseSectionConfig',
  ]),
  _conditionalSectionConfig: new Set(['title', 'requirements', 'objectives']),
  quiz: new Set([
    'type',
    'id',
    'question',
    'choices',
    'multiSelect',
    'completionMode',
    'maxAttempts',
    'requirements',
    'skippable',
  ]),
  input: new Set([
    'type',
    'id',
    'prompt',
    'inputType',
    'variableName',
    'placeholder',
    'checkboxLabel',
    'defaultValue',
    'required',
    'pattern',
    'validationMessage',
    'requirements',
    'skippable',
    'datasourceFilter',
  ]),
  assistant: new Set(['type', 'id', 'assistantId', 'assistantType', 'blocks']),
  terminal: new Set(['type', 'id', 'command', 'content', 'requirements', 'objectives', 'skippable', 'hint']),
  'terminal-connect': new Set(['type', 'id', 'content', 'buttonText', 'vmTemplate', 'vmApp', 'vmScenario']),
  'code-block': new Set([
    'type',
    'id',
    'reftarget',

    'language',
    'code',
    'content',
    'requirements',
    'objectives',
    'skippable',
    'hint',
  ]),
  'grot-guide': new Set(['type', 'welcome', 'screens']),
  _manifest: new Set([
    'schemaVersion',
    'id',
    'type',
    'repository',
    'milestones',
    'description',
    'language',
    'category',
    'author',
    'startingLocation',
    'depends',
    'recommends',
    'suggests',
    'provides',
    'conflicts',
    'replaces',
    'targeting',
    'testEnvironment',
  ]),
};

/**
 * All valid block type names.
 * Useful for validation and error messages.
 */
export const VALID_BLOCK_TYPES = new Set([
  'markdown',
  'html',
  'image',
  'video',
  'interactive',
  'multistep',
  'guided',
  'section',
  'conditional',
  'quiz',
  'input',
  'assistant',
  'terminal',
  'terminal-connect',
  'code-block',
  'grot-guide',
]);
