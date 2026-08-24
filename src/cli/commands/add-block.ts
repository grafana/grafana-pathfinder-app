/**
 * `pathfinder-cli add-block <dir> <type> [flags]` — append a block to a guide.
 *
 * A command group: one variant per block type, each variant's parameters taken
 * from that block's Zod schema. Adding a new block type means adding it to
 * `BLOCK_SCHEMA_MAP` in the registry; the CLI subcommand and the agent-facing
 * variant both follow from that.
 */

import { z } from 'zod';

import {
  defineCommand,
  defineCommandGroup,
  mountCommanderGroup,
  pickContent,
  required,
  withPolicy,
  type CommandShape,
  type CommandSpec,
} from '../contracts';
import { BLOCK_SCHEMA_MAP, isContainerBlockType, type BlockType } from '../utils/block-registry';
import { assertCliBlockFields, CliValidationError } from '../utils/cli-validators';
import { appendBlock, mutateAndValidate, PackageIOError, type AppendBlockOptions } from '../utils/package-io';
import {
  issueToOutcome,
  manyIssuesOutcome,
  renderError,
  type CommandOutcome,
  type OutcomeWarning,
} from '../utils/output';
import { normalizeBlockInput } from '../utils/input-normalizers';
import { isNonEmptySelector, multistepCompositionHint, unverifiedSelectorWarning } from '../utils/warnings';
import {
  EMPTY_CHOICES_MESSAGE,
  EMPTY_CONDITIONS_MESSAGE,
  EMPTY_SCREENS_MESSAGE,
  EMPTY_STEPS_MESSAGE,
} from '../../types/json-guide.schema';
import type { JsonBlock } from '../../types/json-guide.types';

/**
 * Child collections a block schema owns that `add-block` must not expose: they are
 * filled by sibling commands (`add-block --parent`, `add-step`, `add-choice`) rather
 * than at creation time. An omission from this command rather than a global list of
 * names to skip — that list also caught fields that merely shared a name, which is
 * how `create --type` lost its flag (§3.4 i).
 */
const CHILD_COLLECTION_FIELDS = ['blocks', 'whenTrue', 'whenFalse', 'steps', 'choices'] as const;

/** Addressing, placement, and control parameters every block type accepts. */
function structuralShape(type: BlockType) {
  return {
    dir: z.string().describe('package directory containing content.json + manifest.json').meta({ role: 'io' }),
    parent: z
      .string()
      .optional()
      .describe('Append inside the container with this id (default: top level)')
      .meta({ role: 'addressing' }),
    branch: z
      .enum(['true', 'false'])
      .optional()
      .describe('Target branch when {@parent} is a conditional')
      .meta({ role: 'addressing' }),
    ifAbsent: z
      .boolean()
      .optional()
      .describe('Idempotent create: no-op when a matching container with {@id} already exists')
      .meta({ role: 'control' }),
    before: z
      .string()
      .optional()
      .describe(
        'Insert before this sibling id within the resolved parent (use at most one of {@before}/{@after}/{@position})'
      )
      .meta({ role: 'placement' }),
    after: z
      .string()
      .optional()
      .describe(
        'Insert after this sibling id within the resolved parent (use at most one of {@before}/{@after}/{@position})'
      )
      .meta({ role: 'placement' }),
    position: z
      .number()
      .int('{@position} must be a non-negative integer')
      .nonnegative('{@position} must be a non-negative integer')
      .optional()
      .describe(
        "0-based index in the parent's child array; 0 is first, length is append (use at most one of {@before}/{@after}/{@position})"
      )
      .meta({ role: 'placement' }),
    // A container is unreachable without an id, so the CLI requires one even though
    // the block schemas mark `id` optional (existing content predates the rule).
    // Declaring it lets `requiredByType` be derived rather than hand-patched, and
    // `missingCode`/`missingMessage` keep the published `CONTAINER_REQUIRES_ID` and
    // the reason for it.
    ...(isContainerBlockType(type)
      ? {
          id: z
            .string()
            .describe(`Stable identifier for the ${type} block (required for container blocks via CLI)`)
            .meta({
              role: 'addressing',
              missingCode: 'CONTAINER_REQUIRES_ID',
              missingMessage: `Block type "${type}" requires {@id} (container blocks must be addressable)`,
            }),
        }
      : {}),
  };
}

/** The one command shape for one block type. */
function addBlockVariant(type: BlockType): CommandSpec {
  const variantSchema = BLOCK_SCHEMA_MAP[type];
  const baseSchema = structuralShape(type);

  // Filter out the base shape parameters from the variant specific schema so we can tag content
  const remove = new Set(['type', ...CHILD_COLLECTION_FIELDS, ...Object.keys(baseSchema)]);
  const variantDelta = Object.fromEntries(Object.entries(variantSchema.shape).filter(([name]) => !remove.has(name)));

  let contentSchema: CommandShape = withPolicy(variantDelta, { role: 'content' });

  // A conditional with no conditions is structurally meaningless, so we manually append the required condition
  contentSchema =
    type === 'conditional' && contentSchema.conditions
      ? { ...contentSchema, conditions: required(contentSchema.conditions).meta({ role: 'content' }) }
      : contentSchema;

  const contentKeys = Object.keys(contentSchema);

  return defineCommand({
    name: type,
    summary: `Append a ${type} block`,
    schema: z.object({ ...baseSchema, ...contentSchema }),
    // The group supplies `type`; the block's own fields are gathered into `fields`
    // because the runner builds a block object out of them. Nothing is renamed on the
    // way through. `id` is narrowed because a non-container inherits it from its block
    // schema through a `Record<string, z.ZodType>` copy, so statically it is `unknown`.
    run: (input) =>
      runAddBlock({
        ...input,
        type,
        id: typeof input.id === 'string' ? input.id : undefined,
        // `id` is both the assigned identity and, under `--if-absent`, the
        // idempotency key, so it travels as content *and* as an address.
        fields: pickContent(input, [...contentKeys, 'id']),
      }),
  });
}

export const addBlockGroup = defineCommandGroup({
  name: 'add-block',
  summary: 'Append a block to a guide. One variant per block type.',
  discriminator: 'type',
  discriminatorDescription: 'Selects the add-block subcommand.',
  variants: new Map((Object.keys(BLOCK_SCHEMA_MAP) as BlockType[]).map((type) => [type, addBlockVariant(type)])),
});

// One presentation for all fifteen variants: `add-block markdown <dir>` and
// `add-block table <dir>` are the same command line with a different type.
export const addBlockCommand = mountCommanderGroup(addBlockGroup, {
  positionals: ['dir'],
  placeholders: { parent: 'id', branch: 'branch', before: 'id', after: 'id', position: 'n' },
});

/**
 * Named exactly as the command schema publishes its parameters. The mutators speak
 * a different vocabulary (`parentId`, `AppendBlockOptions`); translating inside the
 * body keeps the signature from disagreeing with the published interface.
 */
interface AddBlockArgs {
  dir: string;
  type: BlockType;
  parent?: string;
  branch?: 'true' | 'false';
  ifAbsent?: boolean;
  id?: string;
  before?: string;
  after?: string;
  position?: number;
  fields: Record<string, unknown>;
}

/**
 * Pure command body: builds the block from the supplied fields, appends it via
 * `appendBlock`, and persists only if the whole guide still validates.
 */
export async function runAddBlock(args: AddBlockArgs): Promise<CommandOutcome> {
  const schema = BLOCK_SCHEMA_MAP[args.type];

  // Already selected and type-correct on both paths — the variant schema parsed it —
  // and carries content plus `id`, with no structural keys to strip.
  const rawProjected: Record<string, unknown> = { ...args.fields };

  // M3 — CLI-side input normalization. Rewrite known-canonical-form fields
  // (e.g., YouTube watch/short URLs → embed) before any validator runs, so
  // the persisted block carries the canonical form AND the validator sees
  // a value it can pass. Accumulated warnings ride on the outcome.
  const { normalized: projected, warnings: normalizationWarnings } = normalizeBlockInput(args.type, rawProjected);

  // CLI-strict semantic checks (URLs, regex, selectors, ranges) — schemas
  // stay loose so existing content keeps loading; the CLI is what holds new
  // authoring input to a higher bar. See cli-validators.ts.
  try {
    assertCliBlockFields(args.type, projected);
  } catch (err) {
    if (err instanceof CliValidationError) {
      return {
        status: 'error',
        code: 'SCHEMA_VALIDATION',
        message: err.message,
      };
    }
    throw err;
  }

  // CLI-level structural guards that don't live in the schemas:
  // - `--branch` only makes sense when --parent is a conditional block.
  //   We can't fully verify the parent kind until the package is read, but
  //   we can refuse the case where no --parent was supplied at all.
  if (args.branch !== undefined && !args.parent) {
    return {
      status: 'error',
      code: 'SCHEMA_VALIDATION',
      message:
        '{@branch} can only be set when {@parent} points at a conditional block; either point {@parent} at a conditional, or drop {@branch}.',
    };
  }
  // - `conditional` blocks must declare at least one condition at creation
  //   time (an empty conditions array is structurally meaningless).
  if (args.type === 'conditional') {
    const conds = projected.conditions;
    if (!Array.isArray(conds) || conds.length === 0) {
      return {
        status: 'error',
        code: 'SCHEMA_VALIDATION',
        message: 'conditional: at least one {@conditions} value is required when adding a conditional block.',
      };
    }
  }

  const block: Record<string, unknown> = { type: args.type, ...projected };
  if (args.id) {
    block.id = args.id;
  }

  // Containers start out empty — the agent fills them via subsequent
  // add-block --parent, add-step --parent, or add-choice --parent calls.
  // Initializing the structural arrays here lets the candidate parse below
  // succeed; "container is empty" is a completeness concern surfaced at
  // standalone-validate time, not during authoring.
  initializeStructuralFields(block, args.type);

  if (isContainerBlockType(args.type) && !block.id) {
    return {
      status: 'error',
      code: 'CONTAINER_REQUIRES_ID',
      message: `Block type "${args.type}" requires --id (container blocks must be addressable)`,
    };
  }

  // Pre-validate the candidate block in isolation so a flag-level error
  // (e.g., a missing required field) surfaces before we even read the
  // package off disk. The deeper "does this fit into the guide" checks are
  // covered by `mutateAndValidate` after the append. Empty-container
  // completeness is filtered downstream because the authoring flow builds
  // containers up step-by-step.
  const candidateParse = schema.safeParse(block);
  if (!candidateParse.success) {
    const filtered = filterEmptyContainerIssues(candidateParse.error.issues);
    if (filtered.length > 0) {
      // Surface every issue at once so the agent fixes them in a single
      // retry instead of pinging the CLI for each missing required field.
      return manyIssuesOutcome(filtered, `${args.type} block`);
    }
  }

  const appendOptions: AppendBlockOptions = {
    parentId: args.parent,
    branch: args.branch,
    ifAbsent: args.ifAbsent,
    before: args.before,
    after: args.after,
    position: args.position,
  };

  let summary = '';
  let position = '';
  let appended = true;
  let assignedId = block.id as string | undefined;
  let legacyIdsMinted = 0;

  try {
    const result = await mutateAndValidate(args.dir, ({ content }) => {
      const out = appendBlockHelper(content, block, appendOptions);
      summary = out.summary;
      position = out.position;
      appended = out.appended;
      assignedId = out.id;
    });
    if (!result.validation.ok) {
      const issues = result.validation.issues;
      if (issues.length === 0) {
        return { status: 'error', code: 'SCHEMA_VALIDATION', message: 'Validation failed after append' };
      }
      if (issues.length === 1) {
        return issueToOutcome(issues[0]!, { issues });
      }
      // Multi-issue: keep the first issue's stable code, but render every
      // problem in the message so the agent doesn't replay the round-trip.
      const multi = manyIssuesOutcome(issues, `${args.type} block`);
      return { ...multi, code: issues[0]!.code, data: { ...(multi.data ?? {}), issues } };
    }
    legacyIdsMinted = result.state.idsAssignedOnRead ?? 0;
  } catch (err) {
    if (err instanceof PackageIOError) {
      return issueToOutcome(err.issues[0] ?? { code: err.code, message: err.message });
    }
    return {
      status: 'error',
      code: 'SCHEMA_VALIDATION',
      message: renderError(err),
    };
  }

  // Soft outcome-time hints. Normalization warnings (M3) ride on every
  // successful call — including idempotent no-ops, because the agent still
  // benefits from learning the canonical form. Composition / selector
  // signals only fire on actual append.
  const warnings: OutcomeWarning[] = [...normalizationWarnings];
  if (appended) {
    // Issue #8: agents default to `multistep` even when steps would compose
    // better as siblings.
    if (args.type === 'multistep') {
      warnings.push(multistepCompositionHint());
    }
    // Issue #3: the CLI cannot verify a selector against the live Grafana
    // DOM, but it CAN tell that a reftarget was written. Surface the soft
    // signal so a careful reviewer can grep for it.
    if (isNonEmptySelector(projected.reftarget)) {
      warnings.push(unverifiedSelectorWarning(`${position}/reftarget`));
    }
  }

  return {
    status: 'ok',
    summary,
    details: {
      type: args.type,
      id: assignedId ?? '',
      position,
      'package valid': true,
      ...(appended ? {} : { 'idempotent no-op': true }),
      ...(legacyIdsMinted > 0 ? { 'ids minted on legacy blocks': legacyIdsMinted } : {}),
    },
    ...(warnings.length > 0 ? { warnings } : {}),
    hints: appended ? hintsFor(args.type, args.parent, assignedId) : undefined,
    data: {
      type: args.type,
      id: assignedId,
      position,
      appended,
      ...(legacyIdsMinted > 0 ? { idsAssignedOnRead: legacyIdsMinted } : {}),
    },
  };
}

function appendBlockHelper(
  content: Parameters<typeof appendBlock>[0],
  block: Record<string, unknown>,
  options: AppendBlockOptions
) {
  const result = appendBlock(content, block as unknown as JsonBlock, options);
  const summary = result.appended
    ? `Added ${block.type as string}${result.id ? ` (id: ${result.id})` : ''} at ${result.position}`
    : `Block "${result.id}" already present (no change)`;
  return { summary, position: result.position, appended: result.appended, id: result.id };
}

function hintsFor(type: BlockType, parentId: string | undefined, assignedId: string | undefined): string[] {
  if (type === 'multistep' || type === 'guided') {
    return [`Add steps with: pathfinder-cli add-step <dir> --parent ${assignedId ?? '<id>'} --action <action>`];
  }
  if (type === 'quiz') {
    return [
      `Add choices with: pathfinder-cli add-choice <dir> --parent ${assignedId ?? '<id>'} --id <a|b|c> --text <text>`,
    ];
  }
  if (type === 'section' || type === 'assistant') {
    return [`Add child blocks with: pathfinder-cli add-block <type> <dir> --parent ${assignedId ?? '<id>'}`];
  }
  if (parentId) {
    return [`Continue inside "${parentId}" or add a new top-level block with: pathfinder-cli add-block <type> <dir>`];
  }
  return [`Add another block with: pathfinder-cli add-block <type> <dir>`];
}

/**
 * Containers always carry their structural arrays — even when empty — so the
 * Zod parse on the candidate block sees a well-formed object. The arrays are
 * populated by sibling commands (`add-block --parent`, `add-step`,
 * `add-choice`) in subsequent invocations.
 */
function initializeStructuralFields(block: Record<string, unknown>, type: BlockType): void {
  if (type === 'section' || type === 'assistant') {
    if (!Array.isArray(block.blocks)) {
      block.blocks = [];
    }
  } else if (type === 'conditional') {
    if (!Array.isArray(block.whenTrue)) {
      block.whenTrue = [];
    }
    if (!Array.isArray(block.whenFalse)) {
      block.whenFalse = [];
    }
  } else if (type === 'multistep' || type === 'guided') {
    if (!Array.isArray(block.steps)) {
      block.steps = [];
    }
  } else if (type === 'quiz') {
    if (!Array.isArray(block.choices)) {
      block.choices = [];
    }
  }
}

/**
 * Drop "at least one step/choice/screen is required" Zod errors from a
 * candidate-parse. These are completeness checks, not structure checks —
 * the authoring flow legitimately holds a transient empty container between
 * the create call and the first add-step / add-choice. The standalone
 * `validate` command (which uses validateGuide directly) still surfaces
 * these as errors at finalization time.
 */
const EMPTY_CONTAINER_COMPLETENESS_MESSAGES: ReadonlySet<string> = new Set([
  EMPTY_STEPS_MESSAGE,
  EMPTY_CHOICES_MESSAGE,
  EMPTY_SCREENS_MESSAGE,
  EMPTY_CONDITIONS_MESSAGE,
]);

function filterEmptyContainerIssues(
  issues: ReadonlyArray<{ path: readonly PropertyKey[]; message: string }>
): Array<{ path: readonly PropertyKey[]; message: string }> {
  return issues.filter((issue) => !EMPTY_CONTAINER_COMPLETENESS_MESSAGES.has(issue.message));
}
