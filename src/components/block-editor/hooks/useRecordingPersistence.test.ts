/**
 * Characterization / tripwire tests for useRecordingPersistence.
 *
 * Pins behavior of the recording state persistence hook before any
 * refactor that routes it through `UserStorage`:
 *   - save() no-ops when not recording
 *   - save() writes serialized state when actively recording
 *   - mount-time restore fires `onRestore` exactly once (Strict Mode safe)
 *   - clear() removes the key
 *   - load() handles malformed JSON without throwing
 */
import { renderHook, act } from '@testing-library/react';

import { StorageKeys } from '../../../lib/storage-keys';
import type { RecordedStep } from '../../../utils/devtools/tutorial-exporter';

import { useRecordingPersistence, PersistedRecordingState } from './useRecordingPersistence';

const STORAGE_KEY = StorageKeys.BLOCK_EDITOR_RECORDING_STATE;

function defaultOpts(overrides: Partial<Parameters<typeof useRecordingPersistence>[0]> = {}) {
  return {
    recordingIntoSection: null,
    recordingIntoConditionalBranch: null,
    recordingStartUrl: null,
    recordedSteps: [] as RecordedStep[],
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('useRecordingPersistence — save()', () => {
  it('no-ops when not recording (section + branch both null)', () => {
    const { result } = renderHook(() => useRecordingPersistence(defaultOpts()));
    act(() => result.current.save());
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('writes serialized state when recordingIntoSection is set', () => {
    const { result } = renderHook(() =>
      useRecordingPersistence(
        defaultOpts({
          recordingIntoSection: 'section-1',
          recordingStartUrl: '/d/test',
          recordedSteps: [{ id: 's1' } as unknown as RecordedStep],
        })
      )
    );
    act(() => result.current.save());

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();

    const parsed = JSON.parse(raw!) as PersistedRecordingState;
    expect(parsed.recordingIntoSection).toBe('section-1');
    expect(parsed.recordingStartUrl).toBe('/d/test');
    expect(parsed.recordedSteps).toHaveLength(1);
    expect(typeof parsed.savedAt).toBe('string');
  });

  it('writes when only recordingIntoConditionalBranch is set', () => {
    const { result } = renderHook(() =>
      useRecordingPersistence(
        defaultOpts({
          recordingIntoConditionalBranch: { conditionalId: 'c1', branch: 'whenTrue' },
        })
      )
    );
    act(() => result.current.save());

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as PersistedRecordingState;
    expect(parsed.recordingIntoConditionalBranch).toEqual({
      conditionalId: 'c1',
      branch: 'whenTrue',
    });
  });

  it('auto-saves when recording state changes via rerender', () => {
    const { rerender } = renderHook((props) => useRecordingPersistence(props), {
      initialProps: defaultOpts({ recordingIntoSection: 'section-1' }),
    });

    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    rerender(
      defaultOpts({
        recordingIntoSection: 'section-1',
        recordedSteps: [{ id: 'newstep' } as unknown as RecordedStep],
      })
    );

    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as PersistedRecordingState;
    expect(parsed.recordedSteps).toHaveLength(1);
  });
});

describe('useRecordingPersistence — restore on mount', () => {
  it('calls onRestore with persisted state when storage has content', () => {
    const persisted: PersistedRecordingState = {
      recordingIntoSection: 'section-2',
      recordingIntoConditionalBranch: null,
      recordingStartUrl: '/d/x',
      recordedSteps: [],
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));

    const onRestore = jest.fn();
    renderHook(() => useRecordingPersistence(defaultOpts({ onRestore })));

    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore.mock.calls[0]![0]!.recordingIntoSection).toBe('section-2');
  });

  it('does not call onRestore when storage is empty', () => {
    const onRestore = jest.fn();
    renderHook(() => useRecordingPersistence(defaultOpts({ onRestore })));
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('hasRestoredRef gate prevents double restore on rerender', () => {
    const persisted: PersistedRecordingState = {
      recordingIntoSection: 'section-2',
      recordingIntoConditionalBranch: null,
      recordingStartUrl: null,
      recordedSteps: [],
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));

    const onRestore = jest.fn();
    const { rerender } = renderHook((props) => useRecordingPersistence(props), {
      initialProps: defaultOpts({ onRestore }),
    });

    rerender(defaultOpts({ onRestore, recordingIntoSection: 'section-2' }));
    rerender(defaultOpts({ onRestore, recordingIntoSection: 'section-3' }));

    expect(onRestore).toHaveBeenCalledTimes(1);
  });
});

describe('useRecordingPersistence — clear / load / hasPersistedState', () => {
  it('hasPersistedState reflects key presence', () => {
    const { result } = renderHook(() => useRecordingPersistence(defaultOpts()));
    expect(result.current.hasPersistedState()).toBe(false);

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        recordingIntoSection: null,
        recordingIntoConditionalBranch: null,
        recordingStartUrl: null,
        recordedSteps: [],
        savedAt: '',
      })
    );
    expect(result.current.hasPersistedState()).toBe(true);
  });

  it('load() returns null for empty storage and parsed state when present', () => {
    const { result } = renderHook(() => useRecordingPersistence(defaultOpts()));
    expect(result.current.load()).toBeNull();

    const persisted: PersistedRecordingState = {
      recordingIntoSection: 'sec',
      recordingIntoConditionalBranch: null,
      recordingStartUrl: null,
      recordedSteps: [],
      savedAt: 'now',
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));

    expect(result.current.load()?.recordingIntoSection).toBe('sec');
  });

  it('load() returns null without throwing on malformed JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    const errSpy = jest.spyOn(console, 'error').mockImplementation();

    const { result } = renderHook(() => useRecordingPersistence(defaultOpts()));
    expect(result.current.load()).toBeNull();

    errSpy.mockRestore();
  });

  it('clear() removes the key', () => {
    localStorage.setItem(STORAGE_KEY, '{}');
    const { result } = renderHook(() => useRecordingPersistence(defaultOpts()));

    act(() => result.current.clear());

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
