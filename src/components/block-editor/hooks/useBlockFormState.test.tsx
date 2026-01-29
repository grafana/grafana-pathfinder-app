import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { useBlockFormState } from './useBlockFormState';
import { BlockEditorContextProvider } from '../BlockEditorContext';

// Wrapper to provide context
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <BlockEditorContextProvider>{children}</BlockEditorContextProvider>
);

describe('useBlockFormState', () => {
  it('starts with form closed', () => {
    const { result } = renderHook(() => useBlockFormState(), { wrapper });

    expect(result.current.isBlockFormOpen).toBe(false);
    expect(result.current.editingBlockType).toBeNull();
    expect(result.current.editingBlock).toBeNull();
    expect(result.current.insertAtIndex).toBeUndefined();
    expect(result.current.editingNestedBlock).toBeNull();
    expect(result.current.editingConditionalBranchBlock).toBeNull();
  });

  describe('root-level blocks', () => {
    it('opens form for new block', () => {
      const { result } = renderHook(() => useBlockFormState(), { wrapper });

      act(() => {
        result.current.openNewBlockForm('markdown', 2);
      });

      expect(result.current.isBlockFormOpen).toBe(true);
      expect(result.current.editingBlockType).toBe('markdown');
      expect(result.current.editingBlock).toBeNull();
      expect(result.current.insertAtIndex).toBe(2);
      expect(result.current.editingNestedBlock).toBeNull();
      expect(result.current.editingConditionalBranchBlock).toBeNull();
    });

    it('opens form for new block without index', () => {
      const { result } = renderHook(() => useBlockFormState(), { wrapper });

      act(() => {
        result.current.openNewBlockForm('section');
      });

      expect(result.current.isBlockFormOpen).toBe(true);
      expect(result.current.editingBlockType).toBe('section');
      expect(result.current.insertAtIndex).toBeUndefined();
    });

    it('opens form for editing existing block', () => {
      const { result } = renderHook(() => useBlockFormState(), { wrapper });
      const block = {
        id: 'block-1',
        block: { type: 'markdown' as const, content: 'test content' },
      };

      act(() => {
        result.current.openEditBlockForm(block);
      });

      expect(result.current.isBlockFormOpen).toBe(true);
      expect(result.current.editingBlockType).toBe('markdown');
      expect(result.current.editingBlock).toBe(block);
      expect(result.current.insertAtIndex).toBeUndefined();
    });
  });

  describe('nested blocks in sections', () => {
    it('opens form for new nested block', () => {
      const { result } = renderHook(() => useBlockFormState(), { wrapper });

      act(() => {
        result.current.openNestedBlockForm('interactive', 'section-1', 0);
      });

      expect(result.current.isBlockFormOpen).toBe(true);
      expect(result.current.editingBlockType).toBe('interactive');
      expect(result.current.editingBlock).toBeNull();
      expect(result.current.editingNestedBlock).toBeNull();
      expect(result.current.editingConditionalBranchBlock).toBeNull();
    });

    it('opens form for editing nested block', () => {
      const { result } = renderHook(() => useBlockFormState(), { wrapper });
      const block = {
        type: 'interactive' as const,
        action: 'click' as const,
        reftarget: '[data-testid="btn"]',
        content: 'Click the button',
      };

      act(() => {
        result.current.openEditNestedBlockForm('section-1', 2, block);
      });

      expect(result.current.isBlockFormOpen).toBe(true);
      expect(result.current.editingBlockType).toBe('interactive');
      expect(result.current.editingNestedBlock).toEqual({
        sectionId: 'section-1',
        nestedIndex: 2,
        block,
      });
      expect(result.current.editingConditionalBranchBlock).toBeNull();
    });

    it('clears nested block state when opening root block form', () => {
      const { result } = renderHook(() => useBlockFormState(), { wrapper });
      const nestedBlock = {
        type: 'markdown' as const,
        content: 'nested',
      };

      // First open a nested block form
      act(() => {
        result.current.openEditNestedBlockForm('section-1', 0, nestedBlock);
      });
      expect(result.current.editingNestedBlock).not.toBeNull();

      // Then open a root level form
      act(() => {
        result.current.openNewBlockForm('section');
      });

      expect(result.current.editingNestedBlock).toBeNull();
      expect(result.current.editingBlockType).toBe('section');
    });
  });

  describe('conditional branch blocks', () => {
    it('opens form for new conditional block', () => {
      const { result } = renderHook(() => useBlockFormState(), { wrapper });

      act(() => {
        result.current.openConditionalBlockForm('markdown', 'cond-1', 'whenTrue', 0);
      });

      expect(result.current.isBlockFormOpen).toBe(true);
      expect(result.current.editingBlockType).toBe('markdown');
      expect(result.current.editingConditionalBranchBlock).toBeNull();
      expect(result.current.editingNestedBlock).toBeNull();
    });

    it('opens form for editing whenTrue branch block', () => {
      const { result } = renderHook(() => useBlockFormState(), { wrapper });
      const block = { type: 'markdown' as const, content: 'test content' };

      act(() => {
        result.current.openEditConditionalBlockForm('cond-1', 'whenTrue', 1, block);
      });

      expect(result.current.isBlockFormOpen).toBe(true);
      expect(result.current.editingBlockType).toBe('markdown');
      expect(result.current.editingConditionalBranchBlock).toEqual({
        conditionalId: 'cond-1',
        branch: 'whenTrue',
        nestedIndex: 1,
        block,
      });
    });

    it('opens form for editing whenFalse branch block', () => {
      const { result } = renderHook(() => useBlockFormState(), { wrapper });
      const block = { type: 'html' as const, content: '<p>test</p>' };

      act(() => {
        result.current.openEditConditionalBlockForm('cond-2', 'whenFalse', 3, block);
      });

      expect(result.current.editingConditionalBranchBlock).toEqual({
        conditionalId: 'cond-2',
        branch: 'whenFalse',
        nestedIndex: 3,
        block,
      });
    });
  });

  describe('closeBlockForm', () => {
    it('closes form and clears all state', () => {
      const { result } = renderHook(() => useBlockFormState(), { wrapper });

      // Open a form first
      act(() => {
        result.current.openNewBlockForm('section', 5);
      });
      expect(result.current.isBlockFormOpen).toBe(true);

      // Close it
      act(() => {
        result.current.closeBlockForm();
      });

      expect(result.current.isBlockFormOpen).toBe(false);
      expect(result.current.editingBlockType).toBeNull();
      expect(result.current.editingBlock).toBeNull();
      expect(result.current.insertAtIndex).toBeUndefined();
      expect(result.current.editingNestedBlock).toBeNull();
      expect(result.current.editingConditionalBranchBlock).toBeNull();
    });

    it('clears nested block state when closing', () => {
      const { result } = renderHook(() => useBlockFormState(), { wrapper });
      const block = { type: 'markdown' as const, content: 'test' };

      act(() => {
        result.current.openEditNestedBlockForm('section-1', 0, block);
      });
      expect(result.current.editingNestedBlock).not.toBeNull();

      act(() => {
        result.current.closeBlockForm();
      });
      expect(result.current.editingNestedBlock).toBeNull();
    });

    it('clears conditional branch state when closing', () => {
      const { result } = renderHook(() => useBlockFormState(), { wrapper });
      const block = { type: 'markdown' as const, content: 'test' };

      act(() => {
        result.current.openEditConditionalBlockForm('cond-1', 'whenTrue', 0, block);
      });
      expect(result.current.editingConditionalBranchBlock).not.toBeNull();

      act(() => {
        result.current.closeBlockForm();
      });
      expect(result.current.editingConditionalBranchBlock).toBeNull();
    });
  });

  describe('setters for type switching', () => {
    it('allows setting editing block type directly', () => {
      const { result } = renderHook(() => useBlockFormState(), { wrapper });
      const block = {
        id: 'block-1',
        block: { type: 'markdown' as const, content: 'test' },
      };

      act(() => {
        result.current.openEditBlockForm(block);
      });
      expect(result.current.editingBlockType).toBe('markdown');

      act(() => {
        result.current.setEditingBlockType('html');
      });
      expect(result.current.editingBlockType).toBe('html');
    });

    it('allows updating editing block', () => {
      const { result } = renderHook(() => useBlockFormState(), { wrapper });
      const block = {
        id: 'block-1',
        block: { type: 'markdown' as const, content: 'test' },
      };

      act(() => {
        result.current.openEditBlockForm(block);
      });

      const updatedBlock = {
        id: 'block-1',
        block: { type: 'html' as const, content: '<p>converted</p>' },
      };

      act(() => {
        result.current.setEditingBlock(updatedBlock);
      });

      expect(result.current.editingBlock).toBe(updatedBlock);
    });

    it('allows updating nested block state', () => {
      const { result } = renderHook(() => useBlockFormState(), { wrapper });
      const block = { type: 'markdown' as const, content: 'original' };

      act(() => {
        result.current.openEditNestedBlockForm('section-1', 0, block);
      });

      const updatedState = {
        sectionId: 'section-1',
        nestedIndex: 0,
        block: { type: 'html' as const, content: '<p>converted</p>' },
      };

      act(() => {
        result.current.setEditingNestedBlock(updatedState);
      });

      expect(result.current.editingNestedBlock).toEqual(updatedState);
    });

    it('allows updating conditional branch block state', () => {
      const { result } = renderHook(() => useBlockFormState(), { wrapper });
      const block = { type: 'markdown' as const, content: 'original' };

      act(() => {
        result.current.openEditConditionalBlockForm('cond-1', 'whenTrue', 0, block);
      });

      const updatedState = {
        conditionalId: 'cond-1',
        branch: 'whenTrue' as const,
        nestedIndex: 0,
        block: { type: 'html' as const, content: '<p>converted</p>' },
      };

      act(() => {
        result.current.setEditingConditionalBranchBlock(updatedState);
      });

      expect(result.current.editingConditionalBranchBlock).toEqual(updatedState);
    });
  });

  describe('works without context provider', () => {
    it('provides fallback values without throwing', () => {
      // Render without wrapper to test fallback behavior
      const { result } = renderHook(() => useBlockFormState());

      expect(result.current.isBlockFormOpen).toBe(false);

      // Actions should work without throwing
      act(() => {
        result.current.openNewBlockForm('markdown', 0);
      });

      expect(result.current.isBlockFormOpen).toBe(true);
      expect(result.current.editingBlockType).toBe('markdown');

      act(() => {
        result.current.closeBlockForm();
      });

      expect(result.current.isBlockFormOpen).toBe(false);
    });
  });
});
