/**
 * Tests for useBackendSaveFlow — the block editor's backend draft/publish/unpublish
 * orchestration: resource-name tracking, overwrite-conflict confirmation, status
 * derivation, single reads of the tracked guide, notifications, and error handling.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
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

/** `stored` is the server: readGuide serves a fresh copy from it, as a real read would, so a test can change it between reads. */
function makeBackendGuides(
  stored: BackendSaveFlowGuideEntry[] = [],
  overrides: Partial<BackendSaveFlowGuidesInterface> = {}
): BackendSaveFlowGuidesInterface {
  return {
    saveGuide: jest.fn().mockResolvedValue(undefined),
    readGuide: jest.fn(async (name: string) => {
      const found = stored.find((entry) => entry.metadata.name === name);
      return found && JSON.parse(JSON.stringify(found));
    }),
    unpublishGuide: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const flushReads = () => act(async () => {});

describe('useBackendSaveFlow — initial state', () => {
  it('starts as not-saved with no persisted tracking', () => {
    const editor = { getGuide: () => guide() };
    const { result } = renderHook(() => useBackendSaveFlow({ editor, backendGuides: makeBackendGuides() }));

    expect(result.current.currentGuideResourceName).toBeNull();
    expect(result.current.publishedStatus).toBe('not-saved');
    expect(result.current.hasUnsyncedChanges).toBe(false);
  });

  it('restores resourceName and lastPublishedJson from localStorage on mount', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ resourceName: 'g1', backendStatus: 'draft', lastPublishedJson: '{"a":1}' })
    );
    const editor = { getGuide: () => guide() };
    const backendGuides = makeBackendGuides([makeGuideEntry('g1', 'Guide one', 'draft')]);

    const { result } = renderHook(() => useBackendSaveFlow({ editor, backendGuides }));
    await flushReads();

    expect(result.current.currentGuideResourceName).toBe('g1');
    expect(result.current.publishedStatus).toBe('draft');
    expect(result.current.lastPublishedJson).toBe('{"a":1}');
    expect(backendGuides.readGuide).toHaveBeenCalledWith('g1');
  });

  it('shows a tracked guide as published from its single read, with no list to find it in', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ resourceName: 'g1', lastPublishedJson: null }));
    const backendGuides = makeBackendGuides([makeGuideEntry('g1', 'Guide one', 'published')]);

    const { result } = renderHook(() => useBackendSaveFlow({ editor: { getGuide: () => guide() }, backendGuides }));

    await waitFor(() => expect(result.current.publishedStatus).toBe('published'));
  });

  it('keeps the tracked guide as a draft when its read fails', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ resourceName: 'g1', lastPublishedJson: null }));
    const backendGuides = makeBackendGuides([], { readGuide: jest.fn().mockRejectedValue(new Error('denied')) });

    const { result } = renderHook(() => useBackendSaveFlow({ editor: { getGuide: () => guide() }, backendGuides }));
    await flushReads();

    expect(result.current.publishedStatus).toBe('draft');
    expect(result.current.currentGuideMetadata).toBeNull();
    warnSpy.mockRestore();
  });
});

describe('useBackendSaveFlow — performSaveDraft', () => {
  it('saves a new guide as draft, tracks the resource name, and notifies success', async () => {
    const g = guide();
    const editor = { getGuide: () => g };
    const backendGuides = makeBackendGuides();

    const { result } = renderHook(() => useBackendSaveFlow({ editor, backendGuides }));

    await act(async () => {
      await result.current.performSaveDraft();
    });

    expect(backendGuides.saveGuide).toHaveBeenCalledWith(g, undefined, undefined, 'draft', false, undefined);
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
    const backendGuides = makeBackendGuides([], { saveGuide: jest.fn().mockRejectedValue(new Error('network down')) });
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

describe('useBackendSaveFlow — author details', () => {
  it('hands the guide details to saveGuide so an explicit author choice reaches the manifest', async () => {
    const g = guide();
    const guideDetails = { authorName: 'Dana', team: 'Docs' };
    const backendGuides = makeBackendGuides();
    const { result } = renderHook(() =>
      useBackendSaveFlow({ editor: { getGuide: () => g }, backendGuides, guideDetails })
    );

    await act(async () => {
      await result.current.performSaveDraft();
    });

    expect(backendGuides.saveGuide).toHaveBeenCalledWith(g, undefined, undefined, 'draft', false, guideDetails);
  });

  it('announces the name a save chose for an unauthored guide', async () => {
    const announceAuthor = jest.fn();
    const backendGuides = makeBackendGuides([], {
      saveGuide: jest
        .fn()
        .mockResolvedValue({ defaultedAuthor: { name: 'Sam Rivera', replacedName: 'pathfinder-mcp' } }),
    });
    const { result } = renderHook(() =>
      useBackendSaveFlow({ editor: { getGuide: () => guide() }, backendGuides, announceAuthor })
    );

    await act(async () => {
      await result.current.performSaveDraft();
    });

    expect(announceAuthor).toHaveBeenCalledWith({ name: 'Sam Rivera', replacedName: 'pathfinder-mcp' });
  });

  it('stays quiet when the guide already had an author', async () => {
    const announceAuthor = jest.fn();
    const backendGuides = makeBackendGuides([], { saveGuide: jest.fn().mockResolvedValue({}) });
    const { result } = renderHook(() =>
      useBackendSaveFlow({ editor: { getGuide: () => guide() }, backendGuides, announceAuthor })
    );

    await act(async () => {
      await result.current.performSaveDraft();
    });

    expect(announceAuthor).not.toHaveBeenCalled();
  });

  describe('details that differ from the stored author', () => {
    const tracked = () => {
      const g = guide();
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ resourceName: 'g1', backendStatus: 'draft', lastPublishedJson: JSON.stringify(g) })
      );
      const entry = makeGuideEntry('g1', 'Guide one', 'draft');
      entry.spec.manifest = { author: { name: 'Sam Rivera', team: 'Docs' } };
      return { editor: { getGuide: () => g }, backendGuides: makeBackendGuides([entry]) };
    };

    it('count as unsynced changes on an otherwise synced draft', async () => {
      const { editor, backendGuides } = tracked();

      const { result, rerender } = renderHook(
        ({ guideDetails }) => useBackendSaveFlow({ editor, backendGuides, guideDetails }),
        { initialProps: { guideDetails: {} as { authorName?: string; team?: string } } }
      );
      await flushReads();
      expect(result.current.hasUnsyncedChanges).toBe(false);

      rerender({ guideDetails: { authorName: 'Dana' } });
      expect(result.current.hasUnsyncedChanges).toBe(true);

      rerender({ guideDetails: { team: '' } });
      expect(result.current.hasUnsyncedChanges).toBe(true);
    });

    it('do not count once they match what is stored', async () => {
      const { editor, backendGuides } = tracked();

      const { result } = renderHook(() =>
        useBackendSaveFlow({ editor, backendGuides, guideDetails: { authorName: 'Sam Rivera', team: 'Docs' } })
      );
      await flushReads();

      expect(result.current.hasUnsyncedChanges).toBe(false);
    });
  });
});

describe('useBackendSaveFlow — handlePostToBackend', () => {
  it('publishes a new guide and marks it published', async () => {
    const g = guide();
    const editor = { getGuide: () => g };
    const stored: BackendSaveFlowGuideEntry[] = [];
    const backendGuides = makeBackendGuides(stored, {
      saveGuide: jest.fn(async () => {
        stored.push(makeGuideEntry('g1', 'Guide one', 'published'));
      }),
    });
    const { result } = renderHook(() => useBackendSaveFlow({ editor, backendGuides }));

    await act(async () => {
      await result.current.handlePostToBackend();
    });

    expect(backendGuides.saveGuide).toHaveBeenCalledWith(g, undefined, undefined, 'published', false, undefined);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ payload: ['Guide published.'] }));
    expect(result.current.publishedStatus).toBe('published');
  });
});

describe('useBackendSaveFlow — resourceVersion', () => {
  const trackedAt = (resourceVersion: string) => {
    const g = guide();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ resourceName: 'g1', backendStatus: 'draft', lastPublishedJson: JSON.stringify(g) })
    );
    const entry = makeGuideEntry('g1', 'Guide one');
    entry.metadata.resourceVersion = resourceVersion;
    return { g, entry };
  };

  it('saves with the resourceVersion of the tracked guide as last read', async () => {
    const { g, entry } = trackedAt('7');
    const backendGuides = makeBackendGuides([entry]);
    const { result } = renderHook(() => useBackendSaveFlow({ editor: { getGuide: () => g }, backendGuides }));
    await flushReads();

    await act(async () => {
      await result.current.performSaveDraft();
    });

    expect(backendGuides.saveGuide).toHaveBeenCalledWith(
      g,
      'g1',
      expect.objectContaining({ resourceVersion: '7' }),
      'draft',
      false,
      undefined
    );
  });

  it('re-reads after a save, so the next save carries the version that save wrote', async () => {
    const { g, entry } = trackedAt('7');
    const backendGuides = makeBackendGuides([entry], {
      saveGuide: jest.fn(async () => {
        entry.metadata.resourceVersion = String(Number(entry.metadata.resourceVersion) + 1);
      }),
    });
    const { result } = renderHook(() => useBackendSaveFlow({ editor: { getGuide: () => g }, backendGuides }));
    await flushReads();

    await act(async () => {
      await result.current.performSaveDraft();
    });
    await act(async () => {
      await result.current.performSaveDraft();
    });

    const versions = (backendGuides.saveGuide as jest.Mock).mock.calls.map(
      ([, , metadata]) => metadata.resourceVersion
    );
    expect(versions).toEqual(['7', '8']);
  });

  it('drops the pre-save version when the re-read fails, so the next save is not stuck on a 409', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const { g, entry } = trackedAt('7');
    const backendGuides = makeBackendGuides([entry]);
    const { result } = renderHook(() => useBackendSaveFlow({ editor: { getGuide: () => g }, backendGuides }));
    await flushReads();
    (backendGuides.readGuide as jest.Mock).mockRejectedValueOnce(new Error('blip'));

    await act(async () => {
      await result.current.performSaveDraft();
    });
    await act(async () => {
      await result.current.performSaveDraft();
    });

    const [, second] = (backendGuides.saveGuide as jest.Mock).mock.calls;
    expect(second[2]).toEqual({ name: 'g1' });
    warnSpy.mockRestore();
  });

  it('keeps a just-published guide published when its re-read fails, so Save cannot unpublish it', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const { g, entry } = trackedAt('7');
    const backendGuides = makeBackendGuides([entry]);
    const { result } = renderHook(() => useBackendSaveFlow({ editor: { getGuide: () => g }, backendGuides }));
    await flushReads();
    expect(result.current.publishedStatus).toBe('draft');
    (backendGuides.readGuide as jest.Mock).mockRejectedValueOnce(new Error('blip'));

    await act(async () => {
      await result.current.handlePostToBackend();
    });

    expect(result.current.publishedStatus).toBe('published');
    expect(result.current.currentGuideMetadata).toEqual({ name: 'g1' });
    warnSpy.mockRestore();
  });
});

describe('useBackendSaveFlow — overwrite conflict', () => {
  it('opens the confirm modal, and confirming saves over the existing guide', async () => {
    const g = guide({ id: 'existing-guide', title: 'Existing guide' });
    const editor = { getGuide: () => g };
    const backendGuides = makeBackendGuides([makeGuideEntry('existing-guide', 'Existing guide (old)', 'draft')]);
    const { result } = renderHook(() => useBackendSaveFlow({ editor, backendGuides }));

    let savePromise!: Promise<void>;
    await act(async () => {
      savePromise = result.current.performSaveDraft();
    });

    expect(backendGuides.readGuide).toHaveBeenCalledWith('existing-guide');
    expect(result.current.confirmModal.isOpen).toBe(true);
    expect(result.current.confirmModal.resourceName).toBe('existing-guide');
    expect(result.current.confirmModal.existingTitle).toBe('Existing guide (old)');
    expect(backendGuides.saveGuide).not.toHaveBeenCalled();

    await act(async () => {
      result.current.confirmModal.onConfirm();
      await savePromise;
    });

    // The last argument is the point: an overwrite replaces a resource this guide did not come
    // from, so saveGuide must not inherit its manifest or provenance annotations.
    expect(backendGuides.saveGuide).toHaveBeenCalledWith(
      g,
      'existing-guide',
      { name: 'existing-guide' },
      'draft',
      true,
      undefined
    );
    expect(result.current.confirmModal.isOpen).toBe(false);
    expect(result.current.currentGuideResourceName).toBe('existing-guide');
  });

  it('leaves the guide untracked when the overwrite fails, so the next save re-asks', async () => {
    const g = guide({ id: 'existing-guide', title: 'Existing guide' });
    const editor = { getGuide: () => g };
    const backendGuides = makeBackendGuides([makeGuideEntry('existing-guide', 'Existing guide (old)', 'draft')], {
      saveGuide: jest.fn().mockRejectedValue(new Error('network down')),
    });
    const { result } = renderHook(() => useBackendSaveFlow({ editor, backendGuides }));

    let savePromise!: Promise<void>;
    await act(async () => {
      savePromise = result.current.performSaveDraft();
    });
    await act(async () => {
      result.current.confirmModal.onConfirm();
      await savePromise;
    });

    // Tracking the foreign resource here would make the retry an ordinary update, which inherits
    // its manifest and provenance annotations — the fail-open this whole guard exists to prevent.
    expect(result.current.currentGuideResourceName).toBeNull();

    (backendGuides.saveGuide as jest.Mock).mockClear().mockResolvedValue(undefined);
    await act(async () => {
      savePromise = result.current.performSaveDraft();
    });

    expect(result.current.confirmModal.isOpen).toBe(true);
    await act(async () => {
      result.current.confirmModal.onConfirm();
      await savePromise;
    });
    expect(backendGuides.saveGuide).toHaveBeenCalledWith(
      g,
      'existing-guide',
      { name: 'existing-guide' },
      'draft',
      true,
      undefined
    );
  });

  it('cancelling the conflict prompt does not save', async () => {
    const g = guide({ id: 'existing-guide', title: 'Existing guide' });
    const editor = { getGuide: () => g };
    const backendGuides = makeBackendGuides([makeGuideEntry('existing-guide', 'Existing guide (old)', 'draft')]);
    const { result } = renderHook(() => useBackendSaveFlow({ editor, backendGuides }));

    let savePromise!: Promise<void>;
    await act(async () => {
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

  it('refuses to save when the collision read fails, rather than overwrite unasked', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation();
    const backendGuides = makeBackendGuides([], { readGuide: jest.fn().mockRejectedValue(new Error('denied')) });
    const { result } = renderHook(() => useBackendSaveFlow({ editor: { getGuide: () => guide() }, backendGuides }));

    await act(async () => {
      await result.current.performSaveDraft();
    });

    expect(backendGuides.saveGuide).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ payload: ['Save failed', 'denied'] }));
    errSpy.mockRestore();
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
    const entry = makeGuideEntry('g1', 'Guide one', 'published');
    const backendGuides = makeBackendGuides([entry], {
      unpublishGuide: jest.fn(async () => {
        entry.spec.status = 'draft';
      }),
    });
    const { result } = renderHook(() => useBackendSaveFlow({ editor, backendGuides }));
    await waitFor(() => expect(result.current.publishedStatus).toBe('published'));

    await act(async () => {
      await result.current.performUnpublish();
    });

    expect(backendGuides.unpublishGuide).toHaveBeenCalledWith('g1');
    expect(result.current.publishedStatus).toBe('draft');
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
    const backendGuides = makeBackendGuides([makeGuideEntry('g1', 'Guide one', 'published')], {
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
      result.current.trackLoadedGuide(loaded, 'loaded-guide', makeGuideEntry('loaded-guide', 'Loaded'));
    });

    expect(result.current.currentGuideResourceName).toBe('loaded-guide');
    expect(result.current.lastPublishedJson).toBe(
      JSON.stringify({ id: loaded.id, title: loaded.title, blocks: loaded.blocks })
    );
  });

  it('trackLoadedGuide takes status and version from the loaded resource at once, without a second read', async () => {
    const backendGuides = makeBackendGuides();
    const { result } = renderHook(() => useBackendSaveFlow({ editor: { getGuide: () => guide() }, backendGuides }));
    const stored = makeGuideEntry('loaded-guide', 'Loaded', 'published');
    stored.metadata.resourceVersion = '12';

    act(() => {
      result.current.trackLoadedGuide(guide({ id: 'loaded-guide' }), 'loaded-guide', stored);
    });

    expect(result.current.publishedStatus).toBe('published');
    expect(result.current.currentGuideMetadata).toMatchObject({ resourceVersion: '12' });
    await flushReads();
    expect(backendGuides.readGuide).not.toHaveBeenCalled();
  });

  it('handleClearBackendTracking resets tracking to not-saved and clears localStorage', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ resourceName: 'g1', backendStatus: 'draft', lastPublishedJson: '{}' })
    );
    const editor = { getGuide: () => guide() };
    const backendGuides = makeBackendGuides([makeGuideEntry('g1', 'Guide one', 'draft')]);
    const { result } = renderHook(() => useBackendSaveFlow({ editor, backendGuides }));
    await flushReads();

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
  it('is true once tracked content diverges from the last backend save', async () => {
    const savedGuide = guide();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ resourceName: 'g1', backendStatus: 'draft', lastPublishedJson: JSON.stringify(savedGuide) })
    );
    const backendGuides = makeBackendGuides([makeGuideEntry('g1', 'Guide one', 'draft')]);

    let currentGuide = savedGuide;
    const editor = { getGuide: () => currentGuide };
    const { result, rerender } = renderHook(() => useBackendSaveFlow({ editor, backendGuides }));
    await flushReads();

    expect(result.current.hasUnsyncedChanges).toBe(false);

    currentGuide = guide({ title: 'Changed title' });
    rerender();

    expect(result.current.hasUnsyncedChanges).toBe(true);
  });
});
