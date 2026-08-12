import { act, renderHook } from '@testing-library/react';

import type { JsonGuidedBlock, JsonMultistepBlock } from '../../../types/json-guide.types';
import {
  useBlockConversionHandlers,
  type ConversionEditorInterface,
  type ConversionFormStateInterface,
} from './useBlockConversionHandlers';

describe('useBlockConversionHandlers', () => {
  it('field-maps a conditional-branch block without losing shared metadata', () => {
    const source: JsonMultistepBlock = {
      type: 'multistep',
      id: 'conditional-step-group',
      content: 'Complete these steps',
      steps: [{ action: 'noop', tooltip: 'Preserve this text' }],
      authorNote: 'Keep this note',
    };
    const updateConditionalBranchBlock = jest.fn();
    const closeBlockForm = jest.fn();
    const editor: ConversionEditorInterface = {
      state: { blocks: [] },
      removeBlock: jest.fn(),
      addBlock: jest.fn(),
      addBlockToSection: jest.fn(),
      deleteNestedBlock: jest.fn(),
      updateBlock: jest.fn(),
      updateNestedBlock: jest.fn(),
      updateConditionalBranchBlock,
    };
    const formState: ConversionFormStateInterface = {
      editingBlock: null,
      editingNestedBlock: null,
      editingConditionalBranchBlock: {
        conditionalId: 'conditional-1',
        branch: 'whenTrue',
        nestedIndex: 2,
        block: source,
      },
      closeBlockForm,
      setEditingBlockType: jest.fn(),
      setEditingBlock: jest.fn(),
      setEditingNestedBlock: jest.fn(),
      setEditingConditionalBranchBlock: jest.fn(),
    };

    const { result } = renderHook(() => useBlockConversionHandlers({ editor, formState }));

    act(() => result.current.handleConvertType('guided'));

    expect(updateConditionalBranchBlock).toHaveBeenCalledWith(
      'conditional-1',
      'whenTrue',
      2,
      expect.objectContaining({
        type: 'guided',
        id: 'conditional-step-group',
        authorNote: 'Keep this note',
        steps: [expect.objectContaining({ description: 'Preserve this text', tooltip: undefined })],
      })
    );
    expect(closeBlockForm).toHaveBeenCalledTimes(1);
  });

  it('maps guided descriptions back to tooltips in conditional branches', () => {
    const source: JsonGuidedBlock = {
      type: 'guided',
      id: 'conditional-guided-group',
      content: 'Complete these steps',
      steps: [{ action: 'noop', description: 'Preserve this description' }],
      authorNote: 'Keep this note too',
    };
    const updateConditionalBranchBlock = jest.fn();
    const closeBlockForm = jest.fn();
    const editor: ConversionEditorInterface = {
      state: { blocks: [] },
      removeBlock: jest.fn(),
      addBlock: jest.fn(),
      addBlockToSection: jest.fn(),
      deleteNestedBlock: jest.fn(),
      updateBlock: jest.fn(),
      updateNestedBlock: jest.fn(),
      updateConditionalBranchBlock,
    };
    const formState: ConversionFormStateInterface = {
      editingBlock: null,
      editingNestedBlock: null,
      editingConditionalBranchBlock: {
        conditionalId: 'conditional-2',
        branch: 'whenFalse',
        nestedIndex: 1,
        block: source,
      },
      closeBlockForm,
      setEditingBlockType: jest.fn(),
      setEditingBlock: jest.fn(),
      setEditingNestedBlock: jest.fn(),
      setEditingConditionalBranchBlock: jest.fn(),
    };

    const { result } = renderHook(() => useBlockConversionHandlers({ editor, formState }));

    act(() => result.current.handleConvertType('multistep'));

    expect(updateConditionalBranchBlock).toHaveBeenCalledWith(
      'conditional-2',
      'whenFalse',
      1,
      expect.objectContaining({
        type: 'multistep',
        id: 'conditional-guided-group',
        authorNote: 'Keep this note too',
        steps: [expect.objectContaining({ tooltip: 'Preserve this description', description: undefined })],
      })
    );
    expect(closeBlockForm).toHaveBeenCalledTimes(1);
  });
});
