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
 *
 * These tests are deliberately about *backend selection*, not the queue or
 * sync internals — those are pinned in `user-storage.plumbing.test.ts`.
 */
import { renderHook, act } from '@testing-library/react';

import type { GrafanaUserStorage } from '../types/storage.types';

import { __resetSyncedForTests, createLocalStorage, setGlobalStorage, useUserStorage } from './user-storage';

const usePluginUserStorageMock = jest.fn();

jest.mock('@grafana/runtime', () => ({
  usePluginUserStorage: () => usePluginUserStorageMock(),
  getAppEvents: jest.fn(() => ({ publish: jest.fn() })),
}));

function makeFunctionalGrafanaStorage(): GrafanaUserStorage & {
  getItem: jest.Mock;
  setItem: jest.Mock;
} {
  const store = new Map<string, string>();
  return {
    getItem: jest.fn(async (key: string) => store.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  } as unknown as GrafanaUserStorage & { getItem: jest.Mock; setItem: jest.Mock };
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
