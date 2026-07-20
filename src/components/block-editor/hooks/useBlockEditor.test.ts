import { act, renderHook } from '@testing-library/react';
import type {
  JsonGuide,
  JsonGuidedBlock,
  JsonInteractiveBlock,
  JsonMultistepBlock,
  JsonSectionBlock,
} from '../../../types/json-guide.types';
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

const mkInteractive = (content: string): JsonInteractiveBlock => ({
  type: 'interactive',
  action: 'highlight',
  reftarget: '.el',
  content,
});

describe('mergeBlocksToMultistep / mergeBlocksToGuided', () => {
  it('merges interactive blocks into a multistep block, mapping content to tooltip', () => {
    const guide: JsonGuide = { id: 'g', title: 'T', blocks: [mkInteractive('step A'), mkInteractive('step B')] };
    const { result } = renderHook(() => useBlockEditor({ initialGuide: guide }));
    const id0 = result.current.state.blocks[0]!.id!;
    const id1 = result.current.state.blocks[1]!.id!;

    act(() => result.current.mergeBlocksToMultistep([id0, id1]));

    const { blocks } = result.current.state;
    expect(blocks).toHaveLength(1);
    const merged = blocks[0]!.block as JsonMultistepBlock;
    expect(merged.type).toBe('multistep');
    expect(merged.steps).toEqual([
      expect.objectContaining({ action: 'highlight', tooltip: 'step A' }),
      expect.objectContaining({ action: 'highlight', tooltip: 'step B' }),
    ]);
  });

  it('merges interactive blocks into a guided block, mapping content to description (not tooltip)', () => {
    const guide: JsonGuide = { id: 'g', title: 'T', blocks: [mkInteractive('step A'), mkInteractive('step B')] };
    const { result } = renderHook(() => useBlockEditor({ initialGuide: guide }));
    const id0 = result.current.state.blocks[0]!.id!;
    const id1 = result.current.state.blocks[1]!.id!;

    act(() => result.current.mergeBlocksToGuided([id0, id1]));

    const merged = result.current.state.blocks[0]!.block as JsonGuidedBlock;
    expect(merged.type).toBe('guided');
    expect(merged.steps[0]).toEqual(expect.objectContaining({ description: 'step A' }));
    expect(merged.steps[0]!.tooltip).toBeUndefined();
  });

  it('flattens steps out of an existing multistep source block', () => {
    const existing: JsonMultistepBlock = {
      type: 'multistep',
      content: 'existing',
      steps: [
        { action: 'button', reftarget: '.x' },
        { action: 'navigate', reftarget: '/y' },
      ],
    };
    const guide: JsonGuide = { id: 'g', title: 'T', blocks: [existing, mkInteractive('step C')] };
    const { result } = renderHook(() => useBlockEditor({ initialGuide: guide }));
    const id0 = result.current.state.blocks[0]!.id!;
    const id1 = result.current.state.blocks[1]!.id!;

    act(() => result.current.mergeBlocksToMultistep([id0, id1]));

    const merged = result.current.state.blocks[0]!.block as JsonMultistepBlock;
    expect(merged.steps).toHaveLength(3);
    expect(merged.steps[2]).toEqual(expect.objectContaining({ action: 'highlight', tooltip: 'step C' }));
  });

  it('does nothing when fewer than 2 mergeable blocks are provided', () => {
    const guide: JsonGuide = { id: 'g', title: 'T', blocks: [mkInteractive('only one')] };
    const { result } = renderHook(() => useBlockEditor({ initialGuide: guide }));
    const id0 = result.current.state.blocks[0]!.id!;

    act(() => result.current.mergeBlocksToMultistep([id0]));

    expect(result.current.state.blocks).toHaveLength(1);
    expect(result.current.state.blocks[0]!.block.type).toBe('interactive');
  });
});

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

describe('loadGuide viewMode restoration', () => {
  it('defaults to edit mode when no viewMode is passed', () => {
    const { result } = renderHook(() => useBlockEditor());

    act(() => result.current.loadGuide(initialGuide));

    expect(result.current.state.viewMode).toBe('edit');
  });

  it('restores the passed-in viewMode instead of always resetting to edit', () => {
    const { result } = renderHook(() => useBlockEditor());

    act(() => result.current.loadGuide(initialGuide, undefined, 'preview'));

    expect(result.current.state.viewMode).toBe('preview');
  });
});
