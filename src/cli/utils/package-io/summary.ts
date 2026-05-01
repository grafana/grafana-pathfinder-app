/**
 * Build a compact, ordered tree summary of an authoring artifact.
 *
 * One-stop helper used by both the CLI `inspect` command and the MCP mutation
 * tools. The shape (`TreeNode[]`) is the canonical "block navigation surface"
 * an agent reasons over without re-reading the full artifact JSON. Each node
 * carries its JSONPath, id, type, an optional type-specific hint, and (for
 * containers) recursive children.
 *
 * Keep this co-located with the rest of the tree primitives in
 * `package-io/`. Container key knowledge belongs to that module; this one
 * shapes the output for human / agent consumption.
 */

import type { ContentJson } from '../../../types/package.types';
import type { JsonBlock } from '../../../types/json-guide.types';

export interface TreeNode {
  /** JSONPath to the block, e.g. "blocks[0].blocks[1]". */
  path: string;
  /** Block id, or "<unset>" for an unnamed leaf. */
  id: string;
  /** Block type discriminator (`markdown`, `section`, etc.). */
  type: string;
  /** Type-specific hint shown after the type, e.g. interactive's action or section's title. */
  hint?: string;
  /** Present only on container blocks (section, assistant, conditional). */
  children?: TreeNode[];
}

export function buildArtifactSummary(content: ContentJson): TreeNode[] {
  return buildTree(content.blocks, 'blocks');
}

/**
 * Build a tree representation of an ordered block array. Every node carries
 * its full JSONPath, id, type, and a type-specific hint; containers also carry
 * their children recursively.
 */
export function buildTree(blocks: JsonBlock[], pathPrefix: string): TreeNode[] {
  const nodes: TreeNode[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block) {
      continue;
    }
    const path = `${pathPrefix}[${i}]`;
    const node: TreeNode = {
      path,
      id: typeof block.id === 'string' && block.id.length > 0 ? block.id : '<unset>',
      type: block.type,
    };
    const hint = blockHint(block);
    if (hint) {
      node.hint = hint;
    }
    const children = buildChildrenTree(block, path);
    if (children) {
      node.children = children;
    }
    nodes.push(node);
  }
  return nodes;
}

export function buildChildrenTree(block: JsonBlock, path: string): TreeNode[] | undefined {
  if (block.type === 'section' || block.type === 'assistant') {
    const arr = (block as unknown as { blocks?: JsonBlock[] }).blocks;
    return Array.isArray(arr) ? buildTree(arr, `${path}.blocks`) : undefined;
  }
  if (block.type === 'conditional') {
    const c = block as unknown as { whenTrue?: JsonBlock[]; whenFalse?: JsonBlock[] };
    const out: TreeNode[] = [];
    if (Array.isArray(c.whenTrue)) {
      out.push(...buildTree(c.whenTrue, `${path}.whenTrue`));
    }
    if (Array.isArray(c.whenFalse)) {
      out.push(...buildTree(c.whenFalse, `${path}.whenFalse`));
    }
    return out;
  }
  return undefined;
}

function blockHint(block: JsonBlock): string | undefined {
  const record = block as unknown as Record<string, unknown>;
  if (block.type === 'interactive' && typeof record.action === 'string') {
    return record.action;
  }
  if ((block.type === 'section' || block.type === 'assistant') && typeof record.title === 'string') {
    return record.title;
  }
  return undefined;
}
