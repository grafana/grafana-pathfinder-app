import type { JsonGuide } from '../types/json-guide.types';

/** Nests `depth` conditional blocks around a markdown block (sections cannot nest). */
export function createDeeplyNestedGuide(depth: number): JsonGuide {
  let blocks: any[] = [{ type: 'markdown', content: 'Deepest' }];
  for (let i = 0; i < depth; i++) {
    blocks = [{ type: 'conditional', conditions: ['is-admin'], whenTrue: blocks, whenFalse: [] }];
  }
  return { id: 'deep-test', title: 'Deep Nesting Test', blocks };
}

export function createWideGuide(blockCount: number): JsonGuide {
  const blocks = Array.from({ length: blockCount }, (_, i) => ({
    type: 'markdown' as const,
    content: `Block ${i + 1}`,
  }));
  return { id: 'wide-test', title: 'Wide Guide Test', blocks };
}
