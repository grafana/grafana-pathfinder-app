/**
 * `pathfinder-cli move-block <dir> <id> [--before <id> | --after <id> | --position <n> | --to-position <n>] [--into <containerId> [--branch true|false]]`
 *
 * Reorder a block. Without `--into`, the move stays within the block's current
 * parent. With `--into`, the block is reparented to the named container at the
 * requested position (or appended if no positional flag is given). The legacy
 * `--to-position` flag is kept as a hidden alias for `--position`.
 */

import { Command, InvalidArgumentError, Option } from 'commander';

import { moveBlock, mutateAndValidate, PackageIOError } from '../utils/package-io';
import { issueToOutcome, printOutcome, readOutputOptions, renderError, type CommandOutcome } from '../utils/output';

function parseNonNegativeInt(flag: string) {
  return (value: string) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) {
      throw new InvalidArgumentError(`${flag} must be a non-negative integer, got "${value}"`);
    }
    return n;
  };
}

export const moveBlockCommand = new Command('move-block')
  .description('Reorder a block, optionally reparenting it via --into')
  .argument('<dir>', 'package directory')
  .argument('<id>', 'id of the block to move')
  .addOption(
    new Option(
      '--before <id>',
      'Move so the block ends up immediately before this sibling (use at most one of --before/--after/--position)'
    )
  )
  .addOption(
    new Option(
      '--after <id>',
      'Move so the block ends up immediately after this sibling (use at most one of --before/--after/--position)'
    )
  )
  .addOption(
    new Option('--position <n>', "0-based index in the block's current parent (or in --into if reparenting)").argParser(
      parseNonNegativeInt('--position')
    )
  )
  .addOption(
    new Option('--to-position <n>', 'Alias for --position (kept for backward compatibility)')
      .argParser(parseNonNegativeInt('--to-position'))
      .hideHelp()
  )
  .addOption(
    new Option(
      '--into <containerId>',
      'Reparent the block into this container (section, assistant, or conditional). Combine with --position/--before/--after for placement; appends if none given.'
    )
  )
  .addOption(
    new Option(
      '--branch <true|false>',
      'Required when --into targets a conditional block: which branch (whenTrue / whenFalse) receives the moved block'
    ).choices(['true', 'false'])
  )
  .action(async function (this: Command, dir: string, id: string) {
    const opts = this.opts() as {
      before?: string;
      after?: string;
      position?: number;
      toPosition?: number;
      into?: string;
      branch?: 'true' | 'false';
    };
    const output = readOutputOptions(this);
    if (opts.position !== undefined && opts.toPosition !== undefined && opts.position !== opts.toPosition) {
      const outcome: CommandOutcome = {
        status: 'error',
        code: 'INVALID_OPTIONS',
        message: '--position and --to-position both supplied with conflicting values; pass only one.',
      };
      process.exit(printOutcome(outcome, output));
    }
    const outcome = await runMoveBlock({
      dir,
      id,
      before: opts.before,
      after: opts.after,
      toPosition: opts.position ?? opts.toPosition,
      into: opts.into,
      branch: opts.branch,
    });
    process.exit(printOutcome(outcome, output));
  });

interface MoveBlockArgs {
  dir: string;
  id: string;
  before?: string;
  after?: string;
  toPosition?: number;
  into?: string;
  branch?: 'true' | 'false';
}

export async function runMoveBlock(args: MoveBlockArgs): Promise<CommandOutcome> {
  let from = -1;
  let to = -1;
  let reparented = false;
  let toContainer: string | undefined;
  let legacyIdsMinted = 0;
  try {
    const result = await mutateAndValidate(args.dir, ({ content }) => {
      const r = moveBlock(content, args.id, {
        before: args.before,
        after: args.after,
        toPosition: args.toPosition,
        into: args.into,
        branch: args.branch,
      });
      from = r.from;
      to = r.to;
      reparented = r.reparented;
      toContainer = r.toContainer;
    });
    if (!result.validation.ok) {
      const first = result.validation.issues[0];
      return first
        ? issueToOutcome(first, { issues: result.validation.issues })
        : { status: 'error', code: 'SCHEMA_VALIDATION', message: 'Validation failed after move' };
    }
    legacyIdsMinted = result.state.idsAssignedOnRead ?? 0;
  } catch (err) {
    if (err instanceof PackageIOError) {
      return issueToOutcome(err.issues[0] ?? { code: err.code, message: err.message });
    }
    return { status: 'error', code: 'SCHEMA_VALIDATION', message: renderError(err) };
  }

  let summary: string;
  if (reparented) {
    summary = `Moved block "${args.id}" into "${toContainer}" at index ${to}`;
  } else if (from === to) {
    summary = `Block "${args.id}" already at the requested position (no change)`;
  } else {
    summary = `Moved block "${args.id}" from index ${from} to index ${to}`;
  }

  return {
    status: 'ok',
    summary,
    details: {
      id: args.id,
      from,
      to,
      ...(reparented && toContainer ? { 'into container': toContainer } : {}),
      'package valid': true,
      ...(legacyIdsMinted > 0 ? { 'ids minted on legacy blocks': legacyIdsMinted } : {}),
    },
    data: {
      id: args.id,
      from,
      to,
      reparented,
      toContainer,
      ...(legacyIdsMinted > 0 ? { idsAssignedOnRead: legacyIdsMinted } : {}),
    },
  };
}
