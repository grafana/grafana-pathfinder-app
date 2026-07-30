const INTERACTIVE_TYPES = new Set(['interactive', 'multistep', 'guided']);

/** Count blocks discoverable through the runner's `interactive-step-*` selector. */
export function countDiscoverableSteps(guide: unknown): number {
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

    if (typeof block.type === 'string' && INTERACTIVE_TYPES.has(block.type)) {
      count++;
    }

    walk(block.blocks);
    walk(block.whenTrue);
    walk(block.whenFalse);
  }

  walk(guide);
  return count;
}
