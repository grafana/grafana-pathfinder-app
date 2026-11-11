/**
 * Characterization / tripwire tests for the `useUserStorage` React hook.
 *
 * The hook is the bridge that wires the React-managed storage backend into the
 * module-scoped `globalStorageInstance` used by all non-React storage helpers.
 * It is a load-bearing seam: every named storage domain
 * (`tabStorage`, `journeyCompletionStorage`, `learningProgressStorage`, …)
 * calls `createUserStorage()` which falls through to `createLocalStorage()`
 * unless this hook has set the global. These tests pin:
 *
 *   - When Grafana's `usePluginUserStorage` returns a functional object,
 *     the hook installs hybrid storage globally and triggers the initial
 *     `syncFromGrafanaStorage` reconciliation.
 *   - When Grafana storage is unavailable (null) or non-functional (missing
 *     `getItem`), the hook falls back to localStorage and still installs
 *     a global, so standalone helpers never see an uninitialized state.
 *   - The hook's returned object exposes a stable `UserStorage` shape; calls
 *     route to the underlying installed backend.
 *   - Mounting runs the discard of progress records in the superseded key
 *     shape, exactly once per page lifecycle. That single call is the only
 *     thing that makes the discard happen for a real reader, so it is pinned
 *     here rather than only at `sweepDiscardedProgressRecords` itself.
 *
 * These tests are deliberately about *backend selection*, not the queue or
 * sync internals — those are pinned in `user-storage.plumbing.test.ts`.
 */
import { renderHook, act } from '@testing-library/react';

import type { GrafanaUserStorage } from '../types/storage.types';

import {
  __resetSyncedForTests,
  createLocalStorage,
  guideCompletionMarkStorage,
  guideResponseStorage,
  interactiveCompletionStorage,
  interactiveStepStorage,
  journeyCompletionStorage,
  learningProgressStorage,
  sectionAcknowledgementStorage,
  sectionDoneStorage,
  setGlobalStorage,
  tabStorage,
  useUserStorage,
} from './user-storage';
import {
  StorageKeys,
  buildDiscardedSectionStorageKey,
  buildVersionedContentStorageKey,
  buildVersionedSectionStorageKey,
} from './storage-keys';

const usePluginUserStorageMock = jest.fn();

jest.mock('@grafana/runtime', () => ({
  usePluginUserStorage: () => usePluginUserStorageMock(),
  getAppEvents: jest.fn(() => ({ publish: jest.fn() })),
}));

function makeFunctionalGrafanaStorage(): GrafanaUserStorage & {
  store: Map<string, string>;
  getItem: jest.Mock;
  setItem: jest.Mock;
} {
  const store = new Map<string, string>();
  return {
    store,
    getItem: jest.fn(async (key: string) => store.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  } as unknown as GrafanaUserStorage & { store: Map<string, string>; getItem: jest.Mock; setItem: jest.Mock };
}

async function flushMicrotasks(times = 12): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  localStorage.clear();
  usePluginUserStorageMock.mockReset();
  __resetSyncedForTests();
  // Reset the module-level global between tests by re-installing a
  // throwaway localStorage backend. The hook tests that need a clean slate
  // observe via behavior, not by inspecting the singleton.
  setGlobalStorage(createLocalStorage());
});

describe('useUserStorage — backend selection', () => {
  it('selects hybrid storage when Grafana storage is functional, and the global picks up writes', async () => {
    const grafana = makeFunctionalGrafanaStorage();
    usePluginUserStorageMock.mockReturnValue(grafana);

    const { result } = renderHook(() => useUserStorage());

    // Let the mount effect run so setGlobalStorage and the async sync fire.
    await act(async () => {
      await Promise.resolve();
    });

    // The hook's setItem should write through to localStorage immediately
    // (hybrid backend) — this is the observable signature of hybrid vs raw.
    await act(async () => {
      await result.current.setItem('hook-test-key', { value: 42 });
    });

    expect(localStorage.getItem('hook-test-key')).not.toBeNull();
    // The Grafana side is async + debounced; we only assert it was wired up,
    // not that it has flushed.
    expect(grafana.getItem).toHaveBeenCalled();
  });

  it('falls back to localStorage when usePluginUserStorage returns null', async () => {
    usePluginUserStorageMock.mockReturnValue(null);

    const { result } = renderHook(() => useUserStorage());
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.setItem('hook-fallback-null', { ok: true });
    });

    expect(localStorage.getItem('hook-fallback-null')).not.toBeNull();
  });

  it('falls back to localStorage when usePluginUserStorage returns an object without getItem', async () => {
    usePluginUserStorageMock.mockReturnValue({ setItem: jest.fn() } as unknown);

    const { result } = renderHook(() => useUserStorage());
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.setItem('hook-fallback-shape', { ok: true });
    });

    expect(localStorage.getItem('hook-fallback-shape')).not.toBeNull();
  });

  it('returns a stable UserStorage shape with getItem/setItem/removeItem/clear', () => {
    usePluginUserStorageMock.mockReturnValue(null);

    const { result } = renderHook(() => useUserStorage());

    expect(typeof result.current.getItem).toBe('function');
    expect(typeof result.current.setItem).toBe('function');
    expect(typeof result.current.removeItem).toBe('function');
    expect(typeof result.current.clear).toBe('function');
  });
});

describe('useUserStorage — global-storage bridge', () => {
  it('the global picks up the React-selected backend so non-React helpers see hybrid writes', async () => {
    const grafana = makeFunctionalGrafanaStorage();
    usePluginUserStorageMock.mockReturnValue(grafana);

    renderHook(() => useUserStorage());
    await act(async () => {
      await Promise.resolve();
    });

    const { createUserStorage } = await import('./user-storage');
    const standalone = createUserStorage();
    await standalone.setItem('standalone-key', { from: 'non-react' });

    // Hybrid writes localStorage synchronously.
    expect(localStorage.getItem('standalone-key')).not.toBeNull();
  });
});

describe('useUserStorage — legacy mirror boundary', () => {
  const CONTENT_KEY = 'api:characterization-guide';
  const SECTION_ID = 'configure';

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('mirrors live domain writes broadly, then restores only the five compatibility records', async () => {
    const grafana = makeFunctionalGrafanaStorage();
    usePluginUserStorageMock.mockReturnValue(grafana);

    const firstMount = renderHook(() => useUserStorage());
    await act(flushMicrotasks);
    grafana.setItem.mockClear();

    await act(async () => {
      await tabStorage.setTabs([{ id: 'tab-1' }]);
      await tabStorage.setActiveTab('tab-1');
      await learningProgressStorage.update({ completedGuides: ['guide-1'] });
      await guideResponseStorage.setResponse('guide-1', 'region', 'us-east');
      await journeyCompletionStorage.set('journey-1', 40);
      await interactiveCompletionStorage.set(CONTENT_KEY, 75);
      await interactiveStepStorage.setCompleted(CONTENT_KEY, SECTION_ID, new Set(['step-1']));
      await sectionAcknowledgementStorage.set(CONTENT_KEY, SECTION_ID, true);
      await sectionDoneStorage.set(CONTENT_KEY, SECTION_ID, true);
      await guideCompletionMarkStorage.set(CONTENT_KEY, true);
    });

    expect(grafana.setItem).not.toHaveBeenCalled();
    expect(await tabStorage.getTabs()).toEqual([{ id: 'tab-1' }]);
    expect(await interactiveCompletionStorage.get(CONTENT_KEY)).toBe(75);
    expect(await sectionDoneStorage.get(CONTENT_KEY, SECTION_ID)).toBe(true);

    await jest.advanceTimersByTimeAsync(500);

    const sectionStepKey = buildVersionedSectionStorageKey(
      StorageKeys.INTERACTIVE_STEPS_PREFIX,
      CONTENT_KEY,
      SECTION_ID
    );
    const sectionAcknowledgedKey = buildVersionedSectionStorageKey(
      StorageKeys.SECTION_ACKNOWLEDGED_PREFIX,
      CONTENT_KEY,
      SECTION_ID
    );
    const sectionDoneKey = buildVersionedSectionStorageKey(StorageKeys.SECTION_DONE_PREFIX, CONTENT_KEY, SECTION_ID);
    const guideMarkKey = buildVersionedContentStorageKey(StorageKeys.GUIDE_COMPLETION_MARK_PREFIX, CONTENT_KEY);
    const currentMirroredKeys = [
      StorageKeys.TABS,
      StorageKeys.ACTIVE_TAB,
      StorageKeys.LEARNING_PROGRESS,
      StorageKeys.GUIDE_RESPONSES,
      StorageKeys.JOURNEY_COMPLETION,
      StorageKeys.INTERACTIVE_COMPLETION,
      sectionStepKey,
      sectionAcknowledgedKey,
      sectionDoneKey,
      guideMarkKey,
    ];
    expect(grafana.setItem.mock.calls.map(([key]) => key)).toEqual(currentMirroredKeys);
    expect([...grafana.store.keys()]).toEqual(currentMirroredKeys);

    firstMount.unmount();
    localStorage.clear();
    __resetSyncedForTests();
    renderHook(() => useUserStorage());
    await act(flushMicrotasks);

    expect(await tabStorage.getTabs()).toEqual([{ id: 'tab-1' }]);
    expect(await tabStorage.getActiveTab()).toBe('tab-1');
    expect((await learningProgressStorage.get()).completedGuides).toEqual(['guide-1']);
    expect(await guideResponseStorage.getResponse('guide-1', 'region')).toBe('us-east');
    expect(await journeyCompletionStorage.get('journey-1')).toBe(40);
    expect(await interactiveCompletionStorage.get(CONTENT_KEY)).toBe(0);
    expect(await interactiveStepStorage.getCompleted(CONTENT_KEY, SECTION_ID)).toEqual(new Set());
    expect(await sectionAcknowledgementStorage.get(CONTENT_KEY, SECTION_ID)).toBeNull();
    expect(await sectionDoneStorage.get(CONTENT_KEY, SECTION_ID)).toBeNull();
    expect(await guideCompletionMarkStorage.get(CONTENT_KEY)).toBeNull();
  });
});

describe('useUserStorage — operations route to the installed backend', () => {
  it('removeItem clears the localStorage entry', async () => {
    usePluginUserStorageMock.mockReturnValue(null);
    localStorage.setItem('to-remove', JSON.stringify({ v: 1 }));

    const { result } = renderHook(() => useUserStorage());
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.removeItem('to-remove');
    });

    expect(localStorage.getItem('to-remove')).toBeNull();
  });
});

describe('useUserStorage — discards progress records in the superseded key shape', () => {
  const GUIDE = 'bundled:welcome-to-grafana';
  const NEIGHBOUR = 'bundled:welcome-to-grafana-cloud';
  const SECTION = 'section-1';

  function discarded(prefix: string, contentKey: string): string {
    return buildDiscardedSectionStorageKey(prefix, contentKey, SECTION);
  }

  async function mountHook(): Promise<void> {
    usePluginUserStorageMock.mockReturnValue(null);
    renderHook(() => useUserStorage());
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('removes every superseded-shape record and marker on mount', async () => {
    const supersededKeys = [
      discarded(StorageKeys.INTERACTIVE_STEPS_PREFIX, GUIDE),
      discarded(StorageKeys.SECTION_COLLAPSE_PREFIX, GUIDE),
      discarded(StorageKeys.SECTION_ACKNOWLEDGED_PREFIX, NEIGHBOUR),
      discarded(StorageKeys.SECTION_DONE_PREFIX, NEIGHBOUR),
      `${StorageKeys.CONTENT_PROGRESS_V2_PREFIX}${GUIDE}`,
    ];
    supersededKeys.forEach((key) => localStorage.setItem(key, JSON.stringify(['step-1'])));

    await mountHook();

    supersededKeys.forEach((key) => expect(localStorage.getItem(key)).toBeNull());
  });

  it('leaves current-shape progress and unrelated plugin state alone', async () => {
    const currentKey = buildVersionedSectionStorageKey(StorageKeys.INTERACTIVE_STEPS_PREFIX, GUIDE, SECTION);
    localStorage.setItem(currentKey, JSON.stringify(['step-1']));
    localStorage.setItem(StorageKeys.LEARNING_PROGRESS, JSON.stringify({ earnedBadges: [{ id: 'b' }], streakDays: 7 }));
    localStorage.setItem(discarded(StorageKeys.INTERACTIVE_STEPS_PREFIX, NEIGHBOUR), JSON.stringify(['cloud-1']));

    await mountHook();

    expect(JSON.parse(localStorage.getItem(currentKey)!)).toEqual(['step-1']);
    expect(JSON.parse(localStorage.getItem(StorageKeys.LEARNING_PROGRESS)!)).toEqual({
      earnedBadges: [{ id: 'b' }],
      streakDays: 7,
    });
    expect(localStorage.getItem(discarded(StorageKeys.INTERACTIVE_STEPS_PREFIX, NEIGHBOUR))).toBeNull();
  });

  it('sweeps once per page lifecycle, however many times the hook mounts', async () => {
    localStorage.setItem(discarded(StorageKeys.INTERACTIVE_STEPS_PREFIX, GUIDE), JSON.stringify(['step-1']));

    await mountHook();

    expect(localStorage.getItem(discarded(StorageKeys.INTERACTIVE_STEPS_PREFIX, GUIDE))).toBeNull();

    const later = discarded(StorageKeys.SECTION_DONE_PREFIX, NEIGHBOUR);
    localStorage.setItem(later, JSON.stringify(true));

    await mountHook();

    expect(localStorage.getItem(later)).toBe(JSON.stringify(true));

    __resetSyncedForTests();
    await mountHook();

    expect(localStorage.getItem(later)).toBeNull();
  });
});
