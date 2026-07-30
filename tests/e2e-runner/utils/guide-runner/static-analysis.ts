const INTERACTIVE_TYPES = new Set([
  'interactive',
  'multistep',
  'guided',
  'code-block',
  'terminal',
  'terminal-connect',
  'grot-guide',
]);

/**
 * Count interactive blocks in a guide recursively.
 *
 * Walks the full nested block tree, including section, assistant, and
 * conditional containers (both whenTrue and whenFalse branches). The count
 * lets the runner skip the DOM wait entirely for markdown-only guides rather
 * than timing out after 15 s waiting for elements that never appear.
 */
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
