import type { EditorBlock } from '../types';
import type {
  JsonGuidedBlock,
  JsonInteractiveBlock,
  JsonMultistepBlock,
  JsonSectionBlock,
} from '../../../types/json-guide.types';
import { mergeBlocks } from './useBlockEditor.merge';

const interactive = (id: string, overrides: Partial<JsonInteractiveBlock> = {}): EditorBlock => ({
  id,
  block: {
    type: 'interactive',
    action: 'button',
    reftarget: `#btn-${id}`,
    content: `do ${id}`,
    ...overrides,
  },
});

const markdown = (id: string, content = 'note'): EditorBlock => ({
  id,
  block: { type: 'markdown', content },
});

const section = (id: string, nested: JsonSectionBlock['blocks']): EditorBlock => ({
  id,
  block: { type: 'section', title: 'Section', blocks: nested },
});

describe('mergeBlocks', () => {
  it('returns null when fewer than two mergeable blocks are selected', () => {
    const prev = [interactive('a'), markdown('b')];
    expect(mergeBlocks(prev, ['a'], 'multistep')).toBeNull();
    expect(mergeBlocks(prev, ['a', 'b'], 'multistep')).toBeNull(); // markdown isn't mergeable
  });

  it('returns null when no ids match', () => {
    const prev = [interactive('a'), interactive('b')];
    expect(mergeBlocks(prev, ['x', 'y'], 'guided')).toBeNull();
  });

  it('merges two root-level interactive blocks into a multistep at the first position', () => {
    const prev = [markdown('top'), interactive('a'), interactive('b'), markdown('tail')];
    const result = mergeBlocks(prev, ['a', 'b'], 'multistep');
    expect(result).not.toBeNull();
    expect(result!.map((b) => b.block.type)).toEqual(['markdown', 'multistep', 'markdown']);

    const merged = result![1]!.block as JsonMultistepBlock;
    expect(merged.type).toBe('multistep');
    expect(merged.content).toBe('Complete the following steps:');
    expect(merged.steps).toEqual([
      { action: 'button', reftarget: '#btn-a', tooltip: 'do a' },
      { action: 'button', reftarget: '#btn-b', tooltip: 'do b' },
    ]);
  });

  it('orders steps by document position even when selection ids are passed out of order', () => {
    const prev = [interactive('first'), interactive('middle'), interactive('last')];
    const result = mergeBlocks(prev, ['last', 'first'], 'guided')!;
    const merged = result.find((b) => b.block.type === 'guided')!.block as JsonGuidedBlock;
    expect(merged.steps.map((s) => s.reftarget)).toEqual(['#btn-first', '#btn-last']);
  });

  it('prefers tooltip over content when producing multistep steps', () => {
    const prev = [
      interactive('a', { tooltip: 'tip-a', content: 'content-a' }),
      interactive('b', { content: 'content-b' }), // no tooltip → fall back to content
      interactive('c', { tooltip: '', content: 'content-c' }), // empty tooltip → fall back to content
    ];
    const result = mergeBlocks(prev, ['a', 'b', 'c'], 'multistep')!;
    const merged = result.find((b) => b.block.type === 'multistep')!.block as JsonMultistepBlock;
    expect(merged.steps.map((s) => s.tooltip)).toEqual(['tip-a', 'content-b', 'content-c']);
  });

  it('maps interactive content to description when merging into a guided block', () => {
    const prev = [interactive('a', { content: 'first' }), interactive('b', { content: 'second' })];
    const result = mergeBlocks(prev, ['a', 'b'], 'guided')!;
    const merged = result.find((b) => b.block.type === 'guided')!.block as JsonGuidedBlock;
    expect(merged.content).toBe('Follow the steps below:');
    expect(merged.steps).toEqual([
      { action: 'button', reftarget: '#btn-a', description: 'first' },
      { action: 'button', reftarget: '#btn-b', description: 'second' },
    ]);
  });

  it('expands a selected multistep block into its individual steps', () => {
    const existingMultistep: EditorBlock = {
      id: 'm',
      block: {
        type: 'multistep',
        content: 'old multistep',
        steps: [
          { action: 'button', reftarget: '#x', tooltip: 'x' },
          { action: 'button', reftarget: '#y', tooltip: 'y' },
        ],
      } satisfies JsonMultistepBlock,
    };
    const prev = [existingMultistep, interactive('after', { tooltip: 'after' })];
    const result = mergeBlocks(prev, ['m', 'after'], 'multistep')!;
    const merged = result.find((b) => b.block.type === 'multistep')!.block as JsonMultistepBlock;
    expect(merged.steps).toEqual([
      { action: 'button', reftarget: '#x', tooltip: 'x' },
      { action: 'button', reftarget: '#y', tooltip: 'y' },
      { action: 'button', reftarget: '#btn-after', tooltip: 'after' },
    ]);
  });

  it('merges nested blocks inside their section and places the merged block at the first nested index', () => {
    const nestedInteractives = [
      { type: 'interactive', action: 'button', reftarget: '#n-a', content: 'na' },
      { type: 'markdown', content: 'spacer' },
      { type: 'interactive', action: 'button', reftarget: '#n-b', content: 'nb' },
    ] as JsonSectionBlock['blocks'];
    const prev = [section('s1', nestedInteractives), markdown('after-section')];

    const result = mergeBlocks(prev, ['s1-nested-0', 's1-nested-2'], 'multistep')!;
    expect(result).toHaveLength(2); // section + markdown — no new root block
    const updatedSection = result[0]!.block as JsonSectionBlock;
    expect(updatedSection.blocks.map((b) => b.type)).toEqual(['multistep', 'markdown']);
    const merged = updatedSection.blocks[0] as JsonMultistepBlock;
    expect(merged.steps.map((s) => s.reftarget)).toEqual(['#n-a', '#n-b']);
  });

  it('leaves the root list intact (no surplus block) when merging nested blocks', () => {
    const prev = [
      section('s1', [
        { type: 'interactive', action: 'button', reftarget: '#n-a', content: 'a' },
        { type: 'interactive', action: 'button', reftarget: '#n-b', content: 'b' },
      ] as JsonSectionBlock['blocks']),
    ];
    const result = mergeBlocks(prev, ['s1-nested-0', 's1-nested-1'], 'guided')!;
    expect(result).toHaveLength(1);
    const updatedSection = result[0]!.block as JsonSectionBlock;
    expect(updatedSection.blocks).toHaveLength(1);
    expect(updatedSection.blocks[0]!.type).toBe('guided');
  });

  it('inserts the merged block at the first selected root position, accounting for removed blocks before it', () => {
    const prev = [
      markdown('top'),
      interactive('a'),
      markdown('mid'),
      interactive('b'),
      interactive('c'),
      markdown('tail'),
    ];
    const result = mergeBlocks(prev, ['a', 'b', 'c'], 'multistep')!;
    // Layout: top kept at 0, merged block lands at index 1 (where 'a' lived),
    // mid kept (now at 2), tail kept (now at 3). 'b' and 'c' are absorbed.
    expect(result).toHaveLength(4);
    expect(result.map((b) => b.block.type)).toEqual(['markdown', 'multistep', 'markdown', 'markdown']);
    expect(result[0]!.id).toBe('top');
    expect(result[2]!.id).toBe('mid');
    expect(result[3]!.id).toBe('tail');
    const merged = result[1]!.block as JsonMultistepBlock;
    expect(merged.steps).toHaveLength(3);
    expect(merged.steps.map((s) => s.reftarget)).toEqual(['#btn-a', '#btn-b', '#btn-c']);
  });
});
