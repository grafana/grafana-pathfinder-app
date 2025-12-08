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
const SafeUrlSchema = z.string().min(1).refine(
  (url) => {
    try {
      const parsed = new URL(url, 'https://example.com');
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  },
  { message: 'URL must use http or https protocol' }
);

/**
 * Schema for interactive action types.
 * @coupling Type: JsonInteractiveAction
 */
export const JsonInteractiveActionSchema = z.enum(['highlight', 'button', 'formfill', 'navigate', 'hover']);

// ============ MATCH METADATA ============

/**
 * Schema for guide match metadata.
 * @coupling Type: JsonMatchMetadata
 */
export const JsonMatchMetadataSchema = z.object({
  urlPrefix: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

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
export const JsonStepSchema = z.object({
  action: JsonInteractiveActionSchema,
  reftarget: z.string().min(1, 'Step reftarget is required'),
  targetvalue: z.string().optional(),
  requirements: z.array(z.string()).optional(),
  tooltip: z.string().optional(),
  description: z.string().optional(),
  skippable: z.boolean().optional(),
}).refine(
  (step) => step.action !== 'formfill' || (step.targetvalue !== undefined && step.targetvalue !== ''),
  { message: "formfill action requires 'targetvalue'" }
);

// ============ CONTENT BLOCK SCHEMAS ============

/**
 * Schema for markdown block.
 * @coupling Type: JsonMarkdownBlock
 */
export const JsonMarkdownBlockSchema = z.object({
  type: z.literal('markdown'),
  content: z.string().min(1, 'Markdown content is required'),
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
});

// ============ INTERACTIVE BLOCK SCHEMAS ============

/**
 * Schema for single-action interactive block.
 * @coupling Type: JsonInteractiveBlock
 */
export const JsonInteractiveBlockSchema = z.object({
  type: z.literal('interactive'),
  action: JsonInteractiveActionSchema,
  reftarget: z.string().min(1, 'Interactive reftarget is required'),
  targetvalue: z.string().optional(),
  content: z.string().min(1, 'Interactive content is required'),
  tooltip: z.string().optional(),
  requirements: z.array(z.string()).optional(),
  objectives: z.array(z.string()).optional(),
  skippable: z.boolean().optional(),
  hint: z.string().optional(),
  showMe: z.boolean().optional(),
  doIt: z.boolean().optional(),
  completeEarly: z.boolean().optional(),
  verify: z.string().optional(),
}).refine(
  (block) => block.action !== 'formfill' || (block.targetvalue !== undefined && block.targetvalue !== ''),
  { message: "formfill action requires 'targetvalue'" }
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

// ============ ROOT GUIDE SCHEMA ============

/**
 * Root schema for JSON guide (strict - no extra fields allowed).
 * @coupling Type: JsonGuide
 */
export const JsonGuideSchemaStrict = z.object({
  schemaVersion: z.string().optional(),
  id: z.string().min(1, 'Guide id is required'),
  title: z.string().min(1, 'Guide title is required'),
  blocks: z.array(JsonBlockSchema),
  match: JsonMatchMetadataSchema.optional(),
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
  _guide: new Set(['schemaVersion', 'id', 'title', 'blocks', 'match']),
  _match: new Set(['urlPrefix', 'tags']),
  _step: new Set(['action', 'reftarget', 'targetvalue', 'requirements', 'tooltip', 'description', 'skippable']),
  _choice: new Set(['id', 'text', 'correct', 'hint']),
  markdown: new Set(['type', 'content']),
  html: new Set(['type', 'content']),
  image: new Set(['type', 'src', 'alt', 'width', 'height']),
  video: new Set(['type', 'src', 'provider', 'title']),
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
    'showMe',
    'doIt',
    'completeEarly',
    'verify',
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
  'quiz',
  'assistant',
]);
