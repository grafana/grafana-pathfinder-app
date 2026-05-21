/**
 * Inline Snippet References
 *
 * Walks a JsonGuide, finds every `snippet-ref` block at any depth
 * (top-level, inside sections, conditionals, assistants, multistep
 * containers), resolves each via the snippet resolver, and returns a
 * new guide with refs replaced by the snippet's `blocks` array spliced
 * in at the same position.
 *
 * Refs that fail to resolve are replaced by an inert markdown placeholder
 * block so the rest of the guide still renders. This is the
 * defense-in-depth boundary — by the time the parser sees the guide,
 * no `snippet-ref` blocks should remain.
 *
 * Pure function (apart from the injected resolver). Input is not mutated.
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

/**
 * Walk an array of blocks, replacing every snippet-ref with its
 * resolved body. Resolution is performed in parallel across the whole
 * tree to minimize total latency.
 */
export async function inlineSnippetRefsInBlocks(
  blocks: JsonBlock[],
  resolver: SnippetResolver = getSnippetResolver()
): Promise<JsonBlock[]> {
  // Pre-collect every unique ref id so we can resolve them all in parallel
  // before doing the splice walk. The resolver's internal cache also
  // dedupes, but pre-collecting keeps the splice walk synchronous.
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

/** Convenience wrapper: inline refs in a full guide. */
export async function inlineSnippetRefsInGuide(
  guide: JsonGuide,
  resolver: SnippetResolver = getSnippetResolver()
): Promise<JsonGuide> {
  const blocks = await inlineSnippetRefsInBlocks(guide.blocks, resolver);
  return { ...guide, blocks };
}

function collectRefIds(blocks: JsonBlock[], out: Set<string>): void {
  for (const block of blocks) {
    if (isSnippetRef(block)) {
      out.add(block.snippetId);
      continue;
    }
    // Recurse into container blocks. Snippets themselves cannot contain
    // refs (schema-enforced), but guides can nest refs inside sections,
    // conditionals, and assistants.
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
      // Spread the snippet's blocks in place. Snippets are no-ref by
      // schema, so we don't need to recurse into them.
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
