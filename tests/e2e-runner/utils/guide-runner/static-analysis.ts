import { isInteractiveBlockType } from '../../../../src/constants/json-guide-classification';

export function countInteractiveBlocks(guide: unknown): number {
  let count = 0;

  function walk(node: unknown): void {
    if (!node || typeof node !== 'object') {
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item);
      }
      return;
    }

    const block = node as Record<string, unknown>;

    if (isInteractiveBlockType(block.type) || block.type === 'snippet-ref') {
      count++;
    }

    walk(block.blocks);
    walk(block.whenTrue);
    walk(block.whenFalse);
  }

  walk(guide);
  return count;
}
