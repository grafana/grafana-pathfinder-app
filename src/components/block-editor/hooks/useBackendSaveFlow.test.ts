/**
 * Tests for useBackendSaveFlow — the block editor's backend draft/publish/unpublish
 * orchestration: resource-name tracking, overwrite-conflict confirmation, status
 * derivation, backend refreshes, notifications, and error handling.
 */
import { act, renderHook } from '@testing-library/react';
import { getAppEvents } from '@grafana/runtime';

import { StorageKeys } from '../../../lib/storage-keys';
import type { JsonGuide } from '../types';

import {
  useBackendSaveFlow,
  type BackendSaveFlowGuideEntry,
  type BackendSaveFlowGuidesInterface,
} from './useBackendSaveFlow';

jest.mock('@grafana/runtime', () => ({ getAppEvents: jest.fn() }));

const STORAGE_KEY = StorageKeys.BLOCK_EDITOR_BACKEND_TRACKING;
const publish = jest.fn();

beforeEach(() => {
  localStorage.clear();
  publish.mockClear();
  (getAppEvents as jest.Mock).mockReturnValue({ publish });
});

function guide(overrides: Partial<JsonGuide> = {}): JsonGuide {
  return {
    id: 'g1',
    title: 'Guide one',
    blocks: [{ id: 'b1', type: 'markdown', content: 'hi' }],
    ...overrides,
  } as unknown as JsonGuide;
}

function makeGuideEntry(
  name: string,
  title: string,
  status: 'draft' | 'published' = 'draft'
): BackendSaveFlowGuideEntry {
  return { metadata: { name }, spec: { title, status } };
}

function makeBackendGuides(overrides: Partial<BackendSaveFlowGuidesInterface> = {}): BackendSaveFlowGuidesInterface {
  return {
    guides: [],
    saveGuide: jest.fn().mockResolvedValue(undefined),
    refreshGuides: jest.fn().mockResolvedValue([]),
    unpublishGuide: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('useBackendSaveFlow — initial state', () => {
  it('starts as not-saved with no persisted tracking', () => {
    const editor = { getGuide: () => guide() };
    const { result } = renderHook(() => useBackendSaveFlow({ editor, backendGuides: makeBackendGuides() }));

    expect(result.current.currentGuideResourceName).toBeNull();
    expect(result.current.publishedStatus).toBe('not-saved');
    expect(result.current.hasUnsyncedChanges).toBe(false);
  });

  it('restores resourceName and lastPublishedJson from localStorage on mount', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ resourceName: 'g1', backendStatus: 'draft', lastPublishedJson: '{"a":1}' })
    );
    const editor = { getGuide: () => guide() };
    const backendGuides = makeBackendGuides({ guides: [makeGuideEntry('g1', 'Guide one', 'draft')] });

    const { result } = renderHook(() => useBackendSaveFlow({ editor, backendGuides }));

    expect(result.current.currentGuideResourceName).toBe('g1');
    expect(result.current.publishedStatus).toBe('draft');
    expect(result.current.lastPublishedJson).toBe('{"a":1}');
  });
});

describe('useBackendSaveFlow — performSaveDraft', () => {
  it('saves a new guide as draft, tracks the resource name, and notifies success', async () => {
    const g = guide();
    const editor = { getGuide: () => g };
    const backendGuides = makeBackendGuides({
      refreshGuides: jest.fn().mockResolvedValue([makeGuideEntry('g1', 'Guide one', 'draft')]),
    });

    const { result } = renderHook(() => useBackendSaveFlow({ editor, backendGuides }));

    await act(async () => {
      await result.current.performSaveDraft();
    });

    expect(backendGuides.saveGuide).toHaveBeenCalledWith(g, undefined, undefined, 'draft');
    expect(result.current.currentGuideResourceName).toBe('g1');
    expect(result.current.lastPublishedJson).toBe(JSON.stringify(g));
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'alert-success', payload: ['Guide saved as draft.'] })
    );
  });

  it('rejects an empty guide without calling saveGuide', async () => {
    const editor = { getGuide: () => guide({ blocks: [] }) };
    const backendGuides = makeBackendGuides();
    const { result } = renderHook(() => useBackendSaveFlow({ editor, backendGuides }));

    await act(async () => {
      await result.current.performSaveDraft();
    });

    expect(backendGuides.saveGuide).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'alert-error',
        payload: ['Cannot save guide', 'Add at least one block before saving.'],
      })
    );
  });

  it('notifies an error and does not throw when saveGuide rejects', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation();
    const editor = { getGuide: () => guide() };
    const backendGuides = makeBackendGuides({ saveGuide: jest.fn().mockRejectedValue(new Error('network down')) });
    const { result } = renderHook(() => useBackendSaveFlow({ editor, backendGuides }));

    await act(async () => {
      await result.current.performSaveDraft();
    });

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'alert-error', payload: ['Save failed', 'network down'] })
    );
    expect(result.current.currentGuideResourceName).toBeNull();
    errSpy.mockRestore();
  });
});

describe('useBackendSaveFlow — handlePostToBackend', () => {
  it('publishes a new guide and marks it published', async () => {
    const g = guide();
    const editor = { getGuide: () => g };
    const backendGuides = makeBackendGuides();
    // Mirrors the real useBackendGuides hook, whose `guides` state updates as a
    // side effect of refreshGuides() — publishedStatus is derived from `guides`.
    backendGuides.refreshGuides = jest.fn().mockImplementation(async () => {
      backendGuides.guides = [makeGuideEntry('g1', 'Guide one', 'published')];
      return backendGuides.guides;
    });
    const { result } = renderHook(() => useBackendSaveFlow({ editor, backendGuides }));

    await act(async () => {
      await result.current.handlePostToBackend();
    });

    expect(backendGuides.saveGuide).toHaveBeenCalledWith(g, undefined, undefined, 'published');
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ payload: ['Guide published.'] }));
    expect(result.current.publishedStatus).toBe('published');
  });
});

describe('useBackendSaveFlow — overwrite conflict', () => {
  it('opens the confirm modal, and confirming saves over the existing guide', async () => {
    const g = guide({ id: 'existing-guide', title: 'Existing guide' });
    const editor = { getGuide: () => g };
    const backendGuides = makeBackendGuides({
      guides: [makeGuideEntry('existing-guide', 'Existing guide (old)', 'draft')],
      refreshGuides: jest.fn().mockResolvedValue([makeGuideEntry('existing-guide', 'Existing guide', 'draft')]),
    });
    const { result } = renderHook(() => useBackendSaveFlow({ editor, backendGuides }));

    let savePromise!: Promise<void>;
    act(() => {
      savePromise = result.current.performSaveDraft();
    });

    expect(result.current.confirmModal.isOpen).toBe(true);
    expect(result.current.confirmModal.resourceName).toBe('existing-guide');
    expect(result.current.confirmModal.existingTitle).toBe('Existing guide (old)');
    expect(backendGuides.saveGuide).not.toHaveBeenCalled();

    await act(async () => {
      result.current.confirmModal.onConfirm();
      await savePromise;
    });

    expect(backendGuides.saveGuide).toHaveBeenCalledWith(g, 'existing-guide', { name: 'existing-guide' }, 'draft');
    expect(result.current.confirmModal.isOpen).toBe(false);
    expect(result.current.currentGuideResourceName).toBe('existing-guide');
  });

  it('cancelling the conflict prompt does not save', async () => {
    const g = guide({ id: 'existing-guide', title: 'Existing guide' });
    const editor = { getGuide: () => g };
    const backendGuides = makeBackendGuides({
      guides: [makeGuideEntry('existing-guide', 'Existing guide (old)', 'draft')],
    });
    const { result } = renderHook(() => useBackendSaveFlow({ editor, backendGuides }));

    let savePromise!: Promise<void>;
    act(() => {
      savePromise = result.current.performSaveDraft();
    });
    expect(result.current.confirmModal.isOpen).toBe(true);

    await act(async () => {
      result.current.closeConfirmModal();
      // Flush the deferred onCancel resolve() scheduled via setTimeout(0).
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await savePromise;

    expect(result.current.confirmModal.isOpen).toBe(false);
    expect(backendGuides.saveGuide).not.toHaveBeenCalled();
  });
});

describe('useBackendSaveFlow — performUnpublish', () => {
  it('unpublishes a published guide back to draft and preserves lastPublishedJson', async () => {
    const g = guide();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ resourceName: 'g1', backendStatus: 'published', lastPublishedJson: JSON.stringify(g) })
    );
    const editor = { getGuide: () => g };
    const backendGuides = makeBackendGuides({
      guides: [makeGuideEntry('g1', 'Guide one', 'published')],
      refreshGuides: jest.fn().mockResolvedValue([makeGuideEntry('g1', 'Guide one', 'draft')]),
    });
    const { result } = renderHook(() => useBackendSaveFlow({ editor, backendGuides }));

    await act(async () => {
      await result.current.performUnpublish();
    });

    expect(backendGuides.unpublishGuide).toHaveBeenCalledWith('g1', { name: 'g1' });
    expect(result.current.lastPublishedJson).toBe(JSON.stringify(g));
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ payload: ['Guide unpublished.'] }));
  });

  it('is a no-op when there is no tracked guide', async () => {
    const editor = { getGuide: () => guide() };
    const backendGuides = makeBackendGuides();
    const { result } = renderHook(() => useBackendSaveFlow({ editor, backendGuides }));

    await act(async () => {
      await result.current.performUnpublish();
    });

    expect(backendGuides.unpublishGuide).not.toHaveBeenCalled();
  });

  it('notifies an error and does not throw when unpublishGuide rejects', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ resourceName: 'g1', backendStatus: 'published', lastPublishedJson: null })
    );
    const editor = { getGuide: () => guide() };
    const backendGuides = makeBackendGuides({
      guides: [makeGuideEntry('g1', 'Guide one', 'published')],
      unpublishGuide: jest.fn().mockRejectedValue(new Error('boom')),
    });
    const { result } = renderHook(() => useBackendSaveFlow({ editor, backendGuides }));

    await act(async () => {
      await result.current.performUnpublish();
    });

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'alert-error', payload: ['Unpublish failed', 'boom'] })
    );
    errSpy.mockRestore();
  });
});

describe('useBackendSaveFlow — trackLoadedGuide / handleClearBackendTracking', () => {
  it('trackLoadedGuide sets resourceName and a normalized lastPublishedJson', () => {
    const editor = { getGuide: () => guide() };
    const { result } = renderHook(() => useBackendSaveFlow({ editor, backendGuides: makeBackendGuides() }));

    const loaded = guide({ id: 'loaded-guide', title: 'Loaded' });
    act(() => {
      result.current.trackLoadedGuide(loaded, 'loaded-guide');
    });

    expect(result.current.currentGuideResourceName).toBe('loaded-guide');
    expect(result.current.lastPublishedJson).toBe(
      JSON.stringify({ id: loaded.id, title: loaded.title, blocks: loaded.blocks })
    );
  });

  it('handleClearBackendTracking resets tracking to not-saved and clears localStorage', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ resourceName: 'g1', backendStatus: 'draft', lastPublishedJson: '{}' })
    );
    const editor = { getGuide: () => guide() };
    const backendGuides = makeBackendGuides({ guides: [makeGuideEntry('g1', 'Guide one', 'draft')] });
    const { result } = renderHook(() => useBackendSaveFlow({ editor, backendGuides }));

    expect(result.current.publishedStatus).toBe('draft');

    act(() => {
      result.current.handleClearBackendTracking();
    });

    expect(result.current.publishedStatus).toBe('not-saved');
    expect(result.current.currentGuideResourceName).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('useBackendSaveFlow — hasUnsyncedChanges', () => {
  it('is true once tracked content diverges from the last backend save', () => {
    const savedGuide = guide();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ resourceName: 'g1', backendStatus: 'draft', lastPublishedJson: JSON.stringify(savedGuide) })
    );
    const backendGuides = makeBackendGuides({ guides: [makeGuideEntry('g1', 'Guide one', 'draft')] });

    let currentGuide = savedGuide;
    const editor = { getGuide: () => currentGuide };
    const { result, rerender } = renderHook(() => useBackendSaveFlow({ editor, backendGuides }));

    expect(result.current.hasUnsyncedChanges).toBe(false);

    currentGuide = guide({ title: 'Changed title' });
    rerender();

    expect(result.current.hasUnsyncedChanges).toBe(true);
  });
});
