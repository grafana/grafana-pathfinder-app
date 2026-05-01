/**
 * `pathfinder-cli inspect <dir> [--block <id>] [--at <jsonpath>]` — read-only
 * view of a package. The CLI's "describe state for an agent without
 * re-injecting the schema" tool.
 */

import { Command, Option } from 'commander';

import { isContainerBlockType, type BlockType } from '../utils/block-registry';
import {
  buildChildrenTree,
  buildTree,
  collectAllIds,
  findBlockById,
  PackageIOError,
  readPackage,
  validatePackageState,
  walkBlocks,
  type TreeNode,
} from '../utils/package-io';
import { issueToOutcome, printOutcome, readOutputOptions, renderError, type CommandOutcome } from '../utils/output';
import type { JsonBlock } from '../../types/json-guide.types';

export const inspectCommand = new Command('inspect')
  .description('Show the current state of a package (read-only)')
  .argument('<dir>', 'package directory')
  .addOption(new Option('--block <id>', 'Show details for a single block by id'))
  .addOption(
    new Option(
      '--at <jsonpath>',
      'Show the block (or enumerate the array) at a JSONPath (e.g., blocks, blocks[2], blocks[2].blocks)'
    )
  )
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
    return { status: 'error', code: 'NOT_FOUND', message: renderError(err) };
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
    return blockToOutcome(block, locateBlockPath(state.content, block) ?? '<unknown>');
  }

  if (args.at) {
    const resolved = resolveJsonPath(state.content.blocks, args.at);
    if (resolved === null) {
      return {
        status: 'error',
        code: 'BLOCK_NOT_FOUND',
        message: `No block or array at path ${args.at}`,
      };
    }
    if (resolved.kind === 'array') {
      return arrayToOutcome(args.at, resolved.array);
    }
    return blockToOutcome(resolved.block, args.at);
  }

  // Whole-package summary, now with an ordered tree.
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
  const validation = validatePackageState(state.content, state.manifest, {
    manifestSchemaVersionAuthored: state.manifestSchemaVersionAuthored,
  });

  const tree = buildTree(state.content.blocks, 'blocks');
  const treeText = renderTreeText(tree);

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
      ...(treeText ? { tree: treeText.split('\n') } : {}),
    },
    data: {
      id: state.content.id,
      title: state.content.title,
      schemaVersion: state.content.schemaVersion,
      blockCount,
      typeCounts: counts,
      containers,
      tree,
      valid: validation.ok,
      issues: validation.issues,
    },
  };
}

function blockToOutcome(block: JsonBlock, position: string): CommandOutcome {
  const record = block as unknown as Record<string, unknown>;
  const childCount = countChildren(block);
  const childrenTree = buildChildrenTree(block, position);
  return {
    status: 'ok',
    summary: `Block ${typeof block.id === 'string' ? `"${block.id}" ` : ''}(${block.type}) at ${position}`,
    details: {
      type: block.type,
      id: typeof block.id === 'string' ? block.id : '<unset>',
      position,
      ...(typeof record.title === 'string' ? { title: record.title } : {}),
      ...(isContainerBlockType(block.type as BlockType) ? { children: childCount } : {}),
      ...(childrenTree && childrenTree.length > 0 ? { tree: renderTreeText(childrenTree).split('\n') } : {}),
    },
    data: {
      type: block.type,
      id: block.id,
      position,
      block: record,
      ...(childrenTree ? { tree: childrenTree } : {}),
    },
  };
}

/**
 * Render an outcome describing an array of blocks at a JSONPath. Used when the
 * user passes `--at blocks` (or `--at <container>.blocks`) to enumerate
 * children without first knowing their ids or count.
 */
function arrayToOutcome(jsonPath: string, blocks: JsonBlock[]): CommandOutcome {
  const tree = buildTree(blocks, jsonPath);
  return {
    status: 'ok',
    summary: `${jsonPath} — ${blocks.length} block(s)`,
    details: {
      path: jsonPath,
      length: blocks.length,
      ...(tree.length > 0 ? { tree: renderTreeText(tree).split('\n') } : {}),
    },
    data: {
      path: jsonPath,
      length: blocks.length,
      tree,
    },
  };
}

/**
 * Render the tree as an indented multi-line string. Each line: `<indent><path>
 * <id> (<type>[: <hint>])`.
 */
function renderTreeText(tree: TreeNode[]): string {
  const lines: string[] = [];
  const walk = (nodes: TreeNode[], depth: number) => {
    for (const node of nodes) {
      const indent = '  '.repeat(depth);
      const typeLabel = node.hint ? `${node.type}: ${node.hint}` : node.type;
      lines.push(`${indent}${node.path}  ${node.id}  (${typeLabel})`);
      if (node.children && node.children.length > 0) {
        walk(node.children, depth + 1);
      }
    }
  };
  walk(tree, 0);
  return lines.join('\n');
}

function locateBlockPath(content: { blocks: JsonBlock[] }, target: JsonBlock): string | null {
  // Iterative DFS that tracks the running path; the package-io walker doesn't
  // expose the path, so we re-walk here.
  const stack: Array<{ blocks: JsonBlock[]; prefix: string }> = [{ blocks: content.blocks, prefix: 'blocks' }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) {
      break;
    }
    const { blocks, prefix } = frame;
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (!block) {
        continue;
      }
      const here = `${prefix}[${i}]`;
      if (block === target) {
        return here;
      }
      if (block.type === 'section' || block.type === 'assistant') {
        const arr = (block as unknown as { blocks?: JsonBlock[] }).blocks;
        if (Array.isArray(arr)) {
          stack.push({ blocks: arr, prefix: `${here}.blocks` });
        }
      } else if (block.type === 'conditional') {
        const c = block as unknown as { whenTrue?: JsonBlock[]; whenFalse?: JsonBlock[] };
        if (Array.isArray(c.whenTrue)) {
          stack.push({ blocks: c.whenTrue, prefix: `${here}.whenTrue` });
        }
        if (Array.isArray(c.whenFalse)) {
          stack.push({ blocks: c.whenFalse, prefix: `${here}.whenFalse` });
        }
      }
    }
  }
  return null;
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

type ResolvedPath = { kind: 'block'; block: JsonBlock } | { kind: 'array'; array: JsonBlock[] };

/**
 * Resolve a JSONPath-ish expression against the top-level blocks array. Each
 * segment is either `<key>` (returns the array under that key) or
 * `<key>[<n>]` (returns the n-th element under that key).
 *
 * Supported keys: `blocks`, `whenTrue`, `whenFalse`, `steps`. Trailing
 * key-without-index segments resolve to an array, allowing the caller to
 * enumerate (e.g. `blocks` returns the top-level array, `blocks[2].blocks`
 * returns the children of the 3rd top-level block when it's a container).
 */
function resolveJsonPath(rootBlocks: JsonBlock[], jsonPath: string): ResolvedPath | null {
  const trimmed = jsonPath.trim();
  if (trimmed.length === 0) {
    return null;
  }
  // Tokenize on `.` to walk segments. Each segment is either `key` or
  // `key[N]`.
  const segments = trimmed.split('.');
  let current: { kind: 'block'; block: JsonBlock } | { kind: 'array'; array: JsonBlock[] } = {
    kind: 'array',
    array: rootBlocks,
  };

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    const match = /^([a-zA-Z]+)(?:\[(\d+)\])?$/.exec(segment);
    if (!match) {
      return null;
    }
    const key = match[1]!;
    const idxStr = match[2];

    // The first segment can name the implicit root: when it's `blocks` and
    // we already point at the root block array, we treat that as a no-op.
    let arr: JsonBlock[];
    if (i === 0 && current.kind === 'array' && key === 'blocks') {
      arr = current.array;
    } else if (current.kind === 'block') {
      const container = current.block as unknown as Record<string, unknown>;
      const candidate = container[key];
      if (!Array.isArray(candidate)) {
        return null;
      }
      arr = candidate as JsonBlock[];
    } else {
      // Plain array can't be drilled into by named key (other than the root
      // case above).
      return null;
    }

    if (idxStr === undefined) {
      // Bare-key segment resolves to the array itself.
      current = { kind: 'array', array: arr };
    } else {
      const idx = Number(idxStr);
      const next: JsonBlock | undefined = arr[idx];
      if (!next) {
        return null;
      }
      current = { kind: 'block', block: next };
    }
  }

  return current;
}
