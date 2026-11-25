/**
 * The deterministic id rule behind `pathfinder-cli stamp-ids`
 * (docs/design/I18N.md §6.5, §12.2).
 *
 * A translation sidecar addresses a block, or a step of a `multistep` or
 * `guided` block, by `id`. `stampIds` gives an id to every such unit that has
 * none and never touches one that has. It is pure: the input is not changed,
 * the same input always gives the same output, and stamping its own output
 * stamps nothing.
 *
 * Distinct from `assignMissingIds` (`./auto-id`), which mints ids on read for
 * blocks of every type, from the highest existing number plus one.
 */

import { getProjectionRow } from '../../../lib/guide-translation/projection-table';
import type { ContentJson } from '../../../types/package.types';
import { walkBlocks } from './tree';

export interface StampedId {
  kind: 'block' | 'step';
  /** The id that was written. */
  id: string;
  /** For a block, its type. For a step, the type of the block holding it. */
  blockType: string;
  /** For a step, the id of the block holding it. */
  parentId?: string;
}

export interface StampIdsResult {
  content: ContentJson;
  stamped: StampedId[];
}

function hasId(unit: { id?: unknown }): boolean {
  return typeof unit.id === 'string' && unit.id.length > 0;
}

function stepsOf(block: object): Array<{ id?: unknown }> {
  const steps = (block as { steps?: unknown }).steps;
  return Array.isArray(steps) ? (steps as Array<{ id?: unknown }>) : [];
}

/** Set `id` where authors write it, after `type` for a block and first for a step, so the diff stays small. */
function placeId(target: object, id: string): void {
  const unit = target as Record<string, unknown>;
  const entries = Object.entries(unit);
  for (const [key] of entries) {
    delete unit[key];
  }
  const typeEntry = entries.find(([key]) => key === 'type');
  if (typeEntry) {
    unit.type = typeEntry[1];
  }
  unit.id = id;
  for (const [key, value] of entries) {
    if (key !== 'type' && key !== 'id') {
      unit[key] = value;
    }
  }
}

/** The smallest positive integer `n` for which `<prefix><n>` is not taken. */
function smallestFree(prefix: string, taken: ReadonlySet<string>): string {
  let n = 1;
  while (taken.has(`${prefix}${n}`)) {
    n++;
  }
  return `${prefix}${n}`;
}

/**
 * Walk the blocks depth-first in document order (`walkBlocks`). A block whose
 * type is in the projection table and has no `id` gets `<type>-<n>`, with `n`
 * the smallest positive integer that is unused in the guide. A step without an
 * `id` gets `<block-id>-step-<k>` the same way. Ids already in the guide, and
 * ids stamped earlier in the walk, are never reused. Other block types are left
 * alone.
 */
export function stampIds(content: ContentJson): StampIdsResult {
  const out = JSON.parse(JSON.stringify(content)) as ContentJson;

  const taken = new Set<string>();
  for (const { block } of walkBlocks(out)) {
    if (hasId(block)) {
      taken.add(block.id as string);
    }
    for (const step of stepsOf(block)) {
      if (hasId(step)) {
        taken.add(step.id as string);
      }
    }
  }

  const stamped: StampedId[] = [];
  for (const { block } of walkBlocks(out)) {
    const row = getProjectionRow(block.type);
    if (!row) {
      continue;
    }
    if (!hasId(block)) {
      const id = smallestFree(`${block.type}-`, taken);
      placeId(block, id);
      taken.add(id);
      stamped.push({ kind: 'block', id, blockType: block.type });
    }
    if (!row.stepFields) {
      continue;
    }
    const parentId = block.id as string;
    for (const step of stepsOf(block)) {
      if (hasId(step)) {
        continue;
      }
      const id = smallestFree(`${parentId}-step-`, taken);
      placeId(step, id);
      taken.add(id);
      stamped.push({ kind: 'step', id, blockType: block.type, parentId });
    }
  }

  return { content: out, stamped };
}
