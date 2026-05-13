/**
 * Tests for the undo/redo ring buffer that backs the visual-mode editor.
 *
 * Covers the three behaviours that drive the rest of the wave:
 *  - Plain push/undo/redo flow.
 *  - Skip-history opt-out for UI-only mutations (view-mode, save-ack).
 *  - Coalescing of consecutive same-key edits into one history entry.
 *  - Count cap (`MAX_HISTORY`) — older entries are dropped.
 */

import { act, renderHook } from '@testing-library/react';
import { useGuideHistory, MAX_HISTORY, COALESCE_MS } from './useGuideHistory';
import type { BlockEditorState } from '../types';

function makeState(overrides?: Partial<BlockEditorState>): BlockEditorState {
  return {
    guide: { id: 'g', title: 't' },
    blocks: [],
    viewMode: 'edit',
    isDirty: false,
    ...overrides,
  };
}

describe('useGuideHistory', () => {
  it('starts with empty stacks', () => {
    const { result } = renderHook(() => useGuideHistory(makeState()));
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.undoLabel).toBeNull();
    expect(result.current.redoLabel).toBeNull();
  });

  it('pushes the previous state to past on every default setState', () => {
    const { result } = renderHook(() => useGuideHistory(makeState({ guide: { id: 'g', title: 'a' } })));

    act(() => {
      result.current.setState((prev) => ({ ...prev, guide: { ...prev.guide, title: 'b' } }));
    });

    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.state.guide.title).toBe('b');
  });

  it('undo restores the previous state and exposes redo', () => {
    const { result } = renderHook(() => useGuideHistory(makeState({ guide: { id: 'g', title: 'a' } })));

    act(() => {
      result.current.setState((prev) => ({ ...prev, guide: { ...prev.guide, title: 'b' } }));
    });
    act(() => {
      result.current.undo();
    });

    expect(result.current.state.guide.title).toBe('a');
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);

    act(() => {
      result.current.redo();
    });
    expect(result.current.state.guide.title).toBe('b');
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it('a fresh setState after undo clears the redo stack', () => {
    const { result } = renderHook(() => useGuideHistory(makeState({ guide: { id: 'g', title: 'a' } })));
    act(() => result.current.setState((p) => ({ ...p, guide: { ...p.guide, title: 'b' } })));
    act(() => result.current.undo());
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.setState((p) => ({ ...p, guide: { ...p.guide, title: 'c' } })));
    expect(result.current.canRedo).toBe(false);
    expect(result.current.state.guide.title).toBe('c');
  });

  it('skipHistory: true bypasses the past stack entirely', () => {
    const { result } = renderHook(() => useGuideHistory(makeState({ viewMode: 'edit' })));

    act(() => {
      result.current.setState((prev) => ({ ...prev, viewMode: 'preview' }), { skipHistory: true });
    });

    expect(result.current.canUndo).toBe(false);
    expect(result.current.state.viewMode).toBe('preview');
  });

  it('coalesces consecutive same-key edits into a single history entry', () => {
    const { result } = renderHook(() => useGuideHistory(makeState({ guide: { id: 'g', title: 'a' } })));

    act(() => {
      result.current.setState((p) => ({ ...p, guide: { ...p.guide, title: 'ab' } }), {
        coalesceKey: 'inlineEdit:title',
      });
    });
    act(() => {
      result.current.setState((p) => ({ ...p, guide: { ...p.guide, title: 'abc' } }), {
        coalesceKey: 'inlineEdit:title',
      });
    });
    act(() => {
      result.current.setState((p) => ({ ...p, guide: { ...p.guide, title: 'abcd' } }), {
        coalesceKey: 'inlineEdit:title',
      });
    });

    // Single undo lands on the original 'a', not 'abc'.
    expect(result.current.state.guide.title).toBe('abcd');
    act(() => result.current.undo());
    expect(result.current.state.guide.title).toBe('a');
    expect(result.current.canUndo).toBe(false);
  });

  it('different coalesceKeys do not merge', () => {
    const { result } = renderHook(() => useGuideHistory(makeState({ guide: { id: 'g', title: 'a' } })));

    act(() => {
      result.current.setState((p) => ({ ...p, guide: { ...p.guide, title: 'b' } }), {
        coalesceKey: 'inlineEdit:title',
      });
    });
    act(() => {
      result.current.setState((p) => ({ ...p, guide: { ...p.guide, title: 'b', id: 'g2' } }), {
        coalesceKey: 'inlineEdit:id',
      });
    });

    // Two distinct entries — undo twice to get back to start.
    act(() => result.current.undo());
    expect(result.current.state.guide.id).toBe('g');
    act(() => result.current.undo());
    expect(result.current.state.guide.title).toBe('a');
  });

  it('coalesce window expires after COALESCE_MS', () => {
    jest.useFakeTimers();
    try {
      const { result } = renderHook(() => useGuideHistory(makeState({ guide: { id: 'g', title: 'a' } })));

      act(() => {
        result.current.setState((p) => ({ ...p, guide: { ...p.guide, title: 'b' } }), { coalesceKey: 'k' });
      });
      // Advance past the coalesce window — the next push must start a fresh entry.
      act(() => {
        jest.advanceTimersByTime(COALESCE_MS + 50);
      });
      act(() => {
        result.current.setState((p) => ({ ...p, guide: { ...p.guide, title: 'c' } }), { coalesceKey: 'k' });
      });

      // Two entries — undo twice to get back to 'a'.
      act(() => result.current.undo());
      expect(result.current.state.guide.title).toBe('b');
      act(() => result.current.undo());
      expect(result.current.state.guide.title).toBe('a');
    } finally {
      jest.useRealTimers();
    }
  });

  it('drops the oldest entry when count exceeds MAX_HISTORY', () => {
    const { result } = renderHook(() => useGuideHistory(makeState({ guide: { id: 'g', title: '0' } })));

    for (let i = 1; i <= MAX_HISTORY + 5; i++) {
      act(() => {
        result.current.setState((p) => ({ ...p, guide: { ...p.guide, title: String(i) } }));
      });
    }

    // Undo as many times as possible — should land on the oldest *kept*
    // entry, which corresponds to title '5' (the original '0' through
    // '4' were trimmed when count exceeded MAX_HISTORY).
    while (result.current.canUndo) {
      act(() => result.current.undo());
    }
    expect(result.current.state.guide.title).toBe('5');
  });

  it('resetHistory clears both stacks (used after loadGuide / resetGuide)', () => {
    const { result } = renderHook(() => useGuideHistory(makeState({ guide: { id: 'g', title: 'a' } })));

    act(() => result.current.setState((p) => ({ ...p, guide: { ...p.guide, title: 'b' } })));
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.resetHistory());
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it('exposes labels on undo/redo for tooltip use', () => {
    const { result } = renderHook(() => useGuideHistory(makeState()));

    act(() => {
      result.current.setState((p) => ({ ...p, isDirty: true }), { label: 'Add block' });
    });
    expect(result.current.undoLabel).toBe('Add block');

    act(() => result.current.undo());
    expect(result.current.redoLabel).toBe('Add block');
  });

  it('no-op transitions (same reference) skip history', () => {
    const { result } = renderHook(() => useGuideHistory(makeState()));

    act(() => {
      result.current.setState((prev) => prev); // identity update
    });

    expect(result.current.canUndo).toBe(false);
  });
});
