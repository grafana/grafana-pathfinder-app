/**
 * `pathfinder-cli remove-block <dir> <id> [--cascade]` — remove a block.
 * Refuses to drop a non-empty container without `--cascade`.
 */

import { Command, Option } from 'commander';

import { mutateAndValidate, PackageIOError, removeBlock } from '../utils/package-io';
import { issueToOutcome, printOutcome, readOutputOptions, type CommandOutcome } from '../utils/output';

export const removeBlockCommand = new Command('remove-block')
  .description('Remove a block by id')
  .argument('<dir>', 'package directory')
  .argument('<id>', 'id of the block to remove')
  .addOption(new Option('--cascade', 'Also remove all child blocks (required for non-empty containers)'))
  .action(async function (this: Command, dir: string, id: string) {
    const opts = this.opts() as { cascade?: boolean };
    const output = readOutputOptions(this);
    const outcome = await runRemoveBlock({ dir, id, cascade: opts.cascade === true });
    process.exit(printOutcome(outcome, output));
  });

interface RemoveBlockArgs {
  dir: string;
  id: string;
  cascade: boolean;
}

export async function runRemoveBlock(args: RemoveBlockArgs): Promise<CommandOutcome> {
  let removed = '';
  let childrenRemoved = 0;
  try {
    const result = await mutateAndValidate(args.dir, ({ content }) => {
      const r = removeBlock(content, args.id, { cascade: args.cascade });
      removed = r.removed;
      childrenRemoved = r.childrenRemoved;
    });
    if (!result.validation.ok) {
      const first = result.validation.issues[0];
      return first
        ? issueToOutcome(first, { issues: result.validation.issues })
        : { status: 'error', code: 'SCHEMA_VALIDATION', message: 'Validation failed after removal' };
    }
  } catch (err) {
    if (err instanceof PackageIOError) {
      return issueToOutcome(err.issues[0] ?? { code: err.code, message: err.message });
    }
    return {
      status: 'error',
      code: 'SCHEMA_VALIDATION',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const summary =
    childrenRemoved > 0
      ? `Removed ${removed} "${args.id}" (and ${childrenRemoved} children) from ${args.dir}`
      : `Removed ${removed} "${args.id}" from ${args.dir}`;

  return {
    status: 'ok',
    summary,
    details: {
      type: removed,
      id: args.id,
      'children removed': childrenRemoved,
      'package valid': true,
    },
    data: { type: removed, id: args.id, childrenRemoved },
  };
}
