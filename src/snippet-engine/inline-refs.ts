/**
 * Replaces every `snippet-ref` in a guide (at any depth) with the resolved
 * snippet's blocks; failed refs become an inert markdown placeholder. This is
 * the defense-in-depth boundary — no `snippet-ref` should reach the parser.
 * Pure apart from the injected resolver; input is not mutated.
 */

import type { JsonBlock, JsonGuide, JsonSnippetRefBlock } from '../types/json-guide.types';

import { getSnippetResolver } from './caching-snippet-resolver';
import type { SnippetResolution, SnippetResolver } from './types';

function isSnippetRef(block: JsonBlock): block is JsonSnippetRefBlock {
  return block.type === 'snippet-ref';
}

function placeholderForFailure(failure: Extract<SnippetResolution, { ok: false }>): JsonBlock {
  return {
    type: 'markdown',
    content: `_Snippet **${failure.id}** could not be loaded (${failure.error.code}). The author should check the snippet ID or refresh the catalog._`,
  };
}

export async function inlineSnippetRefsInBlocks(
  blocks: JsonBlock[],
  resolver: SnippetResolver = getSnippetResolver()
): Promise<JsonBlock[]> {
  // Resolve all unique ref ids in parallel before the synchronous splice walk.
  const ids = new Set<string>();
  collectRefIds(blocks, ids);

  if (ids.size === 0) {
    return blocks;
  }

  const resolutions = new Map<string, SnippetResolution>();
  await Promise.all(
    [...ids].map(async (id) => {
      resolutions.set(id, await resolver.resolve(id));
    })
  );

  return spliceBlocks(blocks, resolutions);
}

export async function inlineSnippetRefsInGuide(
  guide: JsonGuide,
  resolver: SnippetResolver = getSnippetResolver()
): Promise<JsonGuide> {
  const blocks = await inlineSnippetRefsInBlocks(guide.blocks, resolver);
  return { ...guide, blocks };
}

/** True if any block in the guide tree is a `snippet-ref`. */
export function guideHasSnippetRefs(guide: JsonGuide): boolean {
  return blocksHaveSnippetRef(guide.blocks);
}

function blocksHaveSnippetRef(blocks: JsonBlock[]): boolean {
  for (const block of blocks) {
    if (isSnippetRef(block)) {
      return true;
    }
    if (block.type === 'section' || block.type === 'assistant') {
      if (blocksHaveSnippetRef(block.blocks)) {
        return true;
      }
    } else if (block.type === 'conditional') {
      if (blocksHaveSnippetRef(block.whenTrue) || blocksHaveSnippetRef(block.whenFalse)) {
        return true;
      }
    }
  }
  return false;
}

function collectRefIds(blocks: JsonBlock[], out: Set<string>): void {
  for (const block of blocks) {
    if (isSnippetRef(block)) {
      out.add(block.snippetId);
      continue;
    }
    // Guides can nest refs inside sections, conditionals, and assistants.
    if (block.type === 'section' || block.type === 'assistant') {
      collectRefIds(block.blocks, out);
    } else if (block.type === 'conditional') {
      collectRefIds(block.whenTrue, out);
      collectRefIds(block.whenFalse, out);
    }
  }
}

function spliceBlocks(blocks: JsonBlock[], resolutions: Map<string, SnippetResolution>): JsonBlock[] {
  const result: JsonBlock[] = [];
  for (const block of blocks) {
    if (isSnippetRef(block)) {
      const resolution = resolutions.get(block.snippetId);
      if (!resolution || !resolution.ok) {
        result.push(
          placeholderForFailure(
            resolution ?? {
              ok: false,
              id: block.snippetId,
              error: { code: 'not-found', message: 'resolver returned nothing' },
            }
          )
        );
        continue;
      }
      result.push(...resolution.snippet.blocks);
      continue;
    }

    if (block.type === 'section') {
      result.push({ ...block, blocks: spliceBlocks(block.blocks, resolutions) });
    } else if (block.type === 'assistant') {
      result.push({ ...block, blocks: spliceBlocks(block.blocks, resolutions) });
    } else if (block.type === 'conditional') {
      result.push({
        ...block,
        whenTrue: spliceBlocks(block.whenTrue, resolutions),
        whenFalse: spliceBlocks(block.whenFalse, resolutions),
      });
    } else {
      result.push(block);
    }
  }
  return result;
}
