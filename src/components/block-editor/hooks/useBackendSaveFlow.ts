/**
 * useBackendSaveFlow Hook
 *
 * Owns the block editor's backend draft/publish/unpublish lifecycle:
 * resource-name tracking, overwrite-conflict confirmation, status derivation,
 * backend refreshes, notifications, and error handling.
 *
 * Extracted from BlockEditor to reduce component complexity.
 */

import { useState, useCallback, useEffect } from 'react';
import type { JsonGuide } from '../types';
import { BACKEND_TRACKING_STORAGE_KEY } from '../constants';
import { logger } from '../../../lib/logging';
import { notify } from '../notify';

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

/** A backend-tracked guide entry, as returned by useBackendGuides. */
export interface BackendSaveFlowGuideEntry {
  metadata: { name: string; [key: string]: unknown };
  spec: { title: string; status?: 'draft' | 'published' };
}

/** Minimal interface for backend guide management needed by this hook. */
export interface BackendSaveFlowGuidesInterface {
  guides: BackendSaveFlowGuideEntry[];
  saveGuide: (
    guide: JsonGuide,
    existingResourceName?: string,
    existingMetadata?: any,
    status?: 'draft' | 'published'
  ) => Promise<void>;
  refreshGuides: () => Promise<BackendSaveFlowGuideEntry[]>;
  unpublishGuide: (resourceName: string, currentMetadata: any) => Promise<void>;
}

export interface UseBackendSaveFlowOptions {
  /** Editor instance for reading the current guide */
  editor: BackendSaveFlowEditorInterface;
  /** Backend guide list/save/refresh/unpublish operations */
  backendGuides: BackendSaveFlowGuidesInterface;
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
  /** True when local content differs from the last backend save */
  hasUnsyncedChanges: boolean;
  /** Overwrite-conflict prompt state */
  confirmModal: BackendSaveFlowConfirmModal;
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
  trackLoadedGuide: (guide: JsonGuide, resourceName: string) => void;
}

/**
 * Backend draft/publish/unpublish orchestration for the block editor.
 */
export function useBackendSaveFlow({ editor, backendGuides }: UseBackendSaveFlowOptions): UseBackendSaveFlowReturn {
  const [currentGuideResourceName, setCurrentGuideResourceName] = useState<string | null>(
    () => readBackendTracking().resourceName
  );
  const [lastPublishedJson, setLastPublishedJson] = useState<string | null>(
    () => readBackendTracking().lastPublishedJson
  );
  const [confirmModal, setConfirmModal] = useState<BackendSaveFlowConfirmModal>(CLOSED_CONFIRM_MODAL);

  const currentGuideMetadata = currentGuideResourceName
    ? (backendGuides.guides.find((g) => g.metadata.name === currentGuideResourceName)?.metadata ?? null)
    : null;
  const currentGuideBackendStatus = currentGuideResourceName
    ? (backendGuides.guides.find((g) => g.metadata.name === currentGuideResourceName)?.spec.status ?? null)
    : null;

  const publishedStatus: 'not-saved' | 'draft' | 'published' = !currentGuideResourceName
    ? 'not-saved'
    : currentGuideBackendStatus === 'published'
      ? 'published'
      : 'draft';

  const currentJson = JSON.stringify(editor.getGuide());
  const hasUnsyncedChanges =
    publishedStatus !== 'not-saved' && lastPublishedJson !== null && currentJson !== lastPublishedJson;

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
      previousStatus: 'draft' | 'published' | null
    ) => {
      // Generate resource name if not provided
      const generatedResourceName = resourceName || toResourceName(guide.id || guide.title);

      if (!generatedResourceName || generatedResourceName.length === 0) {
        throw new Error('Guide title or ID must contain at least one alphanumeric character');
      }

      await backendGuides.saveGuide(guide, resourceName, metadata, status);

      // Track the content that was last synced to the backend
      setLastPublishedJson(JSON.stringify(guide));

      // Refresh to get the latest metadata (including updated resourceVersion)
      const updatedGuides = await backendGuides.refreshGuides();

      const savedGuide = updatedGuides.find((g) => g.metadata.name === generatedResourceName);
      setCurrentGuideResourceName(savedGuide ? savedGuide.metadata.name : generatedResourceName);

      if (status === 'published') {
        notify('success', previousStatus === 'published' ? 'Guide updated.' : 'Guide published.');
      } else {
        notify('success', isUpdate ? 'Draft updated.' : 'Guide saved as draft.');
      }
    },
    [backendGuides]
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

        if (!isUpdate) {
          const existingGuide = backendGuides.guides.find((g) => g.metadata.name === resourceName);
          if (existingGuide) {
            return new Promise<void>((resolve) => {
              setConfirmModal({
                isOpen: true,
                resourceName,
                existingTitle: existingGuide.spec.title,
                onConfirm: async () => {
                  setConfirmModal((prev) => ({ ...prev, isOpen: false }));
                  setCurrentGuideResourceName(existingGuide.metadata.name);
                  await performBackendSave(
                    guide,
                    existingGuide.metadata.name,
                    existingGuide.metadata,
                    true,
                    status,
                    existingGuide.spec.status ?? 'draft'
                  );
                  resolve();
                },
                onCancel: resolve,
              });
            });
          }
        }

        await performBackendSave(
          guide,
          currentGuideResourceName || undefined,
          currentGuideMetadata || undefined,
          isUpdate,
          status,
          currentGuideBackendStatus
        );
      } catch (error) {
        logger.error('[BlockEditor] Failed to save guide', { error });
        notify('error', 'Save failed', error instanceof Error ? error.message : 'Unknown error');
      }
    },
    [
      editor,
      backendGuides,
      currentGuideResourceName,
      currentGuideMetadata,
      currentGuideBackendStatus,
      performBackendSave,
    ]
  );

  /** Save the current guide as a draft — not visible to users */
  const performSaveDraft = useCallback(async () => {
    await orchestrateSave('draft');
  }, [orchestrateSave]);

  /** Unpublish a published guide — sets it back to draft, removing it from the docs panel */
  const performUnpublish = useCallback(async () => {
    if (!currentGuideResourceName || !currentGuideMetadata) {
      return;
    }
    try {
      await backendGuides.unpublishGuide(currentGuideResourceName, currentGuideMetadata);

      await backendGuides.refreshGuides();
      // Keep lastPublishedJson set — guide content is unchanged, only status changed.
      // This allows change detection to work correctly for the guide now in draft state.
      setLastPublishedJson(JSON.stringify(editor.getGuide()));
      notify('success', 'Guide unpublished.');
    } catch (error) {
      logger.error('[BlockEditor] Failed to unpublish guide', { error });
      notify('error', 'Unpublish failed', error instanceof Error ? error.message : 'Unknown error');
    }
  }, [backendGuides, currentGuideResourceName, currentGuideMetadata, editor]);

  // Publish/update guide to backend handler
  const handlePostToBackend = useCallback(async () => {
    await orchestrateSave('published');
  }, [orchestrateSave]);

  // Clear backend tracking when starting a new guide
  const handleClearBackendTracking = useCallback(() => {
    setCurrentGuideResourceName(null);
    setLastPublishedJson(null);
  }, []);

  // Track a guide freshly loaded from the backend library
  const trackLoadedGuide = useCallback((guide: JsonGuide, resourceName: string) => {
    setCurrentGuideResourceName(resourceName);
    // Normalize to match getGuide() output (id, title, blocks — no schemaVersion or extra fields)
    setLastPublishedJson(JSON.stringify({ id: guide.id, title: guide.title, blocks: guide.blocks }));
  }, []);

  return {
    currentGuideResourceName,
    currentGuideMetadata,
    publishedStatus,
    lastPublishedJson,
    hasUnsyncedChanges,
    confirmModal,
    closeConfirmModal,
    performSaveDraft,
    handlePostToBackend,
    performUnpublish,
    handleClearBackendTracking,
    trackLoadedGuide,
  };
}
