/**
 * Characterization / tripwire tests for useBlockPersistence.
 *
 * Pins behavior of the block-editor autosave/restore loop before any
 * refactor that routes it through `UserStorage`:
 *   - 1000 ms debounce on guide changes
 *   - per-guide-snapshot dedup via `lastGuideRef`
 *   - `autoSavePaused` halts saves but preserves the persisted snapshot
 *   - mount-time `onLoad` receives both `guide` and `blockIds`
 *   - clear() contract
 */
import { act, renderHook } from '@testing-library/react';

import { StorageKeys } from '../../../lib/storage-keys';
import type { JsonGuide, JsonModeState } from '../types';

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

    // No advanceTimersByTime — the viewMode-change effect must save synchronously.
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

  it('passes the stored viewMode through to onLoad on mount', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        guide: guide('restored'),
        blockIds: ['b1'],
        viewMode: 'preview',
        savedAt: new Date().toISOString(),
        version: 2,
      })
    );

    const onLoad = jest.fn();
    renderHook(() => useBlockPersistence({ guide: guide('current'), onLoad }));

    expect(onLoad).toHaveBeenCalledTimes(1);
    const [, , restoredViewMode] = onLoad.mock.calls[0]!;
    expect(restoredViewMode).toBe('preview');
  });

  it('onLoad receives undefined viewMode for older stored guides that predate this field', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        guide: guide('restored'),
        blockIds: ['b1'],
        savedAt: new Date().toISOString(),
        version: 2,
      })
    );

    const onLoad = jest.fn();
    renderHook(() => useBlockPersistence({ guide: guide('current'), onLoad }));

    const [, , restoredViewMode] = onLoad.mock.calls[0]!;
    expect(restoredViewMode).toBeUndefined();
  });

  it('defaults invalid stored viewMode values to edit', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        guide: guide('restored'),
        viewMode: 'invalid',
        savedAt: new Date().toISOString(),
        version: 2,
      })
    );

    const onLoad = jest.fn();
    renderHook(() => useBlockPersistence({ guide: guide('current'), onLoad }));

    expect(onLoad).toHaveBeenCalledWith(expect.anything(), undefined, 'edit', undefined);
  });
});

describe('useBlockPersistence — JSON draft persistence', () => {
  const originalJson = JSON.stringify(guide('original'), null, 2);
  const jsonModeState: JsonModeState = {
    json: '{ invalid',
    originalBlockIds: ['b1'],
    originalJson,
  };

  it('persists JSON draft changes immediately', () => {
    const { rerender } = renderHook(
      ({ draft }: { draft: JsonModeState | null }) =>
        useBlockPersistence({ guide: guide('original'), viewMode: 'json', jsonModeState: draft }),
      { initialProps: { draft: null as JsonModeState | null } }
    );

    rerender({ draft: jsonModeState });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.jsonModeState).toEqual(jsonModeState);
  });

  it('restores the exact persisted JSON draft', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        guide: guide('original'),
        viewMode: 'json',
        jsonModeState,
        savedAt: new Date().toISOString(),
        version: 2,
      })
    );

    const onLoad = jest.fn();
    renderHook(() => useBlockPersistence({ guide: guide('current'), onLoad }));

    expect(onLoad).toHaveBeenCalledWith(expect.anything(), undefined, 'json', jsonModeState);
  });

  it.each(['edit', 'preview'] as const)('does not persist a dormant JSON draft in %s mode', (viewMode) => {
    const { rerender } = renderHook(
      ({ mode }: { mode: 'json' | 'edit' | 'preview' }) =>
        useBlockPersistence({
          guide: guide('replacement'),
          viewMode: mode,
          jsonModeState,
        }),
      { initialProps: { mode: 'json' as 'json' | 'edit' | 'preview' } }
    );

    rerender({ mode: viewMode });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.viewMode).toBe(viewMode);
    expect(stored.jsonModeState).toBeUndefined();
  });

  it.each([
    ['non-string json', { ...jsonModeState, json: 5 }],
    ['non-string originalJson', { ...jsonModeState, originalJson: false }],
    ['non-array originalBlockIds', { ...jsonModeState, originalBlockIds: 'b1' }],
    ['non-string originalBlockIds entry', { ...jsonModeState, originalBlockIds: ['b1', 2] }],
  ])('rejects a persisted JSON draft with %s', (_description, malformedState) => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        guide: guide('original'),
        viewMode: 'json',
        jsonModeState: malformedState,
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
