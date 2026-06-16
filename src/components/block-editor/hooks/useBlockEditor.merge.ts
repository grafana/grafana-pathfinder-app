import type { EditorBlock, JsonBlock } from '../types';
import type {
  JsonGuidedBlock,
  JsonInteractiveBlock,
  JsonMultistepBlock,
  JsonStep,
} from '../../../types/json-guide.types';
import {
  generateBlockId,
  isGuidedBlock,
  isInteractiveBlock,
  isMultistepBlock,
  isSectionBlock,
  parseBlockId,
  type ParsedBlockId,
} from './useBlockEditor.helpers';

export type MergeKind = 'multistep' | 'guided';

interface MergeSpec {
  defaultContent: string;
  interactiveToStep: (interactive: JsonInteractiveBlock) => JsonStep;
}

const MERGE_SPECS: Record<MergeKind, MergeSpec> = {
  multistep: {
    defaultContent: 'Complete the following steps:',
    interactiveToStep: (interactive) => ({
      action: interactive.action,
      reftarget: interactive.reftarget,
      ...(interactive.targetvalue && { targetvalue: interactive.targetvalue }),
      ...(interactive.tooltip && { tooltip: interactive.tooltip }),
      ...(!interactive.tooltip && interactive.content && { tooltip: interactive.content }),
    }),
  },
  guided: {
    defaultContent: 'Follow the steps below:',
    interactiveToStep: (interactive) => ({
      action: interactive.action,
      reftarget: interactive.reftarget,
      ...(interactive.targetvalue && { targetvalue: interactive.targetvalue }),
      ...(interactive.content && { description: interactive.content }),
    }),
  },
};

const isMergeable = (
  block: JsonBlock | undefined
): block is JsonInteractiveBlock | JsonMultistepBlock | JsonGuidedBlock =>
  !!block && (isInteractiveBlock(block) || isMultistepBlock(block) || isGuidedBlock(block));

/**
 * Position weight for sorting parsed blocks in document order. Root blocks use
 * their root index; nested blocks fall under their section's root index and
 * sort by nested index within that section.
 *
 * The 10000 multiplier assumes sections hold fewer than 10000 children — true
 * for any realistic guide. If that ever stops being true, switch to a tuple
 * comparator.
 */
const positionWeight = (p: ParsedBlockId): number => {
  const SECTION_STRIDE = 10000;
  if (p.isNested) {
    return (p.sectionRootIndex ?? 0) * SECTION_STRIDE + (p.nestedIndex ?? 0);
  }
  return (p.rootIndex ?? 0) * SECTION_STRIDE;
};

type ParsedWithId = ParsedBlockId & { id: string };

/**
 * Merge interactive/multistep/guided blocks identified by `blockIds` into a
 * single multistep or guided block (per `kind`). Returns the new block list,
 * or `null` if there is nothing to merge (fewer than two mergeable inputs).
 *
 * The merged block is inserted at the position of the first selected block in
 * document order. If that first block is nested inside a section, the merged
 * block is placed inside that section; otherwise it is placed at root level.
 */
export const mergeBlocks = (prev: EditorBlock[], blockIds: string[], kind: MergeKind): EditorBlock[] | null => {
  const parsedBlocks: ParsedWithId[] = blockIds
    .map((id) => ({ id, ...parseBlockId(id, prev) }))
    .filter((p): p is ParsedWithId => isMergeable(p.block));

  if (parsedBlocks.length < 2) {
    return null;
  }

  parsedBlocks.sort((a, b) => positionWeight(a) - positionWeight(b));

  const spec = MERGE_SPECS[kind];
  const steps: JsonStep[] = parsedBlocks.flatMap((p) => {
    const block = p.block!;
    if (isInteractiveBlock(block)) {
      return [spec.interactiveToStep(block)];
    }
    return (block as JsonMultistepBlock | JsonGuidedBlock).steps;
  });

  const mergedBlock: JsonMultistepBlock | JsonGuidedBlock = {
    type: kind,
    content: spec.defaultContent,
    steps,
  };

  const firstParsed = parsedBlocks[0]!;
  const insertIntoSection = firstParsed.isNested && firstParsed.sectionId !== undefined;

  const rootIdsToRemove = new Set(parsedBlocks.filter((p) => !p.isNested).map((p) => p.id));

  const nestedToRemove = new Map<string, number[]>();
  for (const p of parsedBlocks) {
    if (p.isNested && p.sectionId !== undefined && p.nestedIndex !== undefined) {
      const existing = nestedToRemove.get(p.sectionId) ?? [];
      existing.push(p.nestedIndex);
      nestedToRemove.set(p.sectionId, existing);
    }
  }

  const newBlocks = prev
    .filter((b) => !rootIdsToRemove.has(b.id))
    .map((b) => {
      if (!isSectionBlock(b.block)) {
        return b;
      }
      const isInsertionSection = insertIntoSection && b.id === firstParsed.sectionId;
      if (!nestedToRemove.has(b.id) && !isInsertionSection) {
        return b;
      }

      const indicesToRemove = new Set(nestedToRemove.get(b.id) ?? []);
      const newSectionBlocks = b.block.blocks.filter((_, i) => !indicesToRemove.has(i));

      if (isInsertionSection) {
        const insertIdx = firstParsed.nestedIndex!;
        const removedBefore = Array.from(indicesToRemove).filter((i) => i < insertIdx).length;
        const adjustedIdx = insertIdx - removedBefore;
        newSectionBlocks.splice(adjustedIdx, 0, mergedBlock);
      }

      return { ...b, block: { ...b.block, blocks: newSectionBlocks } };
    });

  if (!insertIntoSection) {
    const newEditorBlock: EditorBlock = { id: generateBlockId(), block: mergedBlock };
    const originalIndex = prev.findIndex((b) => b.id === firstParsed.id);
    const removedBeforeInsert = prev.filter((b, i) => i < originalIndex && rootIdsToRemove.has(b.id)).length;
    const insertIndex = originalIndex - removedBeforeInsert;
    newBlocks.splice(insertIndex, 0, newEditorBlock);
  }

  return newBlocks;
};
