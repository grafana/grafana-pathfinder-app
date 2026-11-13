/**
 * useBackendSaveFlow Hook
 *
 * Owns the block editor's backend draft/publish/unpublish lifecycle:
 * resource-name tracking, overwrite-conflict confirmation, status derivation,
 * backend refreshes, notifications, and error handling.
 *
 * Extracted from BlockEditor to reduce component complexity.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { JsonGuide } from '../types';
import { BACKEND_TRACKING_STORAGE_KEY } from '../constants';
import { logger } from '../../../lib/logging';
import { notify } from '../notify';
import { detailsDifferFromAuthor, type DefaultedAuthor, type GuideDetails } from '../utils/derive-manifest';

/**
 * Normalize a guide id or title into a Kubernetes-style resource name:
 * lowercase, hyphen-separated, no leading/trailing or repeated hyphens.
 * Returns the empty string if the input has no alphanumeric characters.
 */
function toResourceName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Reads persisted backend tracking state from localStorage. Returns null values when nothing is stored. */
function readBackendTracking(): { resourceName: string | null; lastPublishedJson: string | null } {
  try {
    const stored = localStorage.getItem(BACKEND_TRACKING_STORAGE_KEY);
    if (stored) {
      const { resourceName, lastPublishedJson } = JSON.parse(stored);
      if (resourceName) {
        return { resourceName, lastPublishedJson: lastPublishedJson ?? null };
      }
    }
  } catch {
    // ignore malformed data
  }
  return { resourceName: null, lastPublishedJson: null };
}

/** Minimal interface for editor functionality needed by this hook. */
export interface BackendSaveFlowEditorInterface {
  getGuide: () => JsonGuide;
}

/** A stored guide, as read singly by useBackendGuides. */
export interface BackendSaveFlowGuideEntry {
  metadata: { name: string; [key: string]: unknown };
  spec: { title: string; status?: 'draft' | 'published'; manifest?: Record<string, unknown> };
}

/** Minimal interface for backend guide management needed by this hook. */
export interface BackendSaveFlowGuidesInterface {
  saveGuide: (
    guide: JsonGuide,
    existingResourceName?: string,
    existingMetadata?: any,
    status?: 'draft' | 'published',
    replacesForeignResource?: boolean,
    details?: GuideDetails
  ) => Promise<{ defaultedAuthor?: DefaultedAuthor; written?: BackendSaveFlowGuideEntry } | void>;
  /** Resolves undefined only on a 404. */
  readGuide: (resourceName: string) => Promise<BackendSaveFlowGuideEntry | undefined>;
  /** Resolves to the resource the write answered with, when it answered with one. */
  unpublishGuide: (resourceName: string) => Promise<BackendSaveFlowGuideEntry | undefined | void>;
}

export interface UseBackendSaveFlowOptions {
  /** Editor instance for reading the current guide */
  editor: BackendSaveFlowEditorInterface;
  /** Backend guide read/save/unpublish operations */
  backendGuides: BackendSaveFlowGuidesInterface;
  /** Author choices from the guide details modal, written at the next save. */
  guideDetails?: GuideDetails;
  /** Called with the name a save chose for a guide that had no real author, so the editor can say so. */
  announceAuthor?: (defaulted: DefaultedAuthor) => void;
}

/**
 * Overwrite-confirmation prompt shown when saving a new guide whose resource
 * name collides with an existing one. `isOpen: false` carries no-op
 * `onConfirm`/`onCancel` so the modal can always be wired unconditionally.
 */
export interface BackendSaveFlowConfirmModal {
  isOpen: boolean;
  resourceName: string;
  existingTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const CLOSED_CONFIRM_MODAL: BackendSaveFlowConfirmModal = {
  isOpen: false,
  resourceName: '',
  existingTitle: '',
  onConfirm: () => {},
  onCancel: () => {},
};

export interface UseBackendSaveFlowReturn {
  /** Resource name of the guide currently tracked against the backend (null if never saved) */
  currentGuideResourceName: string | null;
  /** Backend metadata for the currently tracked guide, if known */
  currentGuideMetadata: BackendSaveFlowGuideEntry['metadata'] | null;
  /** Derived save/publish status for the current guide */
  publishedStatus: 'not-saved' | 'draft' | 'published';
  /** Guide JSON as of the last successful backend save (draft or published) */
  lastPublishedJson: string | null;
  /** True when local content or guide details differ from the last backend save */
  hasUnsyncedChanges: boolean;
  /** `spec.manifest.author` of the tracked guide as last read from the backend */
  storedAuthor: unknown;
  /** Overwrite-conflict prompt state */
  confirmModal: BackendSaveFlowConfirmModal;
  /** True from a save or unpublish click until its tracking has settled; another one is ignored meanwhile. */
  isBusy: boolean;
  /** Dismiss the confirm modal, invoking its onCancel */
  closeConfirmModal: () => void;
  /** Save the current guide as a draft (not visible to users) */
  performSaveDraft: () => Promise<void>;
  /** Publish (or update) the current guide */
  handlePostToBackend: () => Promise<void>;
  /** Unpublish a published guide back to draft */
  performUnpublish: () => Promise<void>;
  /** Reset backend tracking state (e.g. when starting a new guide) */
  handleClearBackendTracking: () => void;
  /** Track a guide freshly loaded from the backend library */
  trackLoadedGuide: (guide: JsonGuide, resourceName: string, stored: BackendSaveFlowGuideEntry) => void;
}

/**
 * Backend draft/publish/unpublish orchestration for the block editor.
 */
export function useBackendSaveFlow({
  editor,
  backendGuides,
  guideDetails,
  announceAuthor,
}: UseBackendSaveFlowOptions): UseBackendSaveFlowReturn {
  const [currentGuideResourceName, setCurrentGuideResourceName] = useState<string | null>(
    () => readBackendTracking().resourceName
  );
  const [lastPublishedJson, setLastPublishedJson] = useState<string | null>(
    () => readBackendTracking().lastPublishedJson
  );
  const [confirmModal, setConfirmModal] = useState<BackendSaveFlowConfirmModal>(CLOSED_CONFIRM_MODAL);

  // The tracked guide is read singly, not found in the library's catalogue: the catalogue holds no
  // resourceVersion, and that version is what makes a concurrent write 409.
  const [storedGuide, setStoredGuide] = useState<BackendSaveFlowGuideEntry | undefined>();
  const { readGuide } = backendGuides;
  const readSeq = useRef(0);
  const syncedName = useRef<string | null>(null);
  // Takes a stored entry already in hand, superseding any read still in flight.
  const adoptStored = useCallback((resourceName: string, entry: BackendSaveFlowGuideEntry) => {
    readSeq.current++;
    syncedName.current = resourceName;
    setStoredGuide(entry);
  }, []);
  const syncStoredGuide = useCallback(
    (resourceName: string): Promise<void> => {
      const seq = ++readSeq.current;
      syncedName.current = resourceName;
      return readGuide(resourceName).then(
        (stored) => {
          if (seq === readSeq.current) {
            setStoredGuide(stored);
          }
        },
        (error: unknown) => logger.warn('[BlockEditor] Failed to read the tracked guide', { error })
      );
    },
    [readGuide]
  );
  // A write's own response carries the version the editor's content is now based on, so it seeds the entry;
  // re-reading is only the fallback for a response that holds no resource.
  const trackWrite = useCallback(
    (resourceName: string, status: 'draft' | 'published', written?: BackendSaveFlowGuideEntry | void) => {
      if (written) {
        adoptStored(resourceName, written);
        return Promise.resolve();
      }
      // Until the re-read lands, and if it fails, the write's status stands and the old resourceVersion
      // stays, so a save in between fails closed with a 409 rather than overwrite a concurrent write.
      setStoredGuide((prev) => {
        const kept =
          prev?.metadata.name === resourceName ? prev : { metadata: { name: resourceName }, spec: { title: '' } };
        return { ...kept, spec: { ...kept.spec, status } };
      });
      return syncStoredGuide(resourceName);
    },
    [adoptStored, syncStoredGuide]
  );

  // Only a restored name needs this read: loads seed the entry and writes track their own.
  useEffect(() => {
    if (currentGuideResourceName && syncedName.current !== currentGuideResourceName) {
      void syncStoredGuide(currentGuideResourceName);
    }
  }, [currentGuideResourceName, syncStoredGuide]);

  const currentGuideEntry = storedGuide?.metadata.name === currentGuideResourceName ? storedGuide : undefined;
  const currentGuideMetadata = currentGuideEntry?.metadata ?? null;
  const currentGuideBackendStatus = currentGuideEntry?.spec.status ?? null;
  const storedAuthor = currentGuideEntry?.spec.manifest?.author;

  const publishedStatus: 'not-saved' | 'draft' | 'published' = !currentGuideResourceName
    ? 'not-saved'
    : currentGuideBackendStatus === 'published'
      ? 'published'
      : 'draft';

  const currentJson = JSON.stringify(editor.getGuide());
  const hasUnsyncedChanges =
    publishedStatus !== 'not-saved' &&
    ((lastPublishedJson !== null && currentJson !== lastPublishedJson) ||
      detailsDifferFromAuthor(storedAuthor, guideDetails));

  // Persist backend tracking state to localStorage whenever it changes.
  useEffect(() => {
    if (currentGuideResourceName) {
      try {
        localStorage.setItem(
          BACKEND_TRACKING_STORAGE_KEY,
          JSON.stringify({
            resourceName: currentGuideResourceName,
            backendStatus: currentGuideBackendStatus,
            lastPublishedJson,
          })
        );
      } catch {
        // ignore
      }
    } else {
      localStorage.removeItem(BACKEND_TRACKING_STORAGE_KEY);
    }
  }, [currentGuideResourceName, currentGuideBackendStatus, lastPublishedJson]);

  const closeConfirmModal = useCallback(() => {
    setConfirmModal((prev) => {
      const callback = prev.onCancel;
      setTimeout(() => callback?.(), 0);
      return { ...prev, isOpen: false };
    });
  }, []);

  /**
   * Shared logic for saving a guide to the backend with a given status.
   * Refreshes metadata and updates local tracking state afterwards.
   */
  const performBackendSave = useCallback(
    async (
      guide: JsonGuide,
      resourceName: string | undefined,
      metadata: any,
      isUpdate: boolean,
      status: 'draft' | 'published',
      previousStatus: 'draft' | 'published' | null,
      replacesForeignResource = false
    ) => {
      // Generate resource name if not provided
      const generatedResourceName = resourceName || toResourceName(guide.id || guide.title);

      if (!generatedResourceName || generatedResourceName.length === 0) {
        throw new Error('Guide title or ID must contain at least one alphanumeric character');
      }

      const saved = await backendGuides.saveGuide(
        guide,
        resourceName,
        metadata,
        status,
        replacesForeignResource,
        guideDetails
      );
      if (saved?.defaultedAuthor) {
        announceAuthor?.(saved.defaultedAuthor);
      }

      // Track the content that was last synced to the backend
      setLastPublishedJson(JSON.stringify(guide));

      setCurrentGuideResourceName(generatedResourceName);
      await trackWrite(generatedResourceName, status, saved?.written);

      if (status === 'published') {
        notify('success', previousStatus === 'published' ? 'Guide updated.' : 'Guide published.');
      } else {
        notify('success', isUpdate ? 'Draft updated.' : 'Guide saved as draft.');
      }
    },
    [backendGuides, guideDetails, announceAuthor, trackWrite]
  );

  /**
   * Orchestrates the save flow: validates, checks for conflicts, and calls performBackendSave.
   * Shared by both draft and published save operations.
   */
  const orchestrateSave = useCallback(
    async (status: 'draft' | 'published') => {
      try {
        const guide = editor.getGuide();

        if (!guide.blocks || guide.blocks.length === 0) {
          notify('error', 'Cannot save guide', 'Add at least one block before saving.');
          return;
        }

        const isUpdate = !!currentGuideResourceName;

        const resourceName = currentGuideResourceName || toResourceName(guide.id || guide.title);

        if (!resourceName || resourceName.length === 0) {
          notify('error', 'Invalid guide name', 'Guide title or ID must contain at least one alphanumeric character');
          return;
        }

        let tracked = currentGuideEntry;
        if (isUpdate && !tracked) {
          // The read that restored tracking failed or has not landed, so the status and version are unknown.
          // Read now rather than write blind: a failed read fails the save, and a draft save must not
          // unpublish a guide the editor did not know was published.
          tracked = await backendGuides.readGuide(resourceName);
          if (tracked) {
            adoptStored(resourceName, tracked);
            if (status === 'draft' && tracked.spec.status === 'published') {
              notify('error', 'Save failed', 'This guide is published. Use Update to save your changes.');
              return;
            }
          }
        }

        if (!isUpdate) {
          const existingGuide = await backendGuides.readGuide(resourceName);
          if (existingGuide) {
            return new Promise<void>((resolve) => {
              setConfirmModal({
                isOpen: true,
                resourceName,
                existingTitle: existingGuide.spec.title,
                onConfirm: async () => {
                  setConfirmModal((prev) => ({ ...prev, isOpen: false }));
                  // This runs after orchestrateSave's try/catch has already returned, so it owns its
                  // own reporting — and must settle either way or the caller awaits forever.
                  try {
                    // Tracking is NOT set here. performBackendSave sets it once the write landed, so
                    // a failed overwrite leaves this guide untracked and the next save re-asks
                    // rather than inheriting the foreign resource's manifest and provenance.
                    await performBackendSave(
                      guide,
                      existingGuide.metadata.name,
                      existingGuide.metadata,
                      true,
                      status,
                      existingGuide.spec.status ?? 'draft',
                      true
                    );
                  } catch (error) {
                    logger.error('[BlockEditor] Failed to overwrite guide', { error });
                    notify('error', 'Save failed', error instanceof Error ? error.message : 'Unknown error');
                  } finally {
                    resolve();
                  }
                },
                onCancel: resolve,
              });
            });
          }
        }

        await performBackendSave(
          guide,
          currentGuideResourceName || undefined,
          tracked?.metadata,
          isUpdate,
          status,
          tracked?.spec.status ?? null
        );
      } catch (error) {
        logger.error('[BlockEditor] Failed to save guide', { error });
        notify('error', 'Save failed', error instanceof Error ? error.message : 'Unknown error');
      }
    },
    [editor, backendGuides, currentGuideResourceName, currentGuideEntry, adoptStored, performBackendSave]
  );

  // Busy until tracking settles, not just until the write returns: a second save or unpublish in that
  // window would act on the status and version from before the first one.
  const [isBusy, setIsBusy] = useState(false);
  const busyRef = useRef(false);
  const exclusive = useCallback(async (action: () => Promise<void>) => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setIsBusy(true);
    try {
      await action();
    } finally {
      busyRef.current = false;
      setIsBusy(false);
    }
  }, []);

  /** Save the current guide as a draft — not visible to users */
  const performSaveDraft = useCallback(() => exclusive(() => orchestrateSave('draft')), [exclusive, orchestrateSave]);

  const unpublishTracked = useCallback(async () => {
    if (!currentGuideResourceName) {
      return;
    }
    try {
      const written = await backendGuides.unpublishGuide(currentGuideResourceName);

      await trackWrite(currentGuideResourceName, 'draft', written);
      // Keep lastPublishedJson set — guide content is unchanged, only status changed.
      // This allows change detection to work correctly for the guide now in draft state.
      setLastPublishedJson(JSON.stringify(editor.getGuide()));
      notify('success', 'Guide unpublished.');
    } catch (error) {
      logger.error('[BlockEditor] Failed to unpublish guide', { error });
      notify('error', 'Unpublish failed', error instanceof Error ? error.message : 'Unknown error');
    }
  }, [backendGuides, currentGuideResourceName, editor, trackWrite]);

  /** Unpublish a published guide — sets it back to draft, removing it from the docs panel */
  const performUnpublish = useCallback(() => exclusive(unpublishTracked), [exclusive, unpublishTracked]);

  // Publish/update guide to backend handler
  const handlePostToBackend = useCallback(
    () => exclusive(() => orchestrateSave('published')),
    [exclusive, orchestrateSave]
  );

  // Clear backend tracking when starting a new guide
  const handleClearBackendTracking = useCallback(() => {
    setCurrentGuideResourceName(null);
    setLastPublishedJson(null);
  }, []);

  // Track a guide freshly loaded from the backend library. Its stored resource is what the content came
  // from, so it seeds the status and the resourceVersion the next save carries, with no second read.
  const trackLoadedGuide = useCallback(
    (guide: JsonGuide, resourceName: string, stored: BackendSaveFlowGuideEntry) => {
      adoptStored(resourceName, stored);
      setCurrentGuideResourceName(resourceName);
      // Normalize to match getGuide() output (id, title, blocks — no schemaVersion or extra fields)
      setLastPublishedJson(JSON.stringify({ id: guide.id, title: guide.title, blocks: guide.blocks }));
    },
    [adoptStored]
  );

  return {
    currentGuideResourceName,
    currentGuideMetadata,
    publishedStatus,
    lastPublishedJson,
    hasUnsyncedChanges,
    storedAuthor,
    confirmModal,
    isBusy,
    closeConfirmModal,
    performSaveDraft,
    handlePostToBackend,
    performUnpublish,
    handleClearBackendTracking,
    trackLoadedGuide,
  };
}
