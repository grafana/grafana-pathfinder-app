/**
 * `pathfinder-cli remove-block <dir> <id> [--cascade | --orphan-children] [--prune-translations]`
 * Refuses to drop a non-empty container without one of the two child-handling
 * flags. The flags are mutually exclusive.
 *
 * Translation sidecars key their entries by block id, so a removed block leaves
 * entries behind. After a successful removal the command lists them, and
 * `--prune-translations` deletes them (docs/design/I18N.md §7.1, §12.6).
 *
 * `RemoveBlockCommand` is the sole authority for the input shape; the Commander tree
 * and the MCP binding are both renderers over it.
 */

import { z } from 'zod';

import { defineCommand } from '../contracts';
import type { TranslationSidecar } from '../../types/translation-sidecar.schema';
import {
  findBlockById,
  findSidecarEntries,
  mutateAndValidate,
  PackageIOError,
  removeBlock,
  walkBlocks,
  writePackageSidecar,
} from '../utils/package-io';
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
  pruneTranslations: z
    .boolean()
    .optional()
    .describe(
      "Also delete the removed blocks' entries (and their step entries) from every i18n/<tag>.json. Without it the entries are only listed."
    )
    .meta({ role: 'control' }),
});

export type RemoveBlockInput = z.output<typeof RemoveBlockCommand>;

interface OrphanedEntries {
  tag: string;
  /** Block ids of the removed blocks that the sidecar has an entry for. */
  blockIds: string[];
  /** `blocks.<id>` and `blocks.<id>.steps.<step>`, as listed in the output. */
  lines: string[];
  sidecar: TranslationSidecar;
}

/** The ids of the blocks a removal takes away: the block alone with --orphan-children, else its whole subtree. */
function removedBlockIds(content: Parameters<typeof walkBlocks>[0], id: string, orphanChildren: boolean): Set<string> {
  const target = findBlockById(content, id);
  if (!target) {
    return new Set();
  }
  if (orphanChildren) {
    return new Set([id]);
  }
  const ids = new Set<string>();
  for (const { block } of walkBlocks({ ...content, blocks: [target] })) {
    if (typeof block.id === 'string' && block.id.length > 0) {
      ids.add(block.id);
    }
  }
  return ids;
}

function findOrphanedEntries(
  dir: string,
  removed: ReadonlySet<string>
): { found: OrphanedEntries[]; unreadable: string[] } {
  const found: OrphanedEntries[] = [];
  const unreadable: string[] = [];
  for (const result of findSidecarEntries(dir, removed)) {
    if (!result.ok) {
      unreadable.push(`i18n/${result.tag ?? '?'}.json`);
      continue;
    }
    const blocks = result.sidecar.blocks ?? {};
    const lines = result.blockIds.flatMap((blockId) => [
      `i18n/${result.tag}.json: blocks.${blockId}`,
      ...Object.keys(blocks[blockId]?.steps ?? {}).map(
        (step) => `i18n/${result.tag}.json: blocks.${blockId}.steps.${step}`
      ),
    ]);
    found.push({ tag: result.tag, blockIds: result.blockIds, lines, sidecar: result.sidecar });
  }
  return { found, unreadable };
}

export async function runRemoveBlock(args: RemoveBlockInput): Promise<CommandOutcome> {
  let removed = '';
  let childrenRemoved = 0;
  let childrenOrphaned = 0;
  let legacyIdsMinted = 0;
  let removedIds = new Set<string>();
  try {
    const result = await mutateAndValidate(args.dir, ({ content }) => {
      removedIds = removedBlockIds(content, args.id, args.orphanChildren === true);
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

  const { found, unreadable } = findOrphanedEntries(args.dir, removedIds);
  const prune = args.pruneTranslations === true;
  const pruned: string[] = [];
  if (prune) {
    try {
      for (const entry of found) {
        const blocks = { ...entry.sidecar.blocks };
        for (const blockId of entry.blockIds) {
          delete blocks[blockId];
        }
        writePackageSidecar(args.dir, entry.tag, { ...entry.sidecar, blocks });
        pruned.push(entry.tag);
      }
    } catch (err) {
      const detail = err instanceof PackageIOError ? (err.issues[0]?.message ?? err.message) : renderError(err);
      return {
        status: 'error',
        code: 'SIDECAR_WRITE_FAILED',
        message: `Removed ${removed} "${args.id}", but could not prune translations: ${detail}\nPruned: ${pruned.length > 0 ? pruned.join(', ') : 'none'}. The block is already gone from content.json.`,
        data: { pruned },
      };
    }
  }
  const orphanLines = found.flatMap((entry) => entry.lines);
  const hints = [
    ...(orphanLines.length > 0 && !prune
      ? ['Delete these entries from the sidecars, or remove blocks with --prune-translations.']
      : []),
    ...(unreadable.length > 0 ? [`Could not read ${unreadable.join(', ')}, so its entries were not checked.`] : []),
  ];

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
      ...(orphanLines.length > 0
        ? {
            [prune ? 'translation entries pruned' : 'translation entries orphaned']: orphanLines.length,
          }
        : {}),
    },
    ...(orphanLines.length > 0
      ? {
          text: `${prune ? 'Pruned' : 'Orphaned'} translation entries:\n${orphanLines.map((line) => `  ${line}`).join('\n')}`,
        }
      : {}),
    ...(hints.length > 0 ? { hints } : {}),
    data: {
      type: removed,
      id: args.id,
      childrenRemoved,
      childrenOrphaned,
      ...(legacyIdsMinted > 0 ? { idsAssignedOnRead: legacyIdsMinted } : {}),
      ...(orphanLines.length > 0 ? { translationEntries: orphanLines, translationsPruned: prune } : {}),
    },
  };
}

export const removeBlockSpec = defineCommand({
  name: 'remove-block',
  summary: 'Remove a block by id',
  schema: RemoveBlockCommand,
  run: runRemoveBlock,
});
