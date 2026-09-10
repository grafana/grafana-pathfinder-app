import type { JsonBlock, JsonGuide, JsonSnippetRefBlock } from '../types/json-guide.types';
import { formatPath, type ValidationError } from './errors';

interface SnippetReference {
  id: string;
  path: Array<string | number>;
}

export function validateSnippetReferences(
  guide: JsonGuide,
  catalogIds: ReadonlySet<string> | undefined
): ValidationError[] {
  if (!catalogIds) {
    return [];
  }

  return collectSnippetReferences(guide.blocks).flatMap((reference) =>
    catalogIds.has(reference.id)
      ? []
      : [
          {
            message: `${formatPath(reference.path)}: snippet "${reference.id}" is not present in the snippets catalog`,
            path: reference.path,
            code: 'unknown_snippet_ref',
          },
        ]
  );
}

function collectSnippetReferences(
  blocks: JsonBlock[],
  parentPath: Array<string | number> = ['blocks']
): SnippetReference[] {
  const references: SnippetReference[] = [];

  for (const [index, block] of blocks.entries()) {
    const path = [...parentPath, index];

    if (isSnippetRef(block)) {
      references.push({ id: block.snippetId, path: [...path, 'snippetId'] });
    } else if (block.type === 'section' || block.type === 'assistant') {
      references.push(...collectSnippetReferences(block.blocks, [...path, 'blocks']));
    } else if (block.type === 'conditional') {
      references.push(...collectSnippetReferences(block.whenTrue, [...path, 'whenTrue']));
      references.push(...collectSnippetReferences(block.whenFalse, [...path, 'whenFalse']));
    }
  }

  return references;
}

function isSnippetRef(block: JsonBlock): block is JsonSnippetRefBlock {
  return block.type === 'snippet-ref';
}
