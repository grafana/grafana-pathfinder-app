import type { EditorBlock, JsonBlock } from '../types';
import { isConditionalBlock, isSectionBlock } from './useBlockEditor.helpers';

export type SelectedBlockLocation =
  | {
      kind: 'root';
      rootIndex: number;
      block: JsonBlock;
    }
  | {
      kind: 'section';
      rootIndex: number;
      parentId: string;
      nestedIndex: number;
      block: JsonBlock;
    }
  | {
      kind: 'conditional';
      rootIndex: number;
      parentId: string;
      branch: 'whenTrue' | 'whenFalse';
      nestedIndex: number;
      block: JsonBlock;
    };

const MERGEABLE_TYPES = new Set<JsonBlock['type']>(['interactive', 'multistep', 'guided']);

function parseChildIndex(suffix: string, length: number): number | null {
  if (!/^\d+$/.test(suffix)) {
    return null;
  }
  const index = Number(suffix);
  if (!Number.isSafeInteger(index) || String(index) !== suffix || index < 0 || index >= length) {
    return null;
  }
  return index;
}

/**
 * Resolve one of the selection IDs rendered by the block editor.
 *
 * Root IDs are the editor's stable IDs. Section and conditional children use
 * position-based display IDs, so resolve them against the current snapshot
 * before applying a bulk mutation; this prevents index shifts from deleting
 * the wrong sibling.
 */
export function resolveSelectedBlock(blocks: EditorBlock[], selectionId: string): SelectedBlockLocation | null {
  const rootIndex = blocks.findIndex((entry) => entry.id === selectionId);
  if (rootIndex >= 0) {
    const entry = blocks[rootIndex];
    return entry ? { kind: 'root', rootIndex, block: entry.block } : null;
  }

  for (let index = 0; index < blocks.length; index += 1) {
    const entry = blocks[index];
    if (!entry) {
      continue;
    }

    if (isSectionBlock(entry.block)) {
      const prefix = `${entry.id}-nested-`;
      if (selectionId.startsWith(prefix)) {
        const nestedIndex = parseChildIndex(selectionId.slice(prefix.length), entry.block.blocks.length);
        if (nestedIndex !== null) {
          return {
            kind: 'section',
            rootIndex: index,
            parentId: entry.id,
            nestedIndex,
            block: entry.block.blocks[nestedIndex]!,
          };
        }
      }
    }

    if (isConditionalBlock(entry.block)) {
      for (const [branchKey, branch] of [
        ['true', 'whenTrue'],
        ['false', 'whenFalse'],
      ] as const) {
        const prefix = `${entry.id}-${branchKey}-`;
        if (!selectionId.startsWith(prefix)) {
          continue;
        }
        const nestedIndex = parseChildIndex(selectionId.slice(prefix.length), entry.block[branch].length);
        if (nestedIndex !== null) {
          return {
            kind: 'conditional',
            rootIndex: index,
            parentId: entry.id,
            branch,
            nestedIndex,
            block: entry.block[branch][nestedIndex]!,
          };
        }
      }
    }
  }

  return null;
}

/**
 * Remove all currently selected blocks in one immutable transition.
 *
 * Unknown/stale IDs are ignored. If none resolve, the original array is
 * returned so callers can avoid creating a no-op history entry.
 */
export function deleteSelectedBlocks(blocks: EditorBlock[], selectionIds: ReadonlySet<string>): EditorBlock[] {
  const rootIndices = new Set<number>();
  const sectionIndices = new Map<number, Set<number>>();
  const conditionalIndices = new Map<number, Map<'whenTrue' | 'whenFalse', Set<number>>>();

  for (const selectionId of selectionIds) {
    const location = resolveSelectedBlock(blocks, selectionId);
    if (!location) {
      continue;
    }
    if (location.kind === 'root') {
      rootIndices.add(location.rootIndex);
    } else if (location.kind === 'section') {
      const indices = sectionIndices.get(location.rootIndex) ?? new Set<number>();
      indices.add(location.nestedIndex);
      sectionIndices.set(location.rootIndex, indices);
    } else {
      const branches = conditionalIndices.get(location.rootIndex) ?? new Map<'whenTrue' | 'whenFalse', Set<number>>();
      const indices = branches.get(location.branch) ?? new Set<number>();
      indices.add(location.nestedIndex);
      branches.set(location.branch, indices);
      conditionalIndices.set(location.rootIndex, branches);
    }
  }

  if (rootIndices.size === 0 && sectionIndices.size === 0 && conditionalIndices.size === 0) {
    return blocks;
  }

  return blocks.flatMap((entry, rootIndex) => {
    if (rootIndices.has(rootIndex)) {
      return [];
    }

    const sectionRemovals = sectionIndices.get(rootIndex);
    if (sectionRemovals && isSectionBlock(entry.block)) {
      return [
        {
          ...entry,
          block: {
            ...entry.block,
            blocks: entry.block.blocks.filter((_, index) => !sectionRemovals.has(index)),
          },
        },
      ];
    }

    const conditionalRemovals = conditionalIndices.get(rootIndex);
    if (conditionalRemovals && isConditionalBlock(entry.block)) {
      const whenTrueRemovals = conditionalRemovals.get('whenTrue');
      const whenFalseRemovals = conditionalRemovals.get('whenFalse');
      return [
        {
          ...entry,
          block: {
            ...entry.block,
            whenTrue: whenTrueRemovals
              ? entry.block.whenTrue.filter((_, index) => !whenTrueRemovals.has(index))
              : entry.block.whenTrue,
            whenFalse: whenFalseRemovals
              ? entry.block.whenFalse.filter((_, index) => !whenFalseRemovals.has(index))
              : entry.block.whenFalse,
          },
        },
      ];
    }

    return [entry];
  });
}

/** Whether the current selection can be merged by the existing merge helper. */
export function canMergeSelection(blocks: EditorBlock[], selectionIds: ReadonlySet<string>): boolean {
  if (selectionIds.size < 2) {
    return false;
  }

  const locations = Array.from(selectionIds, (selectionId) => resolveSelectedBlock(blocks, selectionId));
  return locations.every(
    (location): location is SelectedBlockLocation =>
      location !== null &&
      (location.kind === 'root' || location.kind === 'section') &&
      MERGEABLE_TYPES.has(location.block.type)
  );
}
