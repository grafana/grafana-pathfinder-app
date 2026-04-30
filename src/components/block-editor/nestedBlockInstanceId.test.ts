import type { EditorBlock } from './types';
import type { JsonSectionBlock } from '../../types/json-guide.types';
import {
  assignNestedInstanceId,
  copyNestedInstanceId,
  findSectionNestedBlockByInstanceId,
  readNestedInstanceId,
} from './nestedBlockInstanceId';

describe('nestedBlockInstanceId', () => {
  it('omits instance id from JSON serialization', () => {
    const block = assignNestedInstanceId({ type: 'markdown', content: 'x' }, 'id-1');
    expect(readNestedInstanceId(block)).toBe('id-1');
    expect(JSON.parse(JSON.stringify(block))).toEqual({ type: 'markdown', content: 'x' });
  });

  it('finds nested block after it is moved to another section', () => {
    const pinned = assignNestedInstanceId({ type: 'markdown', content: 'pin' }, 'pin-move');
    const sectionA: JsonSectionBlock = { type: 'section', title: 'A', blocks: [pinned] };
    const sectionB: JsonSectionBlock = { type: 'section', title: 'B', blocks: [] };
    const before: EditorBlock[] = [
      { id: 'sec-a', block: sectionA },
      { id: 'sec-b', block: sectionB },
    ];
    const after: EditorBlock[] = [
      { id: 'sec-a', block: { ...sectionA, blocks: [] } },
      { id: 'sec-b', block: { ...sectionB, blocks: [pinned] } },
    ];
    expect(findSectionNestedBlockByInstanceId(before, 'pin-move')).toEqual({
      sectionId: 'sec-a',
      nestedIndex: 0,
    });
    expect(findSectionNestedBlockByInstanceId(after, 'pin-move')).toEqual({
      sectionId: 'sec-b',
      nestedIndex: 0,
    });
  });

  it('finds nested block after reorder within section', () => {
    const a = assignNestedInstanceId({ type: 'markdown', content: 'a' }, 'pin-a');
    const b = { type: 'markdown' as const, content: 'b' };
    const section: JsonSectionBlock = { type: 'section', title: 'S', blocks: [a, b] };
    const blocks: EditorBlock[] = [{ id: 'sec-1', block: section }];

    const foundBefore = findSectionNestedBlockByInstanceId(blocks, 'pin-a');
    expect(foundBefore).toEqual({ sectionId: 'sec-1', nestedIndex: 0 });

    const reordered: EditorBlock[] = [
      {
        id: 'sec-1',
        block: { ...section, blocks: [b, a] },
      },
    ];
    const foundAfter = findSectionNestedBlockByInstanceId(reordered, 'pin-a');
    expect(foundAfter).toEqual({ sectionId: 'sec-1', nestedIndex: 1 });
  });

  it('preserves instance id when copying onto updated block', () => {
    const prev = assignNestedInstanceId({ type: 'markdown', content: 'old' }, 'same');
    const next = { type: 'markdown' as const, content: 'new' };
    const merged = copyNestedInstanceId(prev, next);
    expect(readNestedInstanceId(merged)).toBe('same');
    expect(merged).toMatchObject({ type: 'markdown', content: 'new' });
  });
});
