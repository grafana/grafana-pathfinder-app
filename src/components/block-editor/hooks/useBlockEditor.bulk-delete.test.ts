import type { EditorBlock } from '../types';
import type { JsonConditionalBlock, JsonSectionBlock } from '../../../types/json-guide.types';
import { canMergeSelection, deleteSelectedBlocks, resolveSelectedBlock } from './useBlockEditor.bulk-delete';

const markdown = (id: string): EditorBlock => ({ id, block: { type: 'markdown', content: id } });
const interactive = (id: string): EditorBlock => ({
  id,
  block: { type: 'interactive', action: 'button', reftarget: `#${id}`, content: id },
});
const section = (id: string, blocks: JsonSectionBlock['blocks']): EditorBlock => ({
  id,
  block: { type: 'section', title: id, blocks },
});
const conditional = (id: string): EditorBlock => ({
  id,
  block: {
    type: 'conditional',
    conditions: ['is-admin'],
    whenTrue: [markdown(`${id}-true-child`), interactive(`${id}-true-interactive`)].map((entry) => entry.block),
    whenFalse: [markdown(`${id}-false-child`)].map((entry) => entry.block),
  } satisfies JsonConditionalBlock,
});

describe('resolveSelectedBlock', () => {
  const blocks = [
    section(
      'section-1',
      [markdown('nested-a'), interactive('nested-b')].map((entry) => entry.block)
    ),
    conditional('conditional-1'),
    interactive('root-1'),
  ];

  it('resolves root, section nested, and conditional branch IDs', () => {
    expect(resolveSelectedBlock(blocks, 'root-1')).toMatchObject({ kind: 'root', rootIndex: 2 });
    expect(resolveSelectedBlock(blocks, 'section-1-nested-1')).toMatchObject({
      kind: 'section',
      rootIndex: 0,
      nestedIndex: 1,
      block: { type: 'interactive' },
    });
    expect(resolveSelectedBlock(blocks, 'conditional-1-true-0')).toMatchObject({
      kind: 'conditional',
      rootIndex: 1,
      branch: 'whenTrue',
      nestedIndex: 0,
    });
  });

  it('rejects stale or malformed child IDs', () => {
    expect(resolveSelectedBlock(blocks, 'section-1-nested-9')).toBeNull();
    expect(resolveSelectedBlock(blocks, 'conditional-1-false-nope')).toBeNull();
    expect(resolveSelectedBlock(blocks, 'missing')).toBeNull();
  });
});

describe('deleteSelectedBlocks', () => {
  it('removes mixed root, section, and conditional selections without index drift', () => {
    const blocks = [
      section(
        'section-1',
        [markdown('nested-a'), markdown('nested-b'), markdown('nested-c')].map((entry) => entry.block)
      ),
      conditional('conditional-1'),
      markdown('root-1'),
      markdown('root-2'),
    ];

    const result = deleteSelectedBlocks(
      blocks,
      new Set(['section-1-nested-0', 'section-1-nested-2', 'conditional-1-true-0', 'root-1'])
    );

    expect(result).toHaveLength(3);
    expect(
      (result[0]!.block as JsonSectionBlock).blocks.map((block) => ('content' in block ? block.content : null))
    ).toEqual(['nested-b']);
    expect((result[1]!.block as JsonConditionalBlock).whenTrue).toHaveLength(1);
    expect((result[1]!.block as JsonConditionalBlock).whenFalse).toHaveLength(1);
    expect(result[2]!.id).toBe('root-2');
  });

  it('returns the same array for stale selections and removes a selected parent with its child', () => {
    const blocks = [
      section(
        'section-1',
        [markdown('nested-a')].map((entry) => entry.block)
      ),
      markdown('root-1'),
    ];
    expect(deleteSelectedBlocks(blocks, new Set(['missing']))).toBe(blocks);
    const result = deleteSelectedBlocks(blocks, new Set(['section-1', 'section-1-nested-0']));
    expect(result).toEqual([blocks[1]]);
  });
});

describe('canMergeSelection', () => {
  const blocks = [
    section(
      'section-1',
      [interactive('nested')].map((entry) => entry.block)
    ),
    interactive('root'),
  ];

  it('allows only mergeable root and section-child selections', () => {
    expect(canMergeSelection(blocks, new Set(['root', 'section-1-nested-0']))).toBe(true);
    expect(canMergeSelection(blocks, new Set(['root']))).toBe(false);
    expect(canMergeSelection([markdown('root'), interactive('other')], new Set(['root', 'other']))).toBe(false);
  });
});
