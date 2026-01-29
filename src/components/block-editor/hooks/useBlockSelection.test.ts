/**
 * Tests for useBlockSelection hook
 */

import { renderHook, act } from '@testing-library/react';
import { useBlockSelection } from './useBlockSelection';

describe('useBlockSelection', () => {
  it('starts with selection mode off and empty selection', () => {
    const { result } = renderHook(() => useBlockSelection());

    expect(result.current.isSelectionMode).toBe(false);
    expect(result.current.selectedBlockIds.size).toBe(0);
  });

  it('toggles selection mode on', () => {
    const { result } = renderHook(() => useBlockSelection());

    act(() => {
      result.current.toggleSelectionMode();
    });

    expect(result.current.isSelectionMode).toBe(true);
  });

  it('toggles selection mode off', () => {
    const { result } = renderHook(() => useBlockSelection());

    act(() => {
      result.current.toggleSelectionMode();
    });
    expect(result.current.isSelectionMode).toBe(true);

    act(() => {
      result.current.toggleSelectionMode();
    });
    expect(result.current.isSelectionMode).toBe(false);
  });

  it('clears selection when exiting selection mode', () => {
    const { result } = renderHook(() => useBlockSelection());

    // Enter selection mode and select some blocks
    act(() => {
      result.current.toggleSelectionMode();
      result.current.toggleBlockSelection('block-1');
      result.current.toggleBlockSelection('block-2');
    });
    expect(result.current.selectedBlockIds.size).toBe(2);

    // Exit selection mode
    act(() => {
      result.current.toggleSelectionMode();
    });

    expect(result.current.isSelectionMode).toBe(false);
    expect(result.current.selectedBlockIds.size).toBe(0);
  });

  it('toggles individual block selection on', () => {
    const { result } = renderHook(() => useBlockSelection());

    act(() => {
      result.current.toggleBlockSelection('block-1');
    });
    expect(result.current.selectedBlockIds.has('block-1')).toBe(true);
  });

  it('toggles individual block selection off', () => {
    const { result } = renderHook(() => useBlockSelection());

    act(() => {
      result.current.toggleBlockSelection('block-1');
    });
    expect(result.current.selectedBlockIds.has('block-1')).toBe(true);

    act(() => {
      result.current.toggleBlockSelection('block-1');
    });
    expect(result.current.selectedBlockIds.has('block-1')).toBe(false);
  });

  it('selects multiple blocks', () => {
    const { result } = renderHook(() => useBlockSelection());

    act(() => {
      result.current.toggleBlockSelection('block-1');
      result.current.toggleBlockSelection('block-2');
      result.current.toggleBlockSelection('block-3');
    });

    expect(result.current.selectedBlockIds.size).toBe(3);
    expect(result.current.selectedBlockIds.has('block-1')).toBe(true);
    expect(result.current.selectedBlockIds.has('block-2')).toBe(true);
    expect(result.current.selectedBlockIds.has('block-3')).toBe(true);
  });

  it('clears selection explicitly', () => {
    const { result } = renderHook(() => useBlockSelection());

    act(() => {
      result.current.toggleSelectionMode();
      result.current.toggleBlockSelection('block-1');
      result.current.toggleBlockSelection('block-2');
    });

    act(() => {
      result.current.clearSelection();
    });

    expect(result.current.selectedBlockIds.size).toBe(0);
    expect(result.current.isSelectionMode).toBe(false);
  });

  it('selectBlock adds a block to selection', () => {
    const { result } = renderHook(() => useBlockSelection());

    act(() => {
      result.current.selectBlock('block-1');
    });

    expect(result.current.selectedBlockIds.has('block-1')).toBe(true);
  });

  it('selectBlock does not add duplicates', () => {
    const { result } = renderHook(() => useBlockSelection());

    act(() => {
      result.current.selectBlock('block-1');
      result.current.selectBlock('block-1');
    });

    expect(result.current.selectedBlockIds.size).toBe(1);
  });

  it('deselectBlock removes a block from selection', () => {
    const { result } = renderHook(() => useBlockSelection());

    act(() => {
      result.current.selectBlock('block-1');
      result.current.selectBlock('block-2');
    });

    act(() => {
      result.current.deselectBlock('block-1');
    });

    expect(result.current.selectedBlockIds.has('block-1')).toBe(false);
    expect(result.current.selectedBlockIds.has('block-2')).toBe(true);
  });

  it('deselectBlock is a no-op for non-selected blocks', () => {
    const { result } = renderHook(() => useBlockSelection());

    act(() => {
      result.current.selectBlock('block-1');
    });

    act(() => {
      result.current.deselectBlock('block-nonexistent');
    });

    expect(result.current.selectedBlockIds.size).toBe(1);
    expect(result.current.selectedBlockIds.has('block-1')).toBe(true);
  });
});
