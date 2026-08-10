/**
 * Integration test: paste a fresh JSON guide in JSON mode, switch to
 * preview, and assert the editor's state actually reflects the new
 * guide (not the previous one).
 *
 * Wires the real `useBlockEditor` (which sits on top of the real
 * `useGuideHistory` ring buffer) into the real `useJsonModeHandlers`,
 * because the bug only manifests when batched setState calls flow
 * through the wrapped `setState`.
 */

import { act, renderHook } from '@testing-library/react';
import { useBlockEditor } from './useBlockEditor';
import { useJsonModeHandlers } from './useJsonModeHandlers';
import type { JsonGuide } from '../types';

const oldGuide: JsonGuide = {
  id: 'old-guide',
  title: 'Old guide',
  blocks: [{ type: 'markdown', content: 'old block content' }],
};

const newGuide: JsonGuide = {
  id: 'new-guide',
  title: 'New guide',
  blocks: [{ type: 'markdown', content: 'brand new block content' }],
};

function useEditorAndJsonMode(
  initialGuide: JsonGuide,
  idChangeHandlers: Pick<Parameters<typeof useJsonModeHandlers>[0], 'onBeforeGuideIdChange' | 'onGuideIdChanged'> = {}
) {
  const editor = useBlockEditor({ initialGuide });
  const jsonMode = useJsonModeHandlers({
    editor,
    recordingIntoSection: null,
    recordingIntoConditionalBranch: null,
    onStopRecording: () => {},
    onClearSelection: () => {},
    isSelectionMode: false,
    ...idChangeHandlers,
  });
  return { editor, jsonMode };
}

describe('useJsonModeHandlers — JSON paste then preview', () => {
  it('switching from JSON to preview applies the pasted guide (regression)', () => {
    const { result } = renderHook(() => useEditorAndJsonMode(oldGuide));

    // Enter JSON mode — captures the current guide as the JSON snapshot.
    act(() => {
      result.current.jsonMode.handleViewModeChange('json');
    });
    expect(result.current.editor.state.viewMode).toBe('json');

    // Simulate the user pasting a completely new guide JSON.
    act(() => {
      result.current.jsonMode.handleJsonChange(JSON.stringify(newGuide, null, 2));
    });
    expect(result.current.jsonMode.isJsonValid).toBe(true);

    // Switch to preview — must apply the new guide, not revert to the old one.
    act(() => {
      result.current.jsonMode.handleViewModeChange('preview');
    });

    expect(result.current.editor.state.viewMode).toBe('preview');
    expect(result.current.editor.state.guide).toEqual({ id: 'new-guide', title: 'New guide' });
    expect(result.current.editor.state.blocks).toHaveLength(1);
    expect(result.current.editor.state.blocks[0]!.block).toEqual({
      type: 'markdown',
      content: 'brand new block content',
    });
    // `handleExitJsonMode` marks the editor dirty after a JSON edit.
    expect(result.current.editor.state.isDirty).toBe(true);
  });

  it('keeps JSON mode open when a guide ID change is rejected', () => {
    const onGuideIdChanged = jest.fn();
    const { result } = renderHook(() =>
      useEditorAndJsonMode(oldGuide, {
        onBeforeGuideIdChange: () => false,
        onGuideIdChanged,
      })
    );

    act(() => {
      result.current.jsonMode.handleViewModeChange('json');
    });
    act(() => {
      result.current.jsonMode.handleJsonChange(JSON.stringify(newGuide));
    });
    act(() => result.current.jsonMode.handleViewModeChange('preview'));

    expect(result.current.editor.state.viewMode).toBe('json');
    expect(result.current.editor.state.guide.id).toBe('old-guide');
    expect(onGuideIdChanged).not.toHaveBeenCalled();
  });

  it('waits for approval before applying and reporting a guide ID change', async () => {
    let approve!: (approved: boolean) => void;
    const onGuideIdChanged = jest.fn();
    const { result } = renderHook(() =>
      useEditorAndJsonMode(oldGuide, {
        onBeforeGuideIdChange: () => new Promise<boolean>((resolve) => (approve = resolve)),
        onGuideIdChanged,
      })
    );

    act(() => {
      result.current.jsonMode.handleViewModeChange('json');
    });
    act(() => {
      result.current.jsonMode.handleJsonChange(JSON.stringify(newGuide));
    });
    act(() => result.current.jsonMode.handleViewModeChange('preview'));

    expect(result.current.editor.state.viewMode).toBe('json');
    expect(result.current.editor.state.guide.id).toBe('old-guide');

    await act(async () => approve(true));

    expect(result.current.editor.state.viewMode).toBe('preview');
    expect(result.current.editor.state.guide.id).toBe('new-guide');
    expect(onGuideIdChanged).toHaveBeenCalledWith('old-guide', 'new-guide');
  });
});

describe('useJsonModeHandlers — restoreJsonMode', () => {
  it('seeds jsonModeState from the given guide so the JSON pane has something to render', () => {
    const { result } = renderHook(() => useEditorAndJsonMode(oldGuide));

    expect(result.current.jsonMode.jsonModeState).toBeNull();

    act(() => {
      result.current.jsonMode.restoreJsonMode(newGuide, ['b1']);
    });

    expect(result.current.jsonMode.jsonModeState).toEqual({
      json: JSON.stringify(newGuide, null, 2),
      originalBlockIds: ['b1'],
      originalJson: JSON.stringify(newGuide, null, 2),
    });
    expect(result.current.jsonMode.isJsonValid).toBe(true);
  });

  it('defaults originalBlockIds to an empty array when blockIds are omitted', () => {
    const { result } = renderHook(() => useEditorAndJsonMode(oldGuide));

    act(() => {
      result.current.jsonMode.restoreJsonMode(newGuide);
    });

    expect(result.current.jsonMode.jsonModeState?.originalBlockIds).toEqual([]);
  });

  it('restores an invalid persisted draft and derives its validation state', () => {
    const { result } = renderHook(() => useEditorAndJsonMode(oldGuide));
    const savedState = {
      json: '{ invalid',
      originalBlockIds: ['b1'],
      originalJson: JSON.stringify(newGuide, null, 2),
    };

    act(() => {
      result.current.jsonMode.restoreJsonMode(newGuide, ['b1'], savedState);
    });

    expect(result.current.jsonMode.jsonModeState).toEqual(savedState);
    expect(result.current.jsonMode.isJsonValid).toBe(false);
    expect(result.current.jsonMode.jsonValidationErrors).not.toHaveLength(0);
    expect(result.current.jsonMode.canUndo).toBe(true);

    act(() => {
      result.current.jsonMode.handleJsonUndo();
    });

    expect(result.current.jsonMode.jsonModeState?.json).toBe(savedState.originalJson);
    expect(result.current.jsonMode.isJsonValid).toBe(true);
  });
});
