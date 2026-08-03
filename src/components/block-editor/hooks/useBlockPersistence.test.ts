/**
 * Characterization / tripwire tests for useBlockPersistence.
 *
 * Pins behavior of the block-editor autosave/restore loop:
 *   - 1000 ms debounce on guide changes
 *   - flush() / unmount writes any pending draft immediately
 *   - per-guide-snapshot dedup via `lastGuideRef`
 *   - `autoSavePaused` / `autoSave: false` halt saves
 *   - mount-time `onLoad` receives both `guide` and `blockIds`
 *   - clear() contract
 */
import { act, renderHook } from '@testing-library/react';

import { StorageKeys } from '../../../lib/storage-keys';
import type { JsonGuide, JsonModeState } from '../types';
import { flushEditorDraft } from '../editor-tab-storage';

import { useBlockPersistence } from './useBlockPersistence';

const STORAGE_KEY = StorageKeys.BLOCK_EDITOR_STATE;

function guide(title = 'g'): JsonGuide {
  return {
    title,
    sections: [],
  } as unknown as JsonGuide;
}

beforeEach(() => {
  localStorage.clear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useBlockPersistence — debounced auto-save', () => {
  it('writes to localStorage exactly once after the 1000 ms debounce', () => {
    const { rerender } = renderHook(({ g }) => useBlockPersistence({ guide: g }), {
      initialProps: { g: guide('a') },
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    rerender({ g: guide('b') });
    rerender({ g: guide('c') });

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.guide.title).toBe('c');
    expect(stored.version).toBe(2);
  });

  it('does not write when autoSavePaused is true', () => {
    const { rerender } = renderHook(({ g, paused }) => useBlockPersistence({ guide: g, autoSavePaused: paused }), {
      initialProps: { g: guide('a'), paused: true },
    });

    rerender({ g: guide('b'), paused: true });

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('does not write when autoSave is false', () => {
    const { rerender } = renderHook(({ g }) => useBlockPersistence({ guide: g, autoSave: false }), {
      initialProps: { g: guide('a') },
    });

    rerender({ g: guide('b') });

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('fires onSave on the no-change branch when the serialized guide is unchanged', () => {
    const onSave = jest.fn();
    const { rerender } = renderHook(({ g }) => useBlockPersistence({ guide: g, onSave }), {
      initialProps: { g: guide('a') },
    });

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(onSave).toHaveBeenCalledTimes(1);

    rerender({ g: guide('a') });

    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it('stores blockIds alongside guide when provided', () => {
    const { rerender } = renderHook(
      ({ g, ids }: { g: JsonGuide; ids: string[] }) => useBlockPersistence({ guide: g, blockIds: ids }),
      { initialProps: { g: guide('a'), ids: ['b1', 'b2'] } }
    );

    rerender({ g: guide('b'), ids: ['b1', 'b2', 'b3'] });

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.blockIds).toEqual(['b1', 'b2', 'b3']);
  });

  it('flushes the latest pending guide when an editor tab unmounts', () => {
    const { rerender, unmount } = renderHook(({ g }) => useBlockPersistence({ guide: g }), {
      initialProps: { g: guide('a') },
    });

    rerender({ g: guide('latest-before-tab-switch') });
    unmount();

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.guide.title).toBe('latest-before-tab-switch');
  });

  it('flush() writes a pending draft immediately without waiting for the debounce', () => {
    const { result, rerender } = renderHook(({ g }) => useBlockPersistence({ guide: g }), {
      initialProps: { g: guide('a') },
    });

    rerender({ g: guide('ready-for-close-check') });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    act(() => {
      result.current.flush();
    });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.guide.title).toBe('ready-for-close-check');
  });

  it('flushEditorDraft runs the registered flusher for close-tab checks', () => {
    const { rerender } = renderHook(({ g }) => useBlockPersistence({ guide: g }), {
      initialProps: { g: guide('a') },
    });

    rerender({ g: guide('from-registry') });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    act(() => {
      flushEditorDraft(STORAGE_KEY);
    });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.guide.title).toBe('from-registry');
  });
});

describe('useBlockPersistence — mount-time restore via onLoad', () => {
  it('calls onLoad with stored guide AND blockIds when both are present', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        guide: guide('restored'),
        blockIds: ['b1', 'b2'],
        savedAt: new Date().toISOString(),
        version: 2,
      })
    );

    const onLoad = jest.fn();
    renderHook(() => useBlockPersistence({ guide: guide('current'), onLoad }));

    expect(onLoad).toHaveBeenCalledTimes(1);
    const [restoredGuide, restoredIds] = onLoad.mock.calls[0]!;
    expect(restoredGuide.title).toBe('restored');
    expect(restoredIds).toEqual(['b1', 'b2']);
  });

  it('restores the stored draft before a pending auto-save can overwrite it', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ guide: guide('restored'), savedAt: new Date().toISOString(), version: 2 })
    );

    const onLoad = jest.fn();
    renderHook(() => useBlockPersistence({ guide: guide('blank-initial'), onLoad }));

    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onLoad.mock.calls[0]![0].title).toBe('restored');

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.guide.title).toBe('restored');
  });

  it('does not call onLoad when storage is empty', () => {
    const onLoad = jest.fn();
    renderHook(() => useBlockPersistence({ guide: guide('current'), onLoad }));
    expect(onLoad).not.toHaveBeenCalled();
  });

  it('does not throw and skips onLoad when stored JSON is malformed', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    const onLoad = jest.fn();
    const errSpy = jest.spyOn(console, 'error').mockImplementation();

    expect(() => renderHook(() => useBlockPersistence({ guide: guide('current'), onLoad }))).not.toThrow();

    expect(onLoad).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('useBlockPersistence — clear()', () => {
  it('clear() removes the storage key, and a subsequent mount finds nothing to restore', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ guide: guide('a'), savedAt: '', version: 2 }));
    const { result } = renderHook(() => useBlockPersistence({ guide: guide('a') }));

    act(() => result.current.clear());

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    const onLoad = jest.fn();
    renderHook(() => useBlockPersistence({ guide: guide('current'), onLoad }));
    expect(onLoad).not.toHaveBeenCalled();
  });
});

describe('useBlockPersistence — viewMode persistence (pop out/dock handoff)', () => {
  it('persists viewMode immediately on change, without waiting for the guide debounce', () => {
    const { rerender } = renderHook(
      ({ vm }: { vm: 'edit' | 'preview' }) => useBlockPersistence({ guide: guide('a'), viewMode: vm }),
      { initialProps: { vm: 'edit' } }
    );

    rerender({ vm: 'preview' });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.viewMode).toBe('preview');
  });

  it('does not persist viewMode changes when autoSavePaused is true', () => {
    const { rerender } = renderHook(
      ({ vm }: { vm: 'edit' | 'preview' }) =>
        useBlockPersistence({ guide: guide('a'), viewMode: vm, autoSavePaused: true }),
      { initialProps: { vm: 'edit' } }
    );

    rerender({ vm: 'preview' });

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('does not persist viewMode changes when autoSave is false', () => {
    const { rerender } = renderHook(
      ({ vm }: { vm: 'edit' | 'preview' }) => useBlockPersistence({ guide: guide('a'), viewMode: vm, autoSave: false }),
      { initialProps: { vm: 'edit' } }
    );

    rerender({ vm: 'preview' });

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('restores viewMode via onLoad on mount', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        guide: guide('restored'),
        viewMode: 'preview',
        savedAt: new Date().toISOString(),
        version: 2,
      })
    );

    const onLoad = jest.fn();
    renderHook(() => useBlockPersistence({ guide: guide('current'), onLoad }));

    expect(onLoad).toHaveBeenCalledWith(expect.anything(), undefined, 'preview', undefined);
  });

  it('falls back to edit when stored viewMode is unrecognized', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        guide: guide('restored'),
        viewMode: 'nope',
        savedAt: new Date().toISOString(),
        version: 2,
      })
    );

    const onLoad = jest.fn();
    renderHook(() => useBlockPersistence({ guide: guide('current'), onLoad }));

    expect(onLoad).toHaveBeenCalledWith(expect.anything(), undefined, 'edit', undefined);
  });
});

describe('useBlockPersistence — jsonModeState persistence', () => {
  const draft: JsonModeState = {
    json: '{"id":"x"}',
    originalJson: '{"id":"x"}',
    originalBlockIds: ['b1'],
  };

  it('persists jsonModeState when viewMode is json', () => {
    const { rerender } = renderHook(
      ({ jm }: { jm: JsonModeState | null }) =>
        useBlockPersistence({ guide: guide('a'), viewMode: 'json', jsonModeState: jm }),
      { initialProps: { jm: null as JsonModeState | null } }
    );

    // Initial mount writes guide after debounce; viewMode effect may also write.
    // Change json draft while already in json mode — should persist immediately.
    rerender({ jm: draft });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.jsonModeState).toEqual(draft);
  });

  it('omits jsonModeState from storage when viewMode is not json', () => {
    renderHook(() => useBlockPersistence({ guide: guide('a'), viewMode: 'edit', jsonModeState: draft }));

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.jsonModeState).toBeUndefined();
  });

  it('restores jsonModeState via onLoad on mount', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        guide: guide('restored'),
        viewMode: 'json',
        jsonModeState: draft,
        savedAt: new Date().toISOString(),
        version: 2,
      })
    );

    const onLoad = jest.fn();
    renderHook(() => useBlockPersistence({ guide: guide('current'), onLoad }));

    expect(onLoad).toHaveBeenCalledWith(expect.anything(), undefined, 'json', draft);
  });

  it('skips jsonModeState restore when the stored shape is invalid', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        guide: guide('restored'),
        viewMode: 'json',
        jsonModeState: { json: 1 },
        savedAt: new Date().toISOString(),
        version: 2,
      })
    );

    const onLoad = jest.fn();
    renderHook(() => useBlockPersistence({ guide: guide('current'), onLoad }));

    expect(onLoad).toHaveBeenCalledWith(expect.anything(), undefined, 'json', undefined);
  });
});

describe('useBlockPersistence — custom storageKey', () => {
  it('honors a custom storageKey for save and mount-time onLoad restore', () => {
    const customKey = 'custom-block-editor-state';

    const { rerender } = renderHook(({ g }) => useBlockPersistence({ guide: g, storageKey: customKey }), {
      initialProps: { g: guide('a') },
    });

    rerender({ g: guide('b') });

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(localStorage.getItem(customKey)).not.toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    const onLoad = jest.fn();
    renderHook(() => useBlockPersistence({ guide: guide('current'), onLoad, storageKey: customKey }));
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onLoad.mock.calls[0]![0].title).toBe('b');
  });
});
