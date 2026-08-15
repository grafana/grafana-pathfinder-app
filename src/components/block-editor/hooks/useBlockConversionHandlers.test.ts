import { act, renderHook } from '@testing-library/react';
import { getAppEvents } from '@grafana/runtime';

import type { JsonGuidedBlock, JsonMultistepBlock } from '../../../types/json-guide.types';
import { JsonBlockSchema } from '../../../types/json-guide.schema';
import {
  useBlockConversionHandlers,
  type ConversionEditorInterface,
  type ConversionFormStateInterface,
} from './useBlockConversionHandlers';

jest.mock('@grafana/runtime', () => ({ getAppEvents: jest.fn() }));

const publish = jest.fn();

function makeEditor(overrides: Partial<ConversionEditorInterface> = {}): ConversionEditorInterface {
  return {
    state: { blocks: [] },
    removeBlock: jest.fn(),
    addBlock: jest.fn(),
    addBlockToSection: jest.fn(),
    deleteNestedBlock: jest.fn(),
    updateBlock: jest.fn(),
    updateNestedBlock: jest.fn(),
    updateConditionalBranchBlock: jest.fn(),
    ...overrides,
  };
}

function makeFormState(overrides: Partial<ConversionFormStateInterface> = {}): ConversionFormStateInterface {
  return {
    editingBlock: null,
    editingNestedBlock: null,
    editingConditionalBranchBlock: null,
    closeBlockForm: jest.fn(),
    setEditingBlockType: jest.fn(),
    setEditingBlock: jest.fn(),
    setEditingNestedBlock: jest.fn(),
    setEditingConditionalBranchBlock: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  publish.mockClear();
  (getAppEvents as jest.Mock).mockReturnValue({ publish });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useBlockConversionHandlers', () => {
  it('field-maps a root block and writes schema-valid guided data', () => {
    const source: JsonMultistepBlock = {
      type: 'multistep',
      id: 'root-step-group',
      content: 'Complete these steps',
      steps: [{ action: 'noop', tooltip: 'Preserve this root text' }],
    };
    const updateBlock = jest.fn();
    const closeBlockForm = jest.fn();
    const editor = makeEditor({ updateBlock });
    const formState = makeFormState({
      editingBlock: { id: 'root-step-group', block: source },
      closeBlockForm,
    });

    const { result } = renderHook(() => useBlockConversionHandlers({ editor, formState }));

    act(() => result.current.handleConvertType('guided'));

    expect(updateBlock).toHaveBeenCalledWith(
      'root-step-group',
      expect.objectContaining({
        type: 'guided',
        id: 'root-step-group',
        steps: [expect.objectContaining({ description: 'Preserve this root text', tooltip: undefined })],
      })
    );
    const convertedBlock = updateBlock.mock.calls[0][1];
    expect(JsonBlockSchema.safeParse(convertedBlock).success).toBe(true);
    expect(closeBlockForm).toHaveBeenCalledTimes(1);
  });

  it('field-maps a section-nested block and writes schema-valid multistep data', () => {
    const source: JsonGuidedBlock = {
      type: 'guided',
      id: 'nested-step-group',
      content: 'Follow these steps',
      steps: [{ action: 'noop', description: 'Preserve this nested text' }],
    };
    const updateNestedBlock = jest.fn();
    const closeBlockForm = jest.fn();
    const editor = makeEditor({ updateNestedBlock });
    const formState = makeFormState({
      editingNestedBlock: {
        sectionId: 'section-1',
        nestedIndex: 3,
        block: source,
      },
      closeBlockForm,
    });

    const { result } = renderHook(() => useBlockConversionHandlers({ editor, formState }));

    act(() => result.current.handleConvertType('multistep'));

    expect(updateNestedBlock).toHaveBeenCalledWith(
      'section-1',
      3,
      expect.objectContaining({
        type: 'multistep',
        id: 'nested-step-group',
        steps: [expect.objectContaining({ tooltip: 'Preserve this nested text', description: undefined })],
      })
    );
    const convertedBlock = updateNestedBlock.mock.calls[0][2];
    expect(JsonBlockSchema.safeParse(convertedBlock).success).toBe(true);
    expect(closeBlockForm).toHaveBeenCalledTimes(1);
  });

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
    const editor = makeEditor({ updateConditionalBranchBlock });
    const formState = makeFormState({
      editingConditionalBranchBlock: {
        conditionalId: 'conditional-1',
        branch: 'whenTrue',
        nestedIndex: 2,
        block: source,
      },
      closeBlockForm,
    });

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
    const editor = makeEditor({ updateConditionalBranchBlock });
    const formState = makeFormState({
      editingConditionalBranchBlock: {
        conditionalId: 'conditional-2',
        branch: 'whenFalse',
        nestedIndex: 1,
        block: source,
      },
      closeBlockForm,
    });

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

  it('notifies the user and keeps editor state unchanged when conversion validation fails', () => {
    const source: JsonMultistepBlock = {
      type: 'multistep',
      content: '',
      steps: [],
    };
    const updateConditionalBranchBlock = jest.fn();
    const closeBlockForm = jest.fn();
    const editor = makeEditor({ updateConditionalBranchBlock });
    const formState = makeFormState({
      editingConditionalBranchBlock: {
        conditionalId: 'conditional-invalid',
        branch: 'whenTrue',
        nestedIndex: 0,
        block: source,
      },
      closeBlockForm,
    });
    jest.spyOn(console, 'error').mockImplementation();

    const { result } = renderHook(() => useBlockConversionHandlers({ editor, formState }));

    expect(() => {
      act(() => result.current.handleConvertType('guided'));
    }).not.toThrow();
    expect(updateConditionalBranchBlock).not.toHaveBeenCalled();
    expect(closeBlockForm).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith({
      type: 'alert-error',
      payload: ['Conversion failed', 'Could not convert to the selected block type.'],
    });
  });
});
