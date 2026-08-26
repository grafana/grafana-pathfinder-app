/**
 * `pathfinder-cli remove-block <dir> <id> [--cascade | --orphan-children]`
 * Refuses to drop a non-empty container without one of the two child-handling
 * flags. The flags are mutually exclusive.
 *
 * `RemoveBlockCommand` is the sole authority for the input shape; the Commander tree
 * and the MCP binding are both renderers over it.
 */

import { z } from 'zod';

import { defineCommand } from '../contracts';
import { mutateAndValidate, PackageIOError, removeBlock } from '../utils/package-io';
import { issueToOutcome, renderError, type CommandOutcome } from '../utils/output';

export const RemoveBlockCommand = z.object({
  dir: z.string().describe('package directory').meta({ role: 'io' }),
  id: z.string().describe('id of the block to remove').meta({ role: 'addressing' }),
  cascade: z
    .boolean()
    .default(false)
    .describe(
      'Also remove all child blocks (required for non-empty containers). Destructive: deletes the entire subtree with no undo.'
    )
    .meta({ role: 'control' }),
  orphanChildren: z
    .boolean()
    .optional()
    .describe(
      "Promote the removed block's children into its parent's child array instead of removing them. Promoted children are inserted at the index the removed block previously occupied, in their original order; subsequent siblings are pushed back."
    )
    .meta({ role: 'control' }),
});

export type RemoveBlockInput = z.output<typeof RemoveBlockCommand>;

export async function runRemoveBlock(args: RemoveBlockInput): Promise<CommandOutcome> {
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

export const removeBlockSpec = defineCommand({
  name: 'remove-block',
  summary: 'Remove a block by id',
  schema: RemoveBlockCommand,
  run: runRemoveBlock,
});
