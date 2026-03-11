/**
 * Block Editor
 *
 * Main component for the block-based JSON guide editor.
 * Provides a visual interface for composing guides from different block types.
 * State persists to localStorage automatically and survives page refreshes.
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useStyles2 } from '@grafana/ui';
import { getAppEvents } from '@grafana/runtime';
import { useBlockEditor } from './hooks/useBlockEditor';
import { useBlockPersistence } from './hooks/useBlockPersistence';
import { useRecordingPersistence, type PersistedRecordingState } from './hooks/useRecordingPersistence';
import { useModalManager } from './hooks/useModalManager';
import { useBlockSelection } from './hooks/useBlockSelection';
import { useBlockFormState } from './hooks/useBlockFormState';
import { useRecordingState } from './hooks/useRecordingState';
import { useRecordingActions } from './hooks/useRecordingActions';
import { useJsonModeHandlers } from './hooks/useJsonModeHandlers';
import { useBlockConversionHandlers } from './hooks/useBlockConversionHandlers';
import { useGuideOperations } from './hooks/useGuideOperations';
import { useBackendGuides } from './hooks/useBackendGuides';
import { isBackendApiAvailable } from '../../utils/fetchBackendGuides';
import { getBlockEditorStyles } from './block-editor.styles';
import { BlockFormModal } from './BlockFormModal';
import { RecordModeOverlay } from './RecordModeOverlay';
import { GuideLibraryModal } from './GuideLibraryModal';
import { useActionRecorder } from '../../utils/devtools';
import type { JsonGuide, JsonBlock, BlockOperations } from './types';
import { BlockEditorFooter } from './BlockEditorFooter';
import { BlockEditorHeader } from './BlockEditorHeader';
import { BlockEditorContent } from './BlockEditorContent';
import { BlockEditorModals } from './BlockEditorModals';
import { BlockEditorContextProvider, useBlockEditorContext } from './BlockEditorContext';
import { ConfirmModal } from './NotificationModals';
import { BACKEND_TRACKING_STORAGE_KEY, DEFAULT_GUIDE_METADATA } from './constants';

/** Converts a guide title to a URL-safe kebab-case slug */
function slugifyTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'guide'
  );
}

/** Generates a unique guide ID from a title, avoiding collisions with existing resource names */
function generateUniqueId(title: string, existingNames: string[]): string {
  const base = slugifyTitle(title);
  for (let i = 0; i < 20; i++) {
    const suffix = Math.random().toString(36).slice(2, 6);
    const candidate = `${base}-${suffix}`;
    if (!existingNames.includes(candidate)) {
      return candidate;
    }
  }
  return `${base}-${Date.now().toString(36).slice(-6)}`;
}

function notify(type: 'success' | 'error' | 'info', title: string, message?: string) {
  const eventType = type === 'success' ? 'alert-success' : type === 'error' ? 'alert-error' : 'alert-info';
  getAppEvents().publish({ type: eventType, payload: [title, ...(message ? [message] : [])] });
}

export interface BlockEditorProps {
  /** Initial guide to load */
  initialGuide?: JsonGuide;
  /** Called when guide changes */
  onChange?: (guide: JsonGuide) => void;
  /** Called when copy to clipboard is requested */
  onCopy?: (json: string) => void;
  /** Called when download is requested */
  onDownload?: (guide: JsonGuide) => void;
}

/**
 * Block-based JSON guide editor
 */
/**
 * Inner component that uses the context.
 * Separated from the provider wrapper for clean hook usage.
 */
function BlockEditorInner({ initialGuide, onChange, onCopy, onDownload }: BlockEditorProps) {
  const styles = useStyles2(getBlockEditorStyles);
  const editor = useBlockEditor({ initialGuide, onChange });
  const hasLoadedFromStorage = useRef(false);

  // Block editor context - replaces window globals for section/conditional editing
  const { sectionContext, conditionalContext } = useBlockEditorContext();

  // Modal state - useModalManager handles metadata, newGuideConfirm, import, githubPr, tour
  const modals = useModalManager();

  // Block form state - manages form modal and editing context
  const formState = useBlockFormState();
  const {
    isBlockFormOpen,
    editingBlockType,
    editingBlock,
    insertAtIndex,
    editingNestedBlock,
    editingConditionalBranchBlock,
  } = formState;

  // Recording state - pure state layer (no persistence dependencies)
  const recordingState = useRecordingState();
  const { recordingIntoSection, recordingIntoConditionalBranch, recordingStartUrl } = recordingState;
  // Multi-step grouping toggle for section recording
  const [isSectionMultiStepGroupingEnabled, setIsSectionMultiStepGroupingEnabled] = useState(true);

  // Block selection mode state (for merging blocks)
  const selection = useBlockSelection();

  // Backend availability — read once from boot-time feature toggles
  const backendAvailable = isBackendApiAvailable();

  // Backend guides management
  const backendGuides = useBackendGuides();
  // undefined = not yet initialised (waiting for localStorage restore); null = no linked guide
  const [currentGuideResourceName, setCurrentGuideResourceName] = useState<string | null | undefined>(undefined);
  const [currentGuideMetadata, setCurrentGuideMetadata] = useState<any>(null);
  const [currentGuideBackendStatus, setCurrentGuideBackendStatus] = useState<'draft' | 'published' | null>(null);
  const [isGuideLibraryOpen, setIsGuideLibraryOpen] = useState(false);
  const [lastPublishedJson, setLastPublishedJson] = useState<string | null>(null);

  // Derived unified backend publish status — available throughout the component
  const publishedStatus: 'not-saved' | 'draft' | 'published' = !currentGuideResourceName
    ? 'not-saved'
    : currentGuideBackendStatus === 'published'
      ? 'published'
      : 'draft';

  // Notification modals state
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string | React.ReactNode;
    variant?: 'primary' | 'destructive';
    onConfirm: () => void;
    onCancel?: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  // REACT: memoize excludeSelectors to prevent effect re-runs on every render (R3)
  const excludeSelectors = useMemo(
    () => [
      '[class*="debug"]',
      '.context-container',
      '[data-devtools-panel]',
      '[data-block-editor]',
      '[data-testid="block-editor"]',
      '[data-record-overlay]', // Stop recording button and overlay elements
    ],
    []
  );

  // Action recorder for section recording
  const actionRecorder = useActionRecorder({
    excludeSelectors,
    enableModalDetection: isSectionMultiStepGroupingEnabled,
  });

  // Callback to restore recording state after page refresh
  const handleRestoreRecordingState = useCallback(
    (state: PersistedRecordingState) => {
      // Restore the recording context using the state hook's restore method
      recordingState.restore({
        recordingIntoSection: state.recordingIntoSection,
        recordingIntoConditionalBranch: state.recordingIntoConditionalBranch,
        recordingStartUrl: state.recordingStartUrl,
      });

      // Restore recorded steps and resume recording
      if (state.recordedSteps.length > 0) {
        actionRecorder.setRecordedSteps(state.recordedSteps);
      }

      // Resume recording if there was an active recording session
      if (state.recordingIntoSection || state.recordingIntoConditionalBranch) {
        actionRecorder.startRecording();
      }
    },
    [recordingState, actionRecorder]
  );

  // Recording state persistence - survives page refreshes
  const recordingPersistence = useRecordingPersistence({
    recordingIntoSection,
    recordingIntoConditionalBranch,
    recordingStartUrl,
    recordedSteps: actionRecorder.recordedSteps,
    onRestore: handleRestoreRecordingState,
  });

  // Recording actions - third layer that uses state and persistence
  const recordingActions = useRecordingActions({
    state: recordingState,
    actionRecorder,
    editor: {
      addBlock: editor.addBlock,
      addBlockToSection: editor.addBlockToSection,
      addBlockToConditionalBranch: editor.addBlockToConditionalBranch,
    },
    onClear: recordingPersistence.clear,
  });

  // JSON mode handlers - extracted hook for JSON editing
  const jsonMode = useJsonModeHandlers({
    editor,
    recordingIntoSection,
    recordingIntoConditionalBranch,
    onStopRecording: recordingActions.stopRecording,
    onClearSelection: selection.clearSelection,
    isSelectionMode: selection.isSelectionMode,
  });

  // Block conversion handlers - extracted hook for type conversions
  const conversionHandlers = useBlockConversionHandlers({
    editor,
    formState,
  });

  // Create BlockOperations for child components
  // REACT: memoize object dependencies (R3)
  const blockOperations: BlockOperations = useMemo(
    () => ({
      // Root block CRUD
      onBlockEdit: formState.openEditBlockForm,
      onBlockDelete: editor.removeBlock,
      onBlockMove: editor.moveBlock,
      onBlockDuplicate: editor.duplicateBlock,
      onInsertBlock: formState.openNewBlockForm,

      // Section nesting
      onNestBlock: editor.nestBlockInSection,
      onUnnestBlock: editor.unnestBlockFromSection,
      onInsertBlockInSection: formState.openNestedBlockForm,
      onNestedBlockEdit: formState.openEditNestedBlockForm,
      onNestedBlockDelete: editor.deleteNestedBlock,
      onNestedBlockDuplicate: editor.duplicateNestedBlock,
      onNestedBlockMove: editor.moveNestedBlock,

      // Conditional branch operations
      onInsertBlockInConditional: formState.openConditionalBlockForm,
      onConditionalBranchBlockEdit: formState.openEditConditionalBlockForm,
      onConditionalBranchBlockDelete: editor.deleteConditionalBranchBlock,
      onConditionalBranchBlockDuplicate: editor.duplicateConditionalBranchBlock,
      onConditionalBranchBlockMove: editor.moveConditionalBranchBlock,
      onNestBlockInConditional: editor.nestBlockInConditional,
      onUnnestBlockFromConditional: editor.unnestBlockFromConditional,
      onMoveBlockBetweenConditionalBranches: editor.moveBlockBetweenConditionalBranches,

      // Cross-container moves
      onMoveBlockBetweenSections: editor.moveBlockBetweenSections,

      // Selection state
      isSelectionMode: selection.isSelectionMode,
      selectedBlockIds: selection.selectedBlockIds,
      onToggleBlockSelection: selection.toggleBlockSelection,

      // Recording state
      recordingIntoSection,
      recordingIntoConditionalBranch,
      onSectionRecord: recordingActions.toggleSectionRecording,
      onConditionalBranchRecord: recordingActions.toggleConditionalRecording,
    }),
    [formState, editor, selection, recordingIntoSection, recordingIntoConditionalBranch, recordingActions]
  );

  // Memoized callback for persistence save - prevents unnecessary effect triggers
  const handlePersistenceSave = useCallback(() => {
    editor.markSaved();
  }, [editor]);

  // Persistence - auto-save and restore from localStorage
  // Auto-save is paused while block form modal is open to avoid saving on every keystroke
  const persistence = useBlockPersistence({
    guide: editor.getGuide(),
    blockIds: editor.state.blocks.map((b) => b.id), // Store block IDs to preserve across refreshes
    autoSave: true,
    autoSavePaused: isBlockFormOpen,
    onLoad: (savedGuide, savedBlockIds) => {
      // Only load once on initial mount
      if (!hasLoadedFromStorage.current && !initialGuide) {
        hasLoadedFromStorage.current = true;
        // Pass savedBlockIds to preserve IDs (important for recording persistence)
        editor.loadGuide(savedGuide, savedBlockIds);
        editor.markSaved(); // Don't mark as dirty after loading
      }
    },
    onSave: handlePersistenceSave,
  });

  // Load from localStorage on mount (if no initialGuide provided)
  useEffect(() => {
    if (!hasLoadedFromStorage.current && !initialGuide && persistence.hasSavedGuide()) {
      const saved = persistence.load();
      if (saved) {
        hasLoadedFromStorage.current = true;
        editor.loadGuide(saved);
        editor.markSaved();
      }
    }
  }, [initialGuide, persistence, editor]);

  // Clear backend tracking when starting a new guide
  const handleClearBackendTracking = useCallback(() => {
    setCurrentGuideResourceName(null);
    setCurrentGuideMetadata(null);
    setCurrentGuideBackendStatus(null);
    setLastPublishedJson(null);
  }, []);

  // Restore backend tracking state from localStorage on mount.
  // Always transitions currentGuideResourceName out of undefined (to string or null) so the
  // persist effect knows initialisation is complete and won't accidentally delete the stored key.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(BACKEND_TRACKING_STORAGE_KEY);
      if (stored) {
        const { resourceName, backendStatus, lastPublishedJson: storedJson } = JSON.parse(stored);
        if (resourceName) {
          setCurrentGuideResourceName(resourceName);
          setCurrentGuideBackendStatus(backendStatus ?? 'draft');
          setLastPublishedJson(storedJson ?? null);
          return;
        }
      }
    } catch {
      // ignore malformed data
    }
    setCurrentGuideResourceName(null); // nothing to restore — mark as initialised
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist backend tracking state to localStorage whenever it changes.
  // Skip while undefined (restore hasn't run yet) to avoid deleting the stored key on mount.
  useEffect(() => {
    if (currentGuideResourceName === undefined) {
      return;
    }
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

  // When backend guides load and we have a tracked resource name but no metadata yet
  // (e.g. after a page refresh), populate currentGuideMetadata from the fetched list.
  // metadata.resourceVersion can't be persisted since it changes on every save.
  useEffect(() => {
    if (currentGuideResourceName && !currentGuideMetadata && backendGuides.guides.length > 0) {
      const match = backendGuides.guides.find((g) => g.metadata.name === currentGuideResourceName);
      if (match) {
        setCurrentGuideMetadata(match.metadata);
        setCurrentGuideBackendStatus(match.spec.status ?? 'draft');
      }
    }
  }, [backendGuides.guides, currentGuideResourceName, currentGuideMetadata]);

  // Guide operations - extracted hook for copy/download/new/import/template
  const guideOps = useGuideOperations({
    editor,
    persistence,
    recordingPersistence,
    actionRecorder,
    recordingState,
    modals,
    onCopy,
    onDownload,
    onNewGuide: handleClearBackendTracking,
  });

  // Handle block type selection from palette
  const handleBlockTypeSelect = formState.openNewBlockForm;

  // Handle form cancel
  const handleBlockFormCancel = formState.closeBlockForm;

  // Recording handlers - delegate to recordingActions hook
  const handleStopRecording = recordingActions.stopRecording;

  // Handle "Add and Start Recording" for new sections
  // This combines form closing with recording start
  const handleSubmitAndStartRecording = useCallback(
    (block: JsonBlock) => {
      recordingActions.submitAndStartRecording(block, insertAtIndex);
      formState.closeBlockForm();
    },
    [recordingActions, insertAtIndex, formState]
  );

  // Merge handlers - use selection hook but need access to editor
  const handleMergeToMultistep = useCallback(() => {
    if (selection.selectedBlockIds.size < 2) {
      return;
    }
    editor.mergeBlocksToMultistep(Array.from(selection.selectedBlockIds));
    selection.clearSelection();
  }, [selection, editor]);

  const handleMergeToGuided = useCallback(() => {
    if (selection.selectedBlockIds.size < 2) {
      return;
    }
    editor.mergeBlocksToGuided(Array.from(selection.selectedBlockIds));
    selection.clearSelection();
  }, [selection, editor]);

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
      const generatedResourceName =
        resourceName ||
        (guide.id || guide.title)
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');

      if (!generatedResourceName || generatedResourceName.length === 0) {
        throw new Error('Guide title or ID must contain at least one alphanumeric character');
      }

      await backendGuides.saveGuide(guide, resourceName, metadata, status);

      // Track the content that was last synced to the backend
      setLastPublishedJson(JSON.stringify(guide));

      // Refresh to get the latest metadata (including updated resourceVersion)
      const updatedGuides = await backendGuides.refreshGuides();

      const savedGuide = updatedGuides.find((g) => g.metadata.name === generatedResourceName);
      if (savedGuide) {
        setCurrentGuideResourceName(savedGuide.metadata.name);
        setCurrentGuideMetadata(savedGuide.metadata);
        setCurrentGuideBackendStatus(savedGuide.spec.status ?? 'draft');
      } else {
        setCurrentGuideResourceName(generatedResourceName);
        setCurrentGuideMetadata(metadata);
        setCurrentGuideBackendStatus(status);
      }

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

        const resourceName =
          currentGuideResourceName ||
          (guide.id || guide.title)
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');

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
                title: 'Overwrite existing guide?',
                message: (
                  <>
                    <p>
                      A guide named <strong>&quot;{existingGuide.spec.title}&quot;</strong> ({resourceName}) already
                      exists.
                    </p>
                    <p>Do you want to overwrite it?</p>
                    <p style={{ marginTop: '16px', fontSize: '0.9em', color: '#888' }}>
                      Click Cancel to change your guide&apos;s title or ID to create a new guide instead.
                    </p>
                  </>
                ),
                variant: 'destructive',
                onConfirm: async () => {
                  setConfirmModal((prev) => ({ ...prev, isOpen: false }));
                  setCurrentGuideResourceName(existingGuide.metadata.name);
                  setCurrentGuideMetadata(existingGuide.metadata);
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
        console.error('[BlockEditor] Failed to save guide:', error);
        notify('error', 'Save failed', error instanceof Error ? error.message : 'Unknown error');
      }
    },
    [editor, backendGuides, currentGuideResourceName, currentGuideMetadata, performBackendSave]
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

      // Refresh metadata to get the latest resourceVersion
      const updatedGuides = await backendGuides.refreshGuides();
      const updatedGuide = updatedGuides.find((g) => g.metadata.name === currentGuideResourceName);
      if (updatedGuide) {
        setCurrentGuideMetadata(updatedGuide.metadata);
        setCurrentGuideBackendStatus('draft');
      } else {
        setCurrentGuideBackendStatus('draft');
      }
      // Keep lastPublishedJson set — guide content is unchanged, only status changed.
      // This allows change detection to work correctly for the guide now in draft state.
      setLastPublishedJson(JSON.stringify(editor.getGuide()));
      notify('success', 'Guide unpublished.');
    } catch (error) {
      console.error('[BlockEditor] Failed to unpublish guide:', error);
      notify('error', 'Unpublish failed', error instanceof Error ? error.message : 'Unknown error');
    }
  }, [backendGuides, currentGuideResourceName, currentGuideMetadata]);

  // Publish/update guide to backend handler
  const handlePostToBackend = useCallback(async () => {
    await orchestrateSave('published');
  }, [orchestrateSave]);

  // Load guide from backend
  const handleLoadGuideFromBackend = useCallback(
    (guide: JsonGuide, resourceName: string, metadata: any, backendStatus: 'draft' | 'published') => {
      editor.loadGuide(guide);
      setCurrentGuideResourceName(resourceName);
      setCurrentGuideMetadata(metadata);
      setCurrentGuideBackendStatus(backendStatus);
      // Normalize to match getGuide() output (id, title, blocks — no schemaVersion or extra fields)
      setLastPublishedJson(JSON.stringify({ id: guide.id, title: guide.title, blocks: guide.blocks }));
      editor.markSaved();
    },
    [editor]
  );

  // Open guide library
  const handleOpenGuideLibrary = useCallback(() => {
    setIsGuideLibraryOpen(true);
    backendGuides.refreshGuides();
  }, [backendGuides]);

  // Handle new guide with smart warning logic
  const handleNewGuideClick = useCallback(() => {
    const currentGuide = editor.getGuide();
    const currentBlocks = currentGuide.blocks && currentGuide.blocks.length > 0;
    const currentGuideJson = JSON.stringify(currentGuide);
    const hasChanges =
      currentBlocks && // Has content
      (publishedStatus === 'not-saved' || // Either not saved to backend
        (publishedStatus === 'draft' && lastPublishedJson !== null && currentGuideJson !== lastPublishedJson) || // Or draft with changes
        (publishedStatus === 'published' && lastPublishedJson !== null && currentGuideJson !== lastPublishedJson)); // Or published with changes

    if (hasChanges) {
      // Show warning modal
      modals.open('newGuideConfirm');
    } else {
      // No changes to lose, just create new guide
      guideOps.handleNewGuide();
    }
  }, [editor, publishedStatus, lastPublishedJson, modals, guideOps]);

  // Close modals
  const closeConfirmModal = useCallback(() => {
    setConfirmModal((prev) => {
      const callback = prev.onCancel;
      setTimeout(() => callback?.(), 0);
      return { ...prev, isOpen: false };
    });
  }, []);

  // Modified form submit to handle section insertions, nested block edits, and conditional branch blocks
  const handleBlockFormSubmitWithSection = useCallback(
    (block: JsonBlock) => {
      if (editingConditionalBranchBlock) {
        // Editing a block within a conditional branch
        editor.updateConditionalBranchBlock(
          editingConditionalBranchBlock.conditionalId,
          editingConditionalBranchBlock.branch,
          editingConditionalBranchBlock.nestedIndex,
          block
        );
      } else if (editingNestedBlock) {
        // Editing a nested block in a section
        editor.updateNestedBlock(editingNestedBlock.sectionId, editingNestedBlock.nestedIndex, block);
      } else if (editingBlock) {
        editor.updateBlock(editingBlock.id, block);
      } else if (conditionalContext) {
        // Adding block to a conditional branch
        editor.addBlockToConditionalBranch(
          conditionalContext.conditionalId,
          conditionalContext.branch,
          block,
          conditionalContext.index
        );
      } else if (sectionContext) {
        editor.addBlockToSection(block, sectionContext.sectionId, sectionContext.index);
      } else {
        editor.addBlock(block, insertAtIndex);
      }
      // Close form and clear all editing state
      formState.closeBlockForm();
    },
    [
      editor,
      editingBlock,
      editingNestedBlock,
      editingConditionalBranchBlock,
      insertAtIndex,
      sectionContext,
      conditionalContext,
      formState,
    ]
  );

  const { state } = editor;
  const hasBlocks = state.blocks.length > 0;

  // hasUnsyncedChanges: local content differs from last backend save (draft or published)
  const currentJson = JSON.stringify(editor.getGuide());
  const hasUnsyncedChanges =
    publishedStatus !== 'not-saved' && lastPublishedJson !== null && currentJson !== lastPublishedJson;

  // ID is locked once it has been set (i.e. diverged from the default placeholder)
  const isIdLocked = state.guide.id !== DEFAULT_GUIDE_METADATA.id;

  const handleTitleCommit = useCallback(
    (title: string) => {
      editor.updateGuideMetadata({ title });
      if (!isIdLocked) {
        const existingNames = backendGuides.guides.map((g) => g.metadata.name);
        const newId = generateUniqueId(title, existingNames);
        editor.updateGuideMetadata({ id: newId });
      }
    },
    [editor, isIdLocked, backendGuides.guides]
  );

  return (
    <div className={styles.container} data-testid="block-editor">
      {/* Header */}
      <BlockEditorHeader
        guideTitle={state.guide.title}
        guideId={isIdLocked ? state.guide.id : null}
        isDirty={state.isDirty}
        publishedStatus={publishedStatus}
        hasUnsyncedChanges={hasUnsyncedChanges}
        viewMode={state.viewMode}
        onSetViewMode={jsonMode.handleViewModeChange}
        onTitleCommit={handleTitleCommit}
        onOpenTour={() => modals.open('tour')}
        onOpenGuideLibrary={handleOpenGuideLibrary}
        onOpenImport={() => modals.open('import')}
        onCopy={guideOps.handleCopy}
        onDownload={guideOps.handleDownload}
        onOpenGitHubPR={() => modals.open('githubPr')}
        onSaveDraft={performSaveDraft}
        onPostToBackend={handlePostToBackend}
        onUnpublish={performUnpublish}
        isPostingToBackend={backendGuides.isSaving}
        onNewGuide={handleNewGuideClick}
        isBackendAvailable={backendAvailable}
      />

      {/* Content */}
      <BlockEditorContent
        viewMode={state.viewMode}
        blocks={state.blocks}
        guide={editor.getGuide()}
        operations={blockOperations}
        hasBlocks={hasBlocks}
        styles={{
          content: styles.content,
          selectionControls: styles.selectionControls,
          selectionCount: styles.selectionCount,
          emptyState: styles.emptyState,
          emptyStateIcon: styles.emptyStateIcon,
          emptyStateText: styles.emptyStateText,
        }}
        onToggleSelectionMode={selection.toggleSelectionMode}
        onMergeToMultistep={handleMergeToMultistep}
        onMergeToGuided={handleMergeToGuided}
        onClearSelection={selection.clearSelection}
        onLoadTemplate={guideOps.handleLoadTemplate}
        onOpenTour={() => modals.open('tour')}
        // JSON mode props (Phase 4)
        jsonModeState={jsonMode.jsonModeState}
        onJsonChange={jsonMode.handleJsonChange}
        jsonValidationErrors={jsonMode.jsonValidationErrors}
        isJsonValid={jsonMode.isJsonValid}
        canJsonUndo={jsonMode.canUndo}
        onJsonUndo={jsonMode.handleJsonUndo}
      />

      {/* Footer with add block button (only in edit mode) */}
      <BlockEditorFooter viewMode={state.viewMode} onBlockTypeSelect={handleBlockTypeSelect} />

      {/* Modals */}
      <BlockEditorModals
        isModalOpen={modals.isOpen}
        closeModal={modals.close}
        guide={editor.getGuide()}
        isDirty={state.isDirty}
        hasBlocks={hasBlocks}
        onUpdateGuideMetadata={editor.updateGuideMetadata}
        onNewGuideConfirm={guideOps.handleNewGuide}
        onImportGuide={guideOps.handleImportGuide}
      />

      {/* Guide Library Modal */}
      <GuideLibraryModal
        isOpen={isGuideLibraryOpen}
        onClose={() => setIsGuideLibraryOpen(false)}
        guides={backendGuides.guides}
        isLoading={backendGuides.isLoading}
        error={backendGuides.error}
        onLoadGuide={handleLoadGuideFromBackend}
        onDeleteGuide={backendGuides.deleteGuide}
        onRefresh={backendGuides.refreshGuides}
      />

      {/* Block form modal - kept separate due to complex editing state dependencies */}
      {isBlockFormOpen && editingBlockType && (
        <BlockFormModal
          blockType={editingBlockType}
          initialData={editingConditionalBranchBlock?.block ?? editingNestedBlock?.block ?? editingBlock?.block}
          onSubmit={handleBlockFormSubmitWithSection}
          onSubmitAndRecord={editingBlockType === 'section' ? handleSubmitAndStartRecording : undefined}
          onCancel={handleBlockFormCancel}
          isEditing={!!editingBlock || !!editingNestedBlock || !!editingConditionalBranchBlock}
          onSplitToBlocks={
            (editingBlockType === 'multistep' || editingBlockType === 'guided') &&
            (editingBlock || editingNestedBlock || editingConditionalBranchBlock)
              ? conversionHandlers.handleSplitToBlocks
              : undefined
          }
          onConvertType={
            (editingBlockType === 'multistep' || editingBlockType === 'guided') &&
            (editingBlock || editingNestedBlock || editingConditionalBranchBlock)
              ? conversionHandlers.handleConvertType
              : undefined
          }
          onSwitchBlockType={
            editingBlock || editingNestedBlock || editingConditionalBranchBlock
              ? conversionHandlers.handleSwitchBlockType
              : undefined
          }
        />
      )}

      {/* Record mode overlay for section/conditional recording */}
      {(recordingIntoSection || recordingIntoConditionalBranch) && (
        <RecordModeOverlay
          isRecording={actionRecorder.isRecording}
          stepCount={actionRecorder.recordedSteps.length}
          onStop={handleStopRecording}
          sectionName={
            recordingIntoSection
              ? state.blocks.find((b) => b.id === recordingIntoSection)?.block.type === 'section'
                ? ((state.blocks.find((b) => b.id === recordingIntoSection)?.block as { title?: string }).title ??
                  'Section')
                : 'Section'
              : `Conditional branch (${recordingIntoConditionalBranch?.branch === 'whenTrue' ? 'pass' : 'fail'})`
          }
          startingUrl={recordingStartUrl ?? undefined}
          pendingMultiStepCount={actionRecorder.pendingGroupSteps.length}
          isGroupingMultiStep={actionRecorder.activeModal !== null}
          isMultiStepGroupingEnabled={isSectionMultiStepGroupingEnabled}
          onToggleMultiStepGrouping={() => setIsSectionMultiStepGroupingEnabled((prev) => !prev)}
        />
      )}

      {/* Notification Modals */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        variant={confirmModal.variant}
        onConfirm={confirmModal.onConfirm}
        onCancel={closeConfirmModal}
      />
    </div>
  );
}

/**
 * Block-based JSON guide editor with context provider.
 */
export function BlockEditor(props: BlockEditorProps) {
  return (
    <BlockEditorContextProvider>
      <BlockEditorInner {...props} />
    </BlockEditorContextProvider>
  );
}

// Add display name for debugging
BlockEditor.displayName = 'BlockEditor';
BlockEditorInner.displayName = 'BlockEditorInner';
