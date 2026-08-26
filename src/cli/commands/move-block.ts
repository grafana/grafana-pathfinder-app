/**
 * `pathfinder-cli move-block <dir> <id> [--before <id> | --after <id> | --position <n> | --to-position <n>] [--into <containerId> [--branch true|false]]`
 *
 * Reorder a block. Without `--into`, the move stays within the block's current
 * parent. With `--into`, the block is reparented to the named container at the
 * requested position (or appended if no positional flag is given). The legacy
 * `--to-position` flag is kept as a hidden alias for `--position`.
 */

import { z } from 'zod';

import { defineCommand } from '../contracts';
import { moveBlock, mutateAndValidate, PackageIOError } from '../utils/package-io';
import { issueToOutcome, renderError, type CommandOutcome } from '../utils/output';

const index = (what: string) => z.number().int().nonnegative().optional().describe(what).meta({ role: 'placement' });

export const MoveBlockCommand = z.object({
  dir: z.string().describe('package directory').meta({ role: 'io' }),
  id: z.string().describe('id of the block to move').meta({ role: 'addressing' }),
  before: z
    .string()
    .optional()
    .describe(
      'Move so the block ends up immediately before this sibling (use at most one of --before/--after/--position)'
    )
    .meta({ role: 'placement' }),
  after: z
    .string()
    .optional()
    .describe(
      'Move so the block ends up immediately after this sibling (use at most one of --before/--after/--position)'
    )
    .meta({ role: 'placement' }),
  position: index("0-based index in the block's current parent (or in --into if reparenting)"),
  toPosition: index('Alias for --position (kept for backward compatibility)'),
  into: z
    .string()
    .optional()
    .describe(
      'Reparent the block into this container (section, assistant, or conditional). Combine with --position/--before/--after for placement; appends if none given.'
    )
    .meta({ role: 'placement' }),
  branch: z
    .enum(['true', 'false'])
    .optional()
    .describe(
      'Required when --into targets a conditional block: which branch (whenTrue / whenFalse) receives the moved block'
    )
    .meta({ role: 'placement' }),
});

export type MoveBlockInput = z.output<typeof MoveBlockCommand>;

export async function runMoveBlock(args: MoveBlockInput): Promise<CommandOutcome> {
  // Two spellings of one index. Agreement is a cross-field rule with a published
  // error code, so it stays in the runner rather than becoming a schema refinement
  // that could only report SCHEMA_VALIDATION.
  if (args.position !== undefined && args.toPosition !== undefined && args.position !== args.toPosition) {
    return {
      status: 'error',
      code: 'INVALID_OPTIONS',
      message: '--position and --to-position both supplied with conflicting values; pass only one.',
    };
  }
  const toPosition = args.position ?? args.toPosition;

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
        toPosition,
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

export const moveBlockSpec = defineCommand({
  name: 'move-block',
  summary: 'Reorder a block, optionally reparenting it into another container',
  schema: MoveBlockCommand,
  run: runMoveBlock,
});
