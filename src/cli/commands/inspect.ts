/**
 * `pathfinder-cli inspect <dir> [--block <id>] [--at <jsonpath>]` — read-only
 * view of a package. The CLI's "describe state for an agent without
 * re-injecting the schema" tool.
 */

import { Command, Option } from 'commander';

import { CONTAINER_BLOCK_TYPES, isContainerBlockType, type BlockType } from '../utils/block-registry';
import {
  collectAllIds,
  findBlockById,
  PackageIOError,
  readPackage,
  validatePackageState,
  walkBlocks,
} from '../utils/package-io';
import { issueToOutcome, printOutcome, readOutputOptions, type CommandOutcome } from '../utils/output';
import type { JsonBlock } from '../../types/json-guide.types';

export const inspectCommand = new Command('inspect')
  .description('Show the current state of a package (read-only)')
  .argument('<dir>', 'package directory')
  .addOption(new Option('--block <id>', 'Show details for a single block by id'))
  .addOption(new Option('--at <jsonpath>', 'Show details for the block at a JSONPath (e.g., blocks[2].blocks[1])'))
  .action(async function (this: Command, dir: string) {
    const opts = this.opts() as { block?: string; at?: string };
    const output = readOutputOptions(this);
    const outcome = runInspect({ dir, blockId: opts.block, at: opts.at });
    process.exit(printOutcome(outcome, output));
  });

interface InspectArgs {
  dir: string;
  blockId?: string;
  at?: string;
}

export function runInspect(args: InspectArgs): CommandOutcome {
  let state;
  try {
    state = readPackage(args.dir);
  } catch (err) {
    if (err instanceof PackageIOError) {
      return issueToOutcome(err.issues[0] ?? { code: err.code, message: err.message });
    }
    return { status: 'error', code: 'NOT_FOUND', message: err instanceof Error ? err.message : String(err) };
  }

  if (args.blockId) {
    const block = findBlockById(state.content, args.blockId);
    if (!block) {
      return {
        status: 'error',
        code: 'BLOCK_NOT_FOUND',
        message: `Block "${args.blockId}" not found in ${args.dir}`,
        data: { availableIds: Array.from(collectAllIds(state.content)) },
      };
    }
    return blockToOutcome(block, blockPosition(state.content, block));
  }

  if (args.at) {
    const block = resolveJsonPath(state.content.blocks, args.at);
    if (!block) {
      return {
        status: 'error',
        code: 'BLOCK_NOT_FOUND',
        message: `No block at path ${args.at}`,
      };
    }
    return blockToOutcome(block, args.at);
  }

  // Whole-package summary.
  const counts: Record<string, number> = {};
  let blockCount = 0;
  const containers: Array<{ id: string; type: string; childCount: number }> = [];
  for (const { block } of walkBlocks(state.content)) {
    blockCount++;
    counts[block.type] = (counts[block.type] ?? 0) + 1;
    if (isContainerBlockType(block.type as BlockType) && typeof block.id === 'string') {
      containers.push({ id: block.id, type: block.type, childCount: countChildren(block) });
    }
  }
  const validation = validatePackageState(state.content, state.manifest);

  return {
    status: 'ok',
    summary: `Package ${args.dir} — ${blockCount} block(s)`,
    details: {
      id: state.content.id,
      title: state.content.title,
      schemaVersion: state.content.schemaVersion ?? '',
      blocks: blockCount,
      types: Object.entries(counts)
        .map(([t, n]) => `${t}=${n}`)
        .sort(),
      containers: containers.map((c) => `${c.id} (${c.type}, ${c.childCount} child${c.childCount === 1 ? '' : 'ren'})`),
      'package valid': validation.ok,
    },
    data: {
      id: state.content.id,
      title: state.content.title,
      schemaVersion: state.content.schemaVersion,
      blockCount,
      typeCounts: counts,
      containers,
      valid: validation.ok,
      issues: validation.issues,
    },
  };
}

function blockToOutcome(block: JsonBlock, position: string): CommandOutcome {
  const record = block as unknown as Record<string, unknown>;
  const childCount = countChildren(block);
  return {
    status: 'ok',
    summary: `Block ${typeof block.id === 'string' ? `"${block.id}" ` : ''}(${block.type}) at ${position}`,
    details: {
      type: block.type,
      id: typeof block.id === 'string' ? block.id : '<unset>',
      position,
      ...(typeof record.title === 'string' ? { title: record.title } : {}),
      ...(isContainerBlockType(block.type as BlockType) ? { children: childCount } : {}),
    },
    data: {
      type: block.type,
      id: block.id,
      position,
      block: record,
    },
  };
}

function blockPosition(content: { blocks: JsonBlock[] }, target: JsonBlock): string {
  for (const { block, parent, index } of walkBlocks(content as Parameters<typeof walkBlocks>[0])) {
    if (block === target) {
      // We can compute prefix only via a re-walk — keep this simple by
      // returning the index path of just the parent array. Full path
      // enrichment is the data exposed by the JSON `data.position`.
      void parent;
      return `[block-${index}]`;
    }
  }
  return '<unknown>';
}

function countChildren(block: JsonBlock): number {
  if (block.type === 'section' || block.type === 'assistant') {
    return ((block as unknown as { blocks?: unknown[] }).blocks ?? []).length;
  }
  if (block.type === 'conditional') {
    const c = block as unknown as { whenTrue?: unknown[]; whenFalse?: unknown[] };
    return (c.whenTrue?.length ?? 0) + (c.whenFalse?.length ?? 0);
  }
  if (block.type === 'multistep' || block.type === 'guided') {
    return ((block as unknown as { steps?: unknown[] }).steps ?? []).length;
  }
  if (block.type === 'quiz') {
    return ((block as unknown as { choices?: unknown[] }).choices ?? []).length;
  }
  return 0;
}

/**
 * Resolve a simple JSONPath-ish expression against the top-level blocks
 * array. Supports: `blocks[N]`, `blocks[N].blocks[M]`, `blocks[N].whenTrue[M]`,
 * `blocks[N].whenFalse[M]`, `blocks[N].steps[M]` (returns the step itself
 * cast as JsonBlock for type symmetry — caller can distinguish via the
 * structural fields it exposes).
 */
function resolveJsonPath(rootBlocks: JsonBlock[], jsonPath: string): JsonBlock | null {
  const segments = jsonPath.match(/[a-zA-Z]+\[\d+\]/g);
  if (!segments) {
    return null;
  }

  let current: unknown = { blocks: rootBlocks };
  for (const segment of segments) {
    const match = /^([a-zA-Z]+)\[(\d+)\]$/.exec(segment);
    if (!match) {
      return null;
    }
    const [, key, idxStr] = match;
    const idx = Number(idxStr);
    const container = current as Record<string, unknown>;
    const arr = container[key as keyof typeof container];
    if (!Array.isArray(arr)) {
      return null;
    }
    const next = arr[idx];
    if (!next) {
      return null;
    }
    current = next;
  }
  return current as JsonBlock;
}

void CONTAINER_BLOCK_TYPES;
