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
export const JsonInteractiveActionSchema = z.enum(['highlight', 'button', 'formfill', 'navigate', 'hover', 'noop']);

// ============ QUIZ SCHEMAS ============

/**
 * Schema for quiz choice.
 * @coupling Type: JsonQuizChoice
 */
export const JsonQuizChoiceSchema = z.object({
  id: z.string().min(1, 'Choice id is required'),
  text: z.string().min(1, 'Choice text is required'),
  correct: z.boolean().optional(),
  hint: z.string().optional(),
});

// ============ STEP SCHEMA ============

/**
 * Schema for individual step within multistep/guided blocks.
 * @coupling Type: JsonStep
 */
export const JsonStepSchema = z
  .object({
    action: JsonInteractiveActionSchema,
    // reftarget is optional for noop actions (informational steps)
    reftarget: z.string().optional(),
    targetvalue: z.string().optional(),
    requirements: z.array(z.string()).optional(),
    tooltip: z.string().optional(),
    description: z.string().optional(),
    skippable: z.boolean().optional(),
    formHint: z.string().optional(),
    validateInput: z.boolean().optional(),
    lazyRender: z.boolean().optional(),
    scrollContainer: z.string().optional(),
  })
  .refine(
    (step) => {
      // Non-noop actions require a reftarget
      if (step.action !== 'noop' && (!step.reftarget || step.reftarget.trim() === '')) {
        return false;
      }
      return true;
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
  content: z.string().min(1, 'Markdown content is required'),
  // Assistant customization props
  ...AssistantPropsSchema.shape,
});

/**
 * Schema for HTML block.
 * @coupling Type: JsonHtmlBlock
 */
export const JsonHtmlBlockSchema = z.object({
  type: z.literal('html'),
  content: z.string().min(1, 'HTML content is required'),
});

/**
 * Schema for image block.
 * @coupling Type: JsonImageBlock
 */
export const JsonImageBlockSchema = z.object({
  type: z.literal('image'),
  src: SafeUrlSchema,
  alt: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});

/**
 * Schema for video block.
 * @coupling Type: JsonVideoBlock
 */
export const JsonVideoBlockSchema = z.object({
  type: z.literal('video'),
  src: SafeUrlSchema,
  provider: z.enum(['youtube', 'native']).optional(),
  title: z.string().optional(),
  start: z.number().min(0).optional(),
  end: z.number().min(0).optional(),
});

// ============ INTERACTIVE BLOCK SCHEMAS ============

/**
 * Schema for single-action interactive block with assistant props.
 * @coupling Type: JsonInteractiveBlock
 */
export const JsonInteractiveBlockSchema = z
  .object({
    type: z.literal('interactive'),
    action: JsonInteractiveActionSchema,
    // reftarget is optional for noop actions (informational steps)
    reftarget: z.string().optional(),
    targetvalue: z.string().optional(),
    content: z.string().min(1, 'Interactive content is required'),
    tooltip: z.string().optional(),
    requirements: z.array(z.string()).optional(),
    objectives: z.array(z.string()).optional(),
    skippable: z.boolean().optional(),
    hint: z.string().optional(),
    formHint: z.string().optional(),
    validateInput: z.boolean().optional(),
    showMe: z.boolean().optional(),
    doIt: z.boolean().optional(),
    completeEarly: z.boolean().optional(),
    verify: z.string().optional(),
    lazyRender: z.boolean().optional(),
    scrollContainer: z.string().optional(),
    // Assistant customization props
    ...AssistantPropsSchema.shape,
  })
  .refine(
    (block) => {
      // Non-noop actions require a reftarget
      if (block.action !== 'noop') {
        return block.reftarget !== undefined && block.reftarget.trim() !== '';
      }
      return true;
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
  );

/**
 * Schema for multistep block.
 * @coupling Type: JsonMultistepBlock
 */
export const JsonMultistepBlockSchema = z.object({
  type: z.literal('multistep'),
  content: z.string().min(1, 'Multistep content is required'),
  steps: z.array(JsonStepSchema).min(1, 'At least one step is required'),
  requirements: z.array(z.string()).optional(),
  objectives: z.array(z.string()).optional(),
  skippable: z.boolean().optional(),
});

/**
 * Schema for guided block.
 * @coupling Type: JsonGuidedBlock
 */
export const JsonGuidedBlockSchema = z.object({
  type: z.literal('guided'),
  content: z.string().min(1, 'Guided content is required'),
  steps: z.array(JsonStepSchema).min(1, 'At least one step is required'),
  stepTimeout: z.number().optional(),
  requirements: z.array(z.string()).optional(),
  objectives: z.array(z.string()).optional(),
  skippable: z.boolean().optional(),
  completeEarly: z.boolean().optional(),
});

/**
 * Schema for quiz block.
 * @coupling Type: JsonQuizBlock
 */
export const JsonQuizBlockSchema = z.object({
  type: z.literal('quiz'),
  question: z.string().min(1, 'Quiz question is required'),
  choices: z.array(JsonQuizChoiceSchema).min(1, 'At least one choice is required'),
  multiSelect: z.boolean().optional(),
  completionMode: z.enum(['correct-only', 'max-attempts']).optional(),
  maxAttempts: z.number().optional(),
  requirements: z.array(z.string()).optional(),
  skippable: z.boolean().optional(),
});

/**
 * Schema for input block (collects user responses).
 * @coupling Type: JsonInputBlock
 */
export const JsonInputBlockSchema = z.object({
  type: z.literal('input'),
  prompt: z.string().min(1, 'Input prompt is required'),
  inputType: z.enum(['text', 'boolean', 'datasource']),
  variableName: z
    .string()
    .min(1, 'Variable name is required')
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Variable name must be a valid identifier'),
  placeholder: z.string().optional(),
  checkboxLabel: z.string().optional(),
  defaultValue: z.union([z.string(), z.boolean()]).optional(),
  required: z.boolean().optional(),
  pattern: z.string().optional(),
  validationMessage: z.string().optional(),
  requirements: z.array(z.string()).optional(),
  skippable: z.boolean().optional(),
  datasourceFilter: z.string().optional(),
});

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
]);

// ============ RECURSIVE BLOCK SCHEMAS ============

// Common properties for recursive blocks to avoid duplication
const SectionProps = {
  type: z.literal('section'),
  id: z.string().optional(),
  title: z.string().optional(),
  requirements: z.array(z.string()).optional(),
  objectives: z.array(z.string()).optional(),
};

const AssistantProps = {
  type: z.literal('assistant'),
  assistantId: z.string().optional(),
  assistantType: z.enum(['query', 'config', 'code', 'text']).optional(),
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
  conditions: z.array(z.string()).min(1, 'At least one condition is required'),
  description: z.string().optional(),
  display: z.enum(['inline', 'section']).optional(),
  reftarget: z.string().optional(),
  whenTrueSectionConfig: ConditionalSectionConfigSchema.optional(),
  whenFalseSectionConfig: ConditionalSectionConfigSchema.optional(),
};

const MAX_NESTING_DEPTH = 5;

// Helper to create depth-limited block schema
function createBlockSchemaWithDepth(currentDepth: number): z.ZodSchema {
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
export const CURRENT_SCHEMA_VERSION = '1.0.0';

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
export const JsonGuideSchema = JsonGuideSchemaStrict.passthrough();

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
  markdown: new Set(['type', 'content', 'assistantEnabled', 'assistantId', 'assistantType']),
  html: new Set(['type', 'content']),
  image: new Set(['type', 'src', 'alt', 'width', 'height']),
  video: new Set(['type', 'src', 'provider', 'title', 'start', 'end']),
  interactive: new Set([
    'type',
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
  multistep: new Set(['type', 'content', 'steps', 'requirements', 'objectives', 'skippable']),
  guided: new Set([
    'type',
    'content',
    'steps',
    'stepTimeout',
    'requirements',
    'objectives',
    'skippable',
    'completeEarly',
  ]),
  section: new Set(['type', 'id', 'title', 'blocks', 'requirements', 'objectives']),
  conditional: new Set([
    'type',
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
  assistant: new Set(['type', 'assistantId', 'assistantType', 'blocks']),
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
]);
