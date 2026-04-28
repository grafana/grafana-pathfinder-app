/**
 * Block schema registry.
 *
 * Maps CLI block-type names (the value of the `type` discriminator in
 * `content.json`) to their Zod schemas. Used by `add-block` to register one
 * subcommand per block type via the schema-options bridge, and by
 * `edit-block` to look up the schema for an existing block.
 *
 * The registry is the single place where new block types are wired into the
 * authoring CLI. Forgetting to register a block type added to
 * `VALID_BLOCK_TYPES` is caught by the completeness test in
 * `block-registry.test.ts`.
 */

import type { z } from 'zod';

import {
  JsonAssistantBlockSchema,
  JsonCodeBlockBlockSchema,
  JsonConditionalBlockSchema,
  JsonGuidedBlockSchema,
  JsonHtmlBlockSchema,
  JsonImageBlockSchema,
  JsonInputBlockSchema,
  JsonInteractiveBlockSchema,
  JsonMarkdownBlockSchema,
  JsonMultistepBlockSchema,
  JsonQuizBlockSchema,
  JsonSectionBlockSchema,
  JsonTerminalBlockSchema,
  JsonTerminalConnectBlockSchema,
  JsonVideoBlockSchema,
  VALID_BLOCK_TYPES,
} from '../../types/json-guide.schema';

/**
 * Block types that CLI authors can create with `add-block <type>`.
 *
 * The keys here are the discriminator strings written into `content.json`.
 * They must match the literal values in `VALID_BLOCK_TYPES` exactly — the
 * registry-completeness test enforces that every entry in `VALID_BLOCK_TYPES`
 * is either present here or in `CLI_EXCLUDED_BLOCK_TYPES`.
 *
 * Some entries — `JsonInteractiveBlockSchema`, the nested-block schemas — are
 * `.refine()`-wrapped or `z.lazy()`-wrapped at the source; Zod v4 keeps the
 * `.shape` accessor available through both, so the schema-options bridge can
 * still walk them.
 */
export const BLOCK_SCHEMA_MAP = {
  markdown: JsonMarkdownBlockSchema,
  html: JsonHtmlBlockSchema,
  image: JsonImageBlockSchema,
  video: JsonVideoBlockSchema,
  interactive: JsonInteractiveBlockSchema,
  multistep: JsonMultistepBlockSchema,
  guided: JsonGuidedBlockSchema,
  section: JsonSectionBlockSchema,
  conditional: JsonConditionalBlockSchema,
  quiz: JsonQuizBlockSchema,
  input: JsonInputBlockSchema,
  assistant: JsonAssistantBlockSchema,
  terminal: JsonTerminalBlockSchema,
  'terminal-connect': JsonTerminalConnectBlockSchema,
  'code-block': JsonCodeBlockBlockSchema,
} as const satisfies Record<string, z.ZodObject>;

/**
 * Block types intentionally excluded from the authoring CLI surface.
 *
 * `grot-guide` is authored through a dedicated decision-tree editor, not the
 * sequential block model — its `welcome` / `screens` fields are nested
 * objects with their own discriminated union and don't have a sensible
 * single-flag-per-field projection. Authors who need a grot-guide should use
 * the block editor; the CLI will reject `add-block grot-guide`.
 *
 * The completeness test asserts that this set, unioned with the keys of
 * `BLOCK_SCHEMA_MAP`, exactly matches `VALID_BLOCK_TYPES`. Adding a new block
 * type to `VALID_BLOCK_TYPES` therefore forces a deliberate decision: register
 * it for CLI authoring or document why it's excluded.
 */
export const CLI_EXCLUDED_BLOCK_TYPES: ReadonlySet<string> = new Set(['grot-guide']);

/**
 * Block-type discriminator strings the CLI knows how to create. Sourced
 * statically from `BLOCK_SCHEMA_MAP` keys so callers can use `BlockType` in
 * function signatures without losing type information.
 */
export type BlockType = keyof typeof BLOCK_SCHEMA_MAP;

/**
 * All block-type discriminators the CLI exposes via `add-block`. Stable
 * ordering: insertion order of `BLOCK_SCHEMA_MAP`. Useful for help output and
 * for iterating to register subcommands.
 */
export const BLOCK_TYPES: readonly BlockType[] = Object.keys(BLOCK_SCHEMA_MAP) as BlockType[];

/**
 * Container block types — those that hold child blocks, steps, or choices.
 * The CLI requires `--id` for these so subsequent `--parent <id>` commands
 * can target them. Leaf blocks fall back to auto-assigned `<type>-<n>` IDs.
 *
 * This list is the canonical answer to "does this block type need an
 * author-supplied id?" Used by `add-block` for the required-flag check and
 * by `inspect` to summarize containers vs leaves.
 */
export const CONTAINER_BLOCK_TYPES: ReadonlySet<BlockType> = new Set([
  'section',
  'conditional',
  'assistant',
  'multistep',
  'guided',
  'quiz',
]);

/**
 * Look up the Zod schema for a block-type discriminator. Returns `undefined`
 * for unknown types and for types in `CLI_EXCLUDED_BLOCK_TYPES`.
 *
 * The narrow return type (`z.ZodObject` vs the original refined shape) is
 * deliberate — callers that want to *validate* a block should still use the
 * full schema via direct import, not this getter. The registry is for
 * introspection and option generation.
 */
export function getBlockSchema(type: string): z.ZodObject | undefined {
  if (!(type in BLOCK_SCHEMA_MAP)) {
    return undefined;
  }
  return BLOCK_SCHEMA_MAP[type as BlockType] as unknown as z.ZodObject;
}

/**
 * Predicate for narrowing arbitrary strings to the registered `BlockType`
 * union. Useful at command boundaries where the user supplies a block-type
 * argument.
 */
export function isBlockType(type: string): type is BlockType {
  return type in BLOCK_SCHEMA_MAP;
}

/**
 * Predicate for container block types. Container blocks require `--id` from
 * the CLI author so they're addressable as `--parent <id>` in later
 * commands.
 */
export function isContainerBlockType(type: BlockType): boolean {
  return CONTAINER_BLOCK_TYPES.has(type);
}

// Coverage between `BLOCK_SCHEMA_MAP`, `CLI_EXCLUDED_BLOCK_TYPES`, and
// `VALID_BLOCK_TYPES` is enforced at runtime in `block-registry.test.ts`.
// `VALID_BLOCK_TYPES` is `Set<string>` at the type level (the literal members
// widen at construction), so the check has to live in test code, not in the
// type system.
void VALID_BLOCK_TYPES;
