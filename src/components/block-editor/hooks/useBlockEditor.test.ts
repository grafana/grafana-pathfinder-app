import { act, renderHook } from '@testing-library/react';
import type { JsonGuide, JsonSectionBlock } from '../../../types/json-guide.types';
import { assignNestedInstanceId } from '../nestedBlockInstanceId';
import { useBlockEditor } from './useBlockEditor';

const initialGuide: JsonGuide = {
  id: 'guide-1',
  title: 'Guide',
  blocks: [
    {
      type: 'section',
      title: 'Section',
      blocks: [{ type: 'markdown', content: 'nested content' }],
    } satisfies JsonSectionBlock,
  ],
};

describe('useBlockEditor updateNestedBlock', () => {
  it('marks editor dirty and notifies by default', () => {
    const onChange = jest.fn();
    const { result } = renderHook(() => useBlockEditor({ initialGuide, onChange }));
    const sectionEditorId = result.current.state.blocks[0]!.id;

    act(() => {
      result.current.updateNestedBlock(sectionEditorId, 0, { type: 'markdown', content: 'updated content' });
    });

    expect(result.current.state.isDirty).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    const updatedSection = result.current.state.blocks[0]!.block as JsonSectionBlock;
    expect(updatedSection.blocks[0]).toEqual({ type: 'markdown', content: 'updated content' });
  });

  it('supports internal metadata updates without dirty/notify side effects', () => {
    const onChange = jest.fn();
    const { result } = renderHook(() => useBlockEditor({ initialGuide, onChange }));
    const sectionEditorId = result.current.state.blocks[0]!.id;
    const section = result.current.state.blocks[0]!.block as JsonSectionBlock;
    const nested = section.blocks[0]!;

    act(() => {
      result.current.updateNestedBlock(sectionEditorId, 0, assignNestedInstanceId(nested, 'instance-1'), {
        markDirty: false,
        notifyChange: false,
      });
    });

    expect(result.current.state.isDirty).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });
});
