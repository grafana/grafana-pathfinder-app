/**
 * `pathfinder-cli remove-block <dir> <id> [--cascade | --orphan-children]`
 * Refuses to drop a non-empty container without one of the two child-handling
 * flags. The flags are mutually exclusive.
 */

import { Command, Option } from 'commander';

import { mutateAndValidate, PackageIOError, removeBlock } from '../utils/package-io';
import { issueToOutcome, printOutcome, readOutputOptions, renderError, type CommandOutcome } from '../utils/output';

export const removeBlockCommand = new Command('remove-block')
  .description('Remove a block by id')
  .argument('<dir>', 'package directory')
  .argument('<id>', 'id of the block to remove')
  .addOption(new Option('--cascade', 'Also remove all child blocks (required for non-empty containers)'))
  .addOption(
    new Option(
      '--orphan-children',
      "Promote the removed block's children into its parent's child array instead of removing them. Promoted children are inserted at the index the removed block previously occupied, in their original order; subsequent siblings are pushed back."
    )
  )
  .action(async function (this: Command, dir: string, id: string) {
    const opts = this.opts() as { cascade?: boolean; orphanChildren?: boolean };
    const output = readOutputOptions(this);
    const outcome = await runRemoveBlock({
      dir,
      id,
      cascade: opts.cascade === true,
      orphanChildren: opts.orphanChildren === true,
    });
    process.exit(printOutcome(outcome, output));
  });

interface RemoveBlockArgs {
  dir: string;
  id: string;
  cascade: boolean;
  orphanChildren?: boolean;
}

export async function runRemoveBlock(args: RemoveBlockArgs): Promise<CommandOutcome> {
  let removed = '';
  let childrenRemoved = 0;
  let childrenOrphaned = 0;
  let legacyIdsMinted = 0;
  try {
    const result = await mutateAndValidate(args.dir, ({ content }) => {
      const r = removeBlock(content, args.id, {
        cascade: args.cascade,
        orphanChildren: args.orphanChildren,
      });
      removed = r.removed;
      childrenRemoved = r.childrenRemoved;
      childrenOrphaned = r.childrenOrphaned;
    });
    if (!result.validation.ok) {
      const first = result.validation.issues[0];
      return first
        ? issueToOutcome(first, { issues: result.validation.issues })
        : { status: 'error', code: 'SCHEMA_VALIDATION', message: 'Validation failed after removal' };
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

  let summary: string;
  if (childrenOrphaned > 0) {
    summary = `Removed ${removed} "${args.id}" and promoted ${childrenOrphaned} child(ren) to its parent in ${args.dir}`;
  } else if (childrenRemoved > 0) {
    summary = `Removed ${removed} "${args.id}" (and ${childrenRemoved} children) from ${args.dir}`;
  } else {
    summary = `Removed ${removed} "${args.id}" from ${args.dir}`;
  }

  return {
    status: 'ok',
    summary,
    details: {
      type: removed,
      id: args.id,
      'children removed': childrenRemoved,
      'children orphaned': childrenOrphaned,
      'package valid': true,
      ...(legacyIdsMinted > 0 ? { 'ids minted on legacy blocks': legacyIdsMinted } : {}),
    },
    data: {
      type: removed,
      id: args.id,
      childrenRemoved,
      childrenOrphaned,
      ...(legacyIdsMinted > 0 ? { idsAssignedOnRead: legacyIdsMinted } : {}),
    },
  };
}
