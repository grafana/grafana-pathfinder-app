/**
 * `pathfinder-cli add-block <dir> <type> [flags]` — append a block to a guide.
 *
 * One subcommand is registered per block type at startup, with its flag
 * surface generated from the block's Zod schema by `registerSchemaOptions`.
 * Adding a new block type means adding it to `BLOCK_SCHEMA_MAP` in the
 * registry; this command picks it up automatically.
 */

import { Command, InvalidArgumentError, Option } from 'commander';

import { BLOCK_SCHEMA_MAP, isContainerBlockType, type BlockType } from '../utils/block-registry';
import { assertCliBlockFields, CliValidationError } from '../utils/cli-validators';
import { appendBlock, mutateAndValidate, PackageIOError, type AppendBlockOptions } from '../utils/package-io';
import {
  issueToOutcome,
  manyIssuesOutcome,
  printOutcome,
  readOutputOptions,
  renderError,
  type CommandOutcome,
} from '../utils/output';
import { getSchemaRequiredFlagNames, parseOptionValues, registerSchemaOptions } from '../utils/schema-options';
import {
  EMPTY_CHOICES_MESSAGE,
  EMPTY_CONDITIONS_MESSAGE,
  EMPTY_SCREENS_MESSAGE,
  EMPTY_STEPS_MESSAGE,
} from '../../types/json-guide.schema';
import type { JsonBlock } from '../../types/json-guide.types';

export const addBlockCommand = new Command('add-block').description(
  'Append a block to a guide. One subcommand per block type. Usage: add-block <type> <dir> [flags]'
);

/**
 * Map of block type → array of logically-required flag names. Populated as
 * subcommands register; surfaced via `add-block --help` so authors can see
 * what each type needs without drilling into per-type help. Help-shape JSON
 * exposes this as `requiredByType` (additive key in the stability contract).
 */
export const REQUIRED_BY_BLOCK_TYPE: Record<string, string[]> = {};

for (const [type, schema] of Object.entries(BLOCK_SCHEMA_MAP) as Array<
  [BlockType, (typeof BLOCK_SCHEMA_MAP)[BlockType]]
>) {
  const sub = new Command(type)
    .description(`Append a ${type} block`)
    .argument('<dir>', 'package directory containing content.json + manifest.json')
    .addOption(new Option('--parent <id>', 'Append inside the container with this id (default: top level)'))
    .addOption(
      new Option('--branch <branch>', 'Target branch when --parent is a conditional').choices(['true', 'false'])
    )
    .addOption(new Option('--if-absent', 'Idempotent create: no-op when a matching container with --id already exists'))
    .addOption(
      new Option(
        '--before <id>',
        'Insert before this sibling id within the resolved parent (use at most one of --before/--after/--position)'
      )
    )
    .addOption(
      new Option(
        '--after <id>',
        'Insert after this sibling id within the resolved parent (use at most one of --before/--after/--position)'
      )
    )
    .addOption(
      new Option(
        '--position <n>',
        "0-based index in the parent's child array; 0 is first, length is append (use at most one of --before/--after/--position)"
      ).argParser((value: string) => {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0) {
          throw new InvalidArgumentError(`--position must be a non-negative integer, got "${value}"`);
        }
        return n;
      })
    );

  // Bridge: derive flags from the block's schema. The bridge skips `type`
  // (it's the subcommand name), `blocks`, `whenTrue`, `whenFalse`, `steps`,
  // and `choices` (managed by sibling commands).
  //
  // `forceOptional: true` defers required-field checking to the schema's
  // `safeParse` in `runAddBlock`. Commander otherwise short-circuits on the
  // first missing required option, forcing the agent to retry once per
  // missing flag; with all schema-required flags collected at parse time,
  // every missing field surfaces in a single error response. The set of
  // logically-required flags is recorded on the command for help output.
  registerSchemaOptions(sub, schema, { forceOptional: true });

  // Populate the per-type required-flags table. Container types (section,
  // multistep, guided, quiz, conditional, assistant) also require --id at the
  // CLI level even though the schema marks `id` optional, so authors see
  // every author-required flag in one glance. Mutate the subcommand's
  // schema-required set in place so help-shape JSON picks them up too.
  const requiredSet = getSchemaRequiredFlagNames(sub) as Set<string> | undefined;
  if (requiredSet) {
    if (isContainerBlockType(type as BlockType)) {
      requiredSet.add('id');
    }
    if (type === 'conditional') {
      requiredSet.add('conditions');
    }
  }
  REQUIRED_BY_BLOCK_TYPE[type] = [...(requiredSet ?? new Set<string>())];

  sub.action(async function (this: Command, dir: string) {
    const opts = this.opts() as Record<string, unknown>;
    const output = readOutputOptions(this);
    const outcome = await runAddBlock({
      dir,
      type: type as BlockType,
      parentId: typeof opts.parent === 'string' ? opts.parent : undefined,
      branch: opts.branch === 'true' || opts.branch === 'false' ? (opts.branch as 'true' | 'false') : undefined,
      ifAbsent: opts.ifAbsent === true,
      explicitId: typeof opts.id === 'string' ? opts.id : undefined,
      before: typeof opts.before === 'string' ? opts.before : undefined,
      after: typeof opts.after === 'string' ? opts.after : undefined,
      position: typeof opts.position === 'number' ? opts.position : undefined,
      flagValues: opts,
    });

    process.exit(printOutcome(outcome, output));
  });

  addBlockCommand.addCommand(sub);
}

// Append a "required by type" summary so a single `add-block --help` is
// enough to author any block type. Without this, authors run the parent
// help, then a per-type help, then begin authoring — paying two help
// round-trips per block type.
{
  const lines = ['', 'Required flags by type (run `add-block <type> --help` for the full surface):'];
  const padding = Math.max(...Object.keys(REQUIRED_BY_BLOCK_TYPE).map((k) => k.length));
  for (const type of Object.keys(REQUIRED_BY_BLOCK_TYPE).sort()) {
    const flags = REQUIRED_BY_BLOCK_TYPE[type] ?? [];
    const formatted = flags.length === 0 ? '(none)' : flags.map((f) => `--${f}`).join(' ');
    lines.push(`  ${type.padEnd(padding)}  ${formatted}`);
  }
  addBlockCommand.description(`${addBlockCommand.description() ?? ''}\n${lines.join('\n')}`);
}

interface AddBlockArgs {
  dir: string;
  type: BlockType;
  parentId?: string;
  branch?: 'true' | 'false';
  ifAbsent?: boolean;
  explicitId?: string;
  before?: string;
  after?: string;
  position?: number;
  flagValues: Record<string, unknown>;
}

/**
 * Pure command body. Composes the bridge's `parseOptionValues` projection
 * with `mutateAndValidate` so the block is constructed from the flag values,
 * appended via `appendBlock`, and persisted only if validation passes.
 */
export async function runAddBlock(args: AddBlockArgs): Promise<CommandOutcome> {
  const schema = BLOCK_SCHEMA_MAP[args.type];

  // Project Commander's parsed opts back into a schema-shaped object, drop
  // structural and addressing keys (the bridge already skips most), then
  // stamp the discriminator and any explicit `--id`.
  const projected = parseOptionValues(schema, args.flagValues) as Record<string, unknown>;
  delete projected.parent;
  delete projected.branch;
  delete projected.ifAbsent;

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
  if (args.branch !== undefined && !args.parentId) {
    return {
      status: 'error',
      code: 'SCHEMA_VALIDATION',
      message:
        '--branch can only be set when --parent points at a conditional block; pass --parent <conditional-id> or drop --branch.',
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
        message: 'conditional: at least one --conditions value is required when adding a conditional block.',
      };
    }
  }

  const block: Record<string, unknown> = { type: args.type, ...projected };
  if (args.explicitId) {
    block.id = args.explicitId;
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
    parentId: args.parentId,
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
    hints: appended ? hintsFor(args.type, args.parentId, assignedId) : undefined,
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
