import type { GuideBlockIndex } from './block-index';
import type { CompletionEvidence } from './progress';

export interface ActiveConditionalBranch {
  stepIds: readonly string[];
  nestedConditionalIds: readonly string[];
}

export function conditionalWorkComplete(
  roots: Iterable<string>,
  branches: ReadonlyMap<string, ActiveConditionalBranch>,
  evidence: readonly CompletionEvidence[]
): boolean {
  const completed = new Set(evidence.filter((item) => item.kind === 'do-it').map((item) => item.blockId));
  const visiting = new Set<string>();
  const done = (id: string): boolean => {
    const branch = branches.get(id);
    if (!branch || visiting.has(id)) {
      return false;
    }
    visiting.add(id);
    const result = branch.stepIds.every((step) => completed.has(step)) && branch.nestedConditionalIds.every(done);
    visiting.delete(id);
    return result;
  };
  return Array.from(roots).every(done);
}

export function withConditionalCompletionTargets(index: GuideBlockIndex): GuideBlockIndex {
  const positions = new Set(index.conditionalPositions?.values());
  if (positions.size === 0) {
    return index;
  }
  return {
    ...index,
    blocks: index.blocks.map((block) => (positions.has(block.position) ? { ...block, completable: true } : block)),
    completableBlockCount: index.completableBlockCount + positions.size,
    finalCompletablePosition: Math.max(index.finalCompletablePosition, ...positions),
  };
}
