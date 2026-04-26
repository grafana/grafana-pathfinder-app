/**
 * Stable identity for nested section blocks used by pinned previews.
 * Stored as a non-enumerable property so JSON.stringify / guide export omit it.
 */

import type { JsonBlock, JsonSectionBlock } from '../../types/json-guide.types';
import type { EditorBlock } from './types';

const PF_NESTED_INSTANCE_ID = '__pfNestedInstanceId';

export function readNestedInstanceId(block: JsonBlock): string | undefined {
  const d = Object.getOwnPropertyDescriptor(block, PF_NESTED_INSTANCE_ID);
  if (d && typeof d.value === 'string' && d.value.length > 0) {
    return d.value;
  }
  return undefined;
}

export function assignNestedInstanceId(block: JsonBlock, id: string): JsonBlock {
  const out = { ...block } as JsonBlock;
  Object.defineProperty(out, PF_NESTED_INSTANCE_ID, {
    value: id,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return out;
}

/** Keeps pin identity when nested block content is replaced (e.g. form save). */
export function copyNestedInstanceId(prev: JsonBlock | undefined, next: JsonBlock): JsonBlock {
  const id = prev ? readNestedInstanceId(prev) : undefined;
  if (!id) {
    return next;
  }
  if (readNestedInstanceId(next) === id) {
    return next;
  }
  return assignNestedInstanceId(next, id);
}

export function findSectionNestedBlockByInstanceId(
  blocks: EditorBlock[],
  instanceId: string
): { sectionId: string; nestedIndex: number } | null {
  for (const eb of blocks) {
    if (eb.block.type !== 'section') {
      continue;
    }
    const section = eb.block as JsonSectionBlock;
    const idx = section.blocks.findIndex((b) => readNestedInstanceId(b) === instanceId);
    if (idx >= 0) {
      return { sectionId: eb.id, nestedIndex: idx };
    }
  }
  return null;
}
