"use strict";
/**
 * Zod Schemas for JSON Guide Types
 *
 * Runtime validation schemas that mirror the TypeScript types in json-guide.types.ts.
 * Type coupling is verified by tests in src/validation/__tests__/type-coupling.test.ts.
 *
 * @coupling Types: json-guide.types.ts - schemas must stay in sync with types
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VALID_BLOCK_TYPES = exports.KNOWN_FIELDS = exports.JsonGuideSchema = exports.JsonGuideSchemaStrict = exports.JsonBlockSchema = exports.JsonAssistantBlockSchema = exports.JsonSectionBlockSchema = exports.JsonQuizBlockSchema = exports.JsonGuidedBlockSchema = exports.JsonMultistepBlockSchema = exports.JsonInteractiveBlockSchema = exports.JsonVideoBlockSchema = exports.JsonImageBlockSchema = exports.JsonHtmlBlockSchema = exports.JsonMarkdownBlockSchema = exports.JsonStepSchema = exports.JsonQuizChoiceSchema = exports.JsonMatchMetadataSchema = exports.JsonInteractiveActionSchema = void 0;
const zod_1 = require("zod");
// ============ PRIMITIVE SCHEMAS ============
/**
 * Schema for interactive action types.
 * @coupling Type: JsonInteractiveAction
 */
exports.JsonInteractiveActionSchema = zod_1.z.enum(['highlight', 'button', 'formfill', 'navigate', 'hover']);
// ============ MATCH METADATA ============
/**
 * Schema for guide match metadata.
 * @coupling Type: JsonMatchMetadata
 */
exports.JsonMatchMetadataSchema = zod_1.z.object({
    urlPrefix: zod_1.z.array(zod_1.z.string()).optional(),
    tags: zod_1.z.array(zod_1.z.string()).optional(),
});
// ============ QUIZ SCHEMAS ============
/**
 * Schema for quiz choice.
 * @coupling Type: JsonQuizChoice
 */
exports.JsonQuizChoiceSchema = zod_1.z.object({
    id: zod_1.z.string().min(1, 'Choice id is required'),
    text: zod_1.z.string().min(1, 'Choice text is required'),
    correct: zod_1.z.boolean().optional(),
    hint: zod_1.z.string().optional(),
});
// ============ STEP SCHEMA ============
/**
 * Schema for individual step within multistep/guided blocks.
 * @coupling Type: JsonStep
 */
exports.JsonStepSchema = zod_1.z.object({
    action: exports.JsonInteractiveActionSchema,
    reftarget: zod_1.z.string().min(1, 'Step reftarget is required'),
    targetvalue: zod_1.z.string().optional(),
    requirements: zod_1.z.array(zod_1.z.string()).optional(),
    tooltip: zod_1.z.string().optional(),
    description: zod_1.z.string().optional(),
    skippable: zod_1.z.boolean().optional(),
}).refine((step) => step.action !== 'formfill' || (step.targetvalue !== undefined && step.targetvalue !== ''), { message: "formfill action requires 'targetvalue'" });
// ============ CONTENT BLOCK SCHEMAS ============
/**
 * Schema for markdown block.
 * @coupling Type: JsonMarkdownBlock
 */
exports.JsonMarkdownBlockSchema = zod_1.z.object({
    type: zod_1.z.literal('markdown'),
    content: zod_1.z.string().min(1, 'Markdown content is required'),
});
/**
 * Schema for HTML block.
 * @coupling Type: JsonHtmlBlock
 */
exports.JsonHtmlBlockSchema = zod_1.z.object({
    type: zod_1.z.literal('html'),
    content: zod_1.z.string().min(1, 'HTML content is required'),
});
/**
 * Schema for image block.
 * @coupling Type: JsonImageBlock
 */
exports.JsonImageBlockSchema = zod_1.z.object({
    type: zod_1.z.literal('image'),
    src: zod_1.z.string().min(1, 'Image src is required'),
    alt: zod_1.z.string().optional(),
    width: zod_1.z.number().optional(),
    height: zod_1.z.number().optional(),
});
/**
 * Schema for video block.
 * @coupling Type: JsonVideoBlock
 */
exports.JsonVideoBlockSchema = zod_1.z.object({
    type: zod_1.z.literal('video'),
    src: zod_1.z.string().min(1, 'Video src is required'),
    provider: zod_1.z.enum(['youtube', 'native']).optional(),
    title: zod_1.z.string().optional(),
});
// ============ INTERACTIVE BLOCK SCHEMAS ============
/**
 * Schema for single-action interactive block.
 * @coupling Type: JsonInteractiveBlock
 */
exports.JsonInteractiveBlockSchema = zod_1.z.object({
    type: zod_1.z.literal('interactive'),
    action: exports.JsonInteractiveActionSchema,
    reftarget: zod_1.z.string().min(1, 'Interactive reftarget is required'),
    targetvalue: zod_1.z.string().optional(),
    content: zod_1.z.string().min(1, 'Interactive content is required'),
    tooltip: zod_1.z.string().optional(),
    requirements: zod_1.z.array(zod_1.z.string()).optional(),
    objectives: zod_1.z.array(zod_1.z.string()).optional(),
    skippable: zod_1.z.boolean().optional(),
    hint: zod_1.z.string().optional(),
    showMe: zod_1.z.boolean().optional(),
    doIt: zod_1.z.boolean().optional(),
    completeEarly: zod_1.z.boolean().optional(),
    verify: zod_1.z.string().optional(),
}).refine((block) => block.action !== 'formfill' || (block.targetvalue !== undefined && block.targetvalue !== ''), { message: "formfill action requires 'targetvalue'" });
/**
 * Schema for multistep block.
 * @coupling Type: JsonMultistepBlock
 */
exports.JsonMultistepBlockSchema = zod_1.z.object({
    type: zod_1.z.literal('multistep'),
    content: zod_1.z.string().min(1, 'Multistep content is required'),
    steps: zod_1.z.array(exports.JsonStepSchema).min(1, 'At least one step is required'),
    requirements: zod_1.z.array(zod_1.z.string()).optional(),
    objectives: zod_1.z.array(zod_1.z.string()).optional(),
    skippable: zod_1.z.boolean().optional(),
});
/**
 * Schema for guided block.
 * @coupling Type: JsonGuidedBlock
 */
exports.JsonGuidedBlockSchema = zod_1.z.object({
    type: zod_1.z.literal('guided'),
    content: zod_1.z.string().min(1, 'Guided content is required'),
    steps: zod_1.z.array(exports.JsonStepSchema).min(1, 'At least one step is required'),
    stepTimeout: zod_1.z.number().optional(),
    requirements: zod_1.z.array(zod_1.z.string()).optional(),
    objectives: zod_1.z.array(zod_1.z.string()).optional(),
    skippable: zod_1.z.boolean().optional(),
    completeEarly: zod_1.z.boolean().optional(),
});
/**
 * Schema for quiz block.
 * @coupling Type: JsonQuizBlock
 */
exports.JsonQuizBlockSchema = zod_1.z.object({
    type: zod_1.z.literal('quiz'),
    question: zod_1.z.string().min(1, 'Quiz question is required'),
    choices: zod_1.z.array(exports.JsonQuizChoiceSchema).min(1, 'At least one choice is required'),
    multiSelect: zod_1.z.boolean().optional(),
    completionMode: zod_1.z.enum(['correct-only', 'max-attempts']).optional(),
    maxAttempts: zod_1.z.number().optional(),
    requirements: zod_1.z.array(zod_1.z.string()).optional(),
    skippable: zod_1.z.boolean().optional(),
});
// ============ BLOCK UNION (Non-recursive blocks) ============
/**
 * Schema for non-recursive block types.
 * Used as building block for the full union.
 */
const NonRecursiveBlockSchema = zod_1.z.union([
    exports.JsonMarkdownBlockSchema,
    exports.JsonHtmlBlockSchema,
    exports.JsonImageBlockSchema,
    exports.JsonVideoBlockSchema,
    exports.JsonInteractiveBlockSchema,
    exports.JsonMultistepBlockSchema,
    exports.JsonGuidedBlockSchema,
    exports.JsonQuizBlockSchema,
]);
// ============ RECURSIVE BLOCK SCHEMAS ============
/**
 * Schema for section block (contains nested blocks).
 * @coupling Type: JsonSectionBlock
 */
exports.JsonSectionBlockSchema = zod_1.z.object({
    type: zod_1.z.literal('section'),
    id: zod_1.z.string().optional(),
    title: zod_1.z.string().optional(),
    blocks: zod_1.z.lazy(() => zod_1.z.array(exports.JsonBlockSchema)),
    requirements: zod_1.z.array(zod_1.z.string()).optional(),
    objectives: zod_1.z.array(zod_1.z.string()).optional(),
});
/**
 * Schema for assistant block (contains nested blocks).
 * @coupling Type: JsonAssistantBlock
 */
exports.JsonAssistantBlockSchema = zod_1.z.object({
    type: zod_1.z.literal('assistant'),
    assistantId: zod_1.z.string().optional(),
    assistantType: zod_1.z.enum(['query', 'config', 'code', 'text']).optional(),
    blocks: zod_1.z.lazy(() => zod_1.z.array(exports.JsonBlockSchema)),
});
// ============ BLOCK UNION (Full) ============
/**
 * Discriminated union schema for all block types.
 * Uses Zod's union for flexible parsing.
 * @coupling Type: JsonBlock
 */
exports.JsonBlockSchema = zod_1.z.union([
    NonRecursiveBlockSchema,
    exports.JsonSectionBlockSchema,
    exports.JsonAssistantBlockSchema,
]);
// ============ ROOT GUIDE SCHEMA ============
/**
 * Root schema for JSON guide (strict - no extra fields allowed).
 * @coupling Type: JsonGuide
 */
exports.JsonGuideSchemaStrict = zod_1.z.object({
    schemaVersion: zod_1.z.string().optional(),
    id: zod_1.z.string().min(1, 'Guide id is required'),
    title: zod_1.z.string().min(1, 'Guide title is required'),
    blocks: zod_1.z.array(exports.JsonBlockSchema),
    match: exports.JsonMatchMetadataSchema.optional(),
});
/**
 * Root schema for JSON guide with passthrough (allows unknown fields).
 * Use this for forward compatibility - newer guides with new fields won't fail.
 * @coupling Type: JsonGuide
 */
exports.JsonGuideSchema = exports.JsonGuideSchemaStrict.passthrough();
// ============ KNOWN FIELDS FOR UNKNOWN FIELD DETECTION ============
/**
 * Known fields for each block type.
 * Used by unknown-fields.ts to detect unknown fields for forward compatibility warnings.
 * Keep in sync with the schemas above.
 */
exports.KNOWN_FIELDS = {
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
exports.VALID_BLOCK_TYPES = new Set([
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
