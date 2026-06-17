/**
 * Characterization / tripwire tests for useBlockPersistence.
 *
 * Pins behavior of the block-editor autosave/restore loop before any
 * refactor that routes it through `UserStorage`:
 *   - 1000 ms debounce on guide changes
 *   - per-guide-snapshot dedup via `lastGuideRef`
 *   - `autoSavePaused` halts saves but preserves the persisted snapshot
 *   - mount-time `onLoad` receives both `guide` and `blockIds`
 *   - version mismatch logs a warning but still returns the parsed guide
 *   - clear / hasSavedGuide / getLastSaveTime contracts
 */
import { act, renderHook } from '@testing-library/react';

import { StorageKeys } from '../../../lib/storage-keys';
import type { JsonGuide } from '../types';

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

    // No write yet (initial guide ≠ lastGuideRef but timer hasn't fired).
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    rerender({ g: guide('b') });
    rerender({ g: guide('c') });

    // Still no write until debounce elapses.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.guide.title).toBe('c');
    expect(stored.version).toBe(2);
  });

  it('does not write when autoSavePaused is true', () => {
    const { rerender } = renderHook(
      ({ g, paused }) => useBlockPersistence({ guide: g, autoSavePaused: paused }),
      { initialProps: { g: guide('a'), paused: true } }
    );

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
    // First save() flush calls onSave once and pins lastGuideRef to the serialized guide.
    expect(onSave).toHaveBeenCalledTimes(1);

    // New object identity, identical content — the effect re-runs, hits the
    // no-change branch, and must still notify onSave so callers can clear isDirty.
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

  it('does not call onLoad when storage is empty', () => {
    const onLoad = jest.fn();
    renderHook(() => useBlockPersistence({ guide: guide('current'), onLoad }));
    expect(onLoad).not.toHaveBeenCalled();
  });

  it('does not throw and skips onLoad when stored JSON is malformed', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    const onLoad = jest.fn();
    const errSpy = jest.spyOn(console, 'error').mockImplementation();

    expect(() =>
      renderHook(() => useBlockPersistence({ guide: guide('current'), onLoad }))
    ).not.toThrow();

    expect(onLoad).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('useBlockPersistence — load() / clear() / hasSavedGuide / getLastSaveTime', () => {
  it('load() returns null when storage is empty', () => {
    const { result } = renderHook(() => useBlockPersistence({ guide: guide('a') }));
    expect(result.current.load()).toBeNull();
  });

  it('load() returns the parsed guide and warns on version mismatch', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        guide: guide('legacy'),
        savedAt: new Date().toISOString(),
        version: 1, // mismatch
      })
    );

    const { result } = renderHook(() => useBlockPersistence({ guide: guide('a') }));
    const loaded = result.current.load();

    expect(loaded?.title).toBe('legacy');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('version mismatch'));
    warnSpy.mockRestore();
  });

  it('clear() removes the storage key', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ guide: guide('a'), savedAt: '', version: 2 }));
    const { result } = renderHook(() => useBlockPersistence({ guide: guide('a') }));

    act(() => result.current.clear());

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('hasSavedGuide() reflects key presence', () => {
    const { result } = renderHook(() => useBlockPersistence({ guide: guide('a') }));
    expect(result.current.hasSavedGuide()).toBe(false);

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ guide: guide('a'), savedAt: '', version: 2 }));
    expect(result.current.hasSavedGuide()).toBe(true);
  });

  it('getLastSaveTime() returns a Date when present, null when absent', () => {
    const { result } = renderHook(() => useBlockPersistence({ guide: guide('a') }));
    expect(result.current.getLastSaveTime()).toBeNull();

    const ts = '2024-01-02T03:04:05.000Z';
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ guide: guide('a'), savedAt: ts, version: 2 })
    );

    const t = result.current.getLastSaveTime();
    expect(t).toBeInstanceOf(Date);
    expect(t!.toISOString()).toBe(ts);
  });
});

describe('useBlockPersistence — custom storageKey', () => {
  it('honors a custom storageKey for save / load', () => {
    const customKey = 'custom-block-editor-state';

    const { result, rerender } = renderHook(
      ({ g }) => useBlockPersistence({ guide: g, storageKey: customKey }),
      { initialProps: { g: guide('a') } }
    );

    rerender({ g: guide('b') });

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(localStorage.getItem(customKey)).not.toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(result.current.load()?.title).toBe('b');
  });
});
