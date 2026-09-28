import type { JsonGuide } from '../types/json-guide.types';
import { validateSnippetReferences } from './snippet-references';

const guideWith = (blocks: JsonGuide['blocks']): JsonGuide => ({
  id: 'guide',
  title: 'Guide',
  blocks,
});

describe('validateSnippetReferences', () => {
  const catalogIds = new Set(['top-level', 'section', 'assistant', 'when-true', 'when-false']);

  it('accepts references present in the catalog at every legal nesting level', () => {
    const errors = validateSnippetReferences(
      guideWith([
        { type: 'snippet-ref', snippetId: 'top-level' },
        { type: 'section', blocks: [{ type: 'snippet-ref', snippetId: 'section' }] },
        { type: 'assistant', blocks: [{ type: 'snippet-ref', snippetId: 'assistant' }] },
        {
          type: 'conditional',
          conditions: ['is-admin'],
          whenTrue: [{ type: 'snippet-ref', snippetId: 'when-true' }],
          whenFalse: [{ type: 'snippet-ref', snippetId: 'when-false' }],
        },
      ]),
      catalogIds
    );

    expect(errors).toEqual([]);
  });

  it('reports every missing reference with its exact path', () => {
    const errors = validateSnippetReferences(
      guideWith([
        { type: 'section', blocks: [{ type: 'snippet-ref', snippetId: 'missing-section' }] },
        {
          type: 'conditional',
          conditions: ['is-admin'],
          whenTrue: [{ type: 'snippet-ref', snippetId: 'missing-true' }],
          whenFalse: [{ type: 'snippet-ref', snippetId: 'missing-false' }],
        },
      ]),
      new Set<string>()
    );

    expect(errors).toEqual([
      expect.objectContaining({
        code: 'unknown_snippet_ref',
        message: 'blocks[0].blocks[0].snippetId: snippet "missing-section" is not present in the snippets catalog',
      }),
      expect.objectContaining({
        code: 'unknown_snippet_ref',
        message: 'blocks[1].whenTrue[0].snippetId: snippet "missing-true" is not present in the snippets catalog',
      }),
      expect.objectContaining({
        code: 'unknown_snippet_ref',
        message: 'blocks[1].whenFalse[0].snippetId: snippet "missing-false" is not present in the snippets catalog',
      }),
    ]);
  });

  it('does nothing when no catalog was supplied', () => {
    const errors = validateSnippetReferences(
      guideWith([{ type: 'snippet-ref', snippetId: 'not-checked-without-the-flag' }]),
      undefined
    );

    expect(errors).toEqual([]);
  });
});
