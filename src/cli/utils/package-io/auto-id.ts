/**
 * Auto-id assignment for blocks.
 *
 * `nextAutoBlockId` mints the next stable `<type>-<n>` id for a leaf
 * being appended. `assignMissingIds` is the migration step that lets the
 * rest of the CLI's id-only addressing model work on legacy / hand-authored
 * / bundled content; it walks the tree and stamps an id onto every block
 * that lacks one.
 *
 * Distinct from the package-level id generator at `../auto-id.ts` (which
 * mints `<kebab-of-title>-<6-char-base32>` ids for `create`).
 */

import type { ContentJson } from '../../../types/package.types';
import { collectAllIds, walkBlocks } from './tree';

/**
 * Generate the next stable `<type>-<n>` id for a leaf block being appended.
 *
 * Counter scope is per-type and per-guide — the next markdown gets
 * `markdown-<n+1>` where `n` is the current largest matching counter. We scan
 * existing ids rather than carrying a counter alongside the artifact because
 * the artifact is the source of truth (boundary decision 4 of the AI
 * authoring design): no separate state to lose across CLI sessions.
 */
export function nextAutoBlockId(content: ContentJson, blockType: string): string {
  const prefix = `${blockType}-`;
  let max = 0;
  for (const id of collectAllIds(content)) {
    if (!id.startsWith(prefix)) {
      continue;
    }
    const tail = id.slice(prefix.length);
    if (!/^\d+$/.test(tail)) {
      continue;
    }
    const n = Number(tail);
    if (Number.isFinite(n) && n > max) {
      max = n;
    }
  }
  return `${prefix}${max + 1}`;
}

/**
 * Mint stable `<type>-<n>` ids for any block in `content` that lacks one.
 *
 * This is the migration step that makes the rest of the CLI's id-only
 * addressing model work on legacy / hand-authored / bundled content. Without
 * it, structural primitives like `move-block` and `remove-block` cannot
 * target blocks that came from outside the authoring CLI.
 *
 * Walk order is deterministic (depth-first, root → containers → children) so
 * read-only commands like `inspect` mint the same ids that mutating commands
 * subsequently persist. Counters per type extend whatever `<type>-<n>` ids
 * already exist, so manually-authored ids are never clobbered.
 */
export function assignMissingIds(content: ContentJson): { assigned: number } {
  const counters: Record<string, number> = {};
  for (const id of collectAllIds(content)) {
    const match = /^([a-z]+)-(\d+)$/.exec(id);
    if (!match) {
      continue;
    }
    const type = match[1];
    const n = Number(match[2]);
    if (!type || !Number.isFinite(n)) {
      continue;
    }
    if (n > (counters[type] ?? 0)) {
      counters[type] = n;
    }
  }
  let assigned = 0;
  for (const { block } of walkBlocks(content)) {
    if (typeof block.id === 'string' && block.id.length > 0) {
      continue;
    }
    counters[block.type] = (counters[block.type] ?? 0) + 1;
    block.id = `${block.type}-${counters[block.type]}`;
    assigned++;
  }
  return { assigned };
}
