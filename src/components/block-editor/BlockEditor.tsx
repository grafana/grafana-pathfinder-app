/**
 * Block Editor
 *
 * Main component for the block-based JSON guide editor.
 * Provides a visual interface for composing guides from different block types.
 * State persists to localStorage automatically and survives page refreshes.
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useStyles2 } from '@grafana/ui';
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
import { getBlockEditorStyles } from './block-editor.styles';
import { BlockFormModal } from './BlockFormModal';
import { RecordModeOverlay } from './RecordModeOverlay';
import { useActionRecorder } from '../../utils/devtools';
import type { JsonGuide, JsonBlock, BlockOperations } from './types';
import { BlockEditorFooter } from './BlockEditorFooter';
import { BlockEditorHeader } from './BlockEditorHeader';
import { BlockEditorContent } from './BlockEditorContent';
import { BlockEditorModals } from './BlockEditorModals';
import { BlockEditorContextProvider, useBlockEditorContext } from './BlockEditorContext';

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

  return (
    <div className={styles.container} data-testid="block-editor">
      {/* Header */}
      <BlockEditorHeader
        guideTitle={state.guide.title}
        isDirty={state.isDirty}
        viewMode={state.viewMode}
        onSetViewMode={jsonMode.handleViewModeChange}
        onOpenMetadata={() => modals.open('metadata')}
        onOpenTour={() => modals.open('tour')}
        onOpenImport={() => modals.open('import')}
        onCopy={guideOps.handleCopy}
        onDownload={guideOps.handleDownload}
        onOpenGitHubPR={() => modals.open('githubPr')}
        onNewGuide={() => modals.open('newGuideConfirm')}
        styles={{
          header: styles.header,
          headerLeft: styles.headerLeft,
          headerRight: styles.headerRight,
          guideTitle: styles.guideTitle,
          viewModeToggle: styles.viewModeToggle,
        }}
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
