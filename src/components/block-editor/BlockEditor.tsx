/**
 * Block Editor
 *
 * Main component for the block-based JSON guide editor.
 * Provides a visual interface for composing guides from different block types.
 * State persists to localStorage automatically and survives page refreshes.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Button, useStyles2, Badge, ButtonGroup, ConfirmModal } from '@grafana/ui';
import { useBlockEditor } from './hooks/useBlockEditor';
import { useBlockPersistence } from './hooks/useBlockPersistence';
import { getBlockEditorStyles } from './block-editor.styles';
import { GuideMetadataForm } from './GuideMetadataForm';
import { BlockPalette } from './BlockPalette';
import { BlockList } from './BlockList';
import { BlockPreview } from './BlockPreview';
import { BlockFormModal } from './BlockFormModal';
import { ImportGuideModal } from './ImportGuideModal';
import { RecordModeOverlay } from './RecordModeOverlay';
import { useActionRecorder } from '../wysiwyg-editor/devtools/action-recorder.hook';
import type { JsonGuide, BlockType, JsonBlock, EditorBlock } from './types';
import type { JsonInteractiveBlock } from '../../types/json-guide.types';

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
export function BlockEditor({ initialGuide, onChange, onCopy, onDownload }: BlockEditorProps) {
  const styles = useStyles2(getBlockEditorStyles);
  const editor = useBlockEditor({ initialGuide, onChange });
  const hasLoadedFromStorage = useRef(false);

  // Modal state - declared early so persistence can check if modal is open
  const [isMetadataOpen, setIsMetadataOpen] = useState(false);
  const [isBlockFormOpen, setIsBlockFormOpen] = useState(false);
  const [editingBlockType, setEditingBlockType] = useState<BlockType | null>(null);
  const [editingBlock, setEditingBlock] = useState<EditorBlock | null>(null);
  const [insertAtIndex, setInsertAtIndex] = useState<number | undefined>(undefined);
  const [isNewGuideConfirmOpen, setIsNewGuideConfirmOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  // State for editing nested blocks
  const [editingNestedBlock, setEditingNestedBlock] = useState<{
    sectionId: string;
    nestedIndex: number;
    block: JsonBlock;
  } | null>(null);

  // Section recording state
  const [recordingIntoSection, setRecordingIntoSection] = useState<string | null>(null);
  const pendingSectionIdRef = useRef<string | null>(null);

  // Block selection mode state (for merging blocks)
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(new Set());

  // Action recorder for section recording
  const actionRecorder = useActionRecorder({
    excludeSelectors: [
      '[class*="debug"]',
      '.context-container',
      '[data-devtools-panel]',
      '[data-block-editor]',
      '[data-testid="block-editor"]',
      '[data-record-overlay]', // Stop recording button and overlay elements
    ],
  });

  // Persistence - auto-save and restore from localStorage
  // Auto-save is paused while block form modal is open to avoid saving on every keystroke
  const persistence = useBlockPersistence({
    guide: editor.getGuide(),
    autoSave: true,
    autoSavePaused: isBlockFormOpen,
    onLoad: (savedGuide) => {
      // Only load once on initial mount
      if (!hasLoadedFromStorage.current && !initialGuide) {
        hasLoadedFromStorage.current = true;
        editor.loadGuide(savedGuide);
        editor.markSaved(); // Don't mark as dirty after loading
      }
    },
    onSave: () => {
      // Mark editor as saved after successful auto-save
      editor.markSaved();
    },
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

  // Handle block type selection from palette
  const handleBlockTypeSelect = useCallback((type: BlockType, index?: number) => {
    setEditingBlockType(type);
    setEditingBlock(null);
    setInsertAtIndex(index);
    setIsBlockFormOpen(true);
  }, []);

  // Handle block edit
  const handleBlockEdit = useCallback((block: EditorBlock) => {
    setEditingBlockType(block.block.type as BlockType);
    setEditingBlock(block);
    setInsertAtIndex(undefined);
    setIsBlockFormOpen(true);
  }, []);

  // Handle form cancel
  const handleBlockFormCancel = useCallback(() => {
    setIsBlockFormOpen(false);
    setEditingBlockType(null);
    setEditingBlock(null);
    setEditingNestedBlock(null);
    setInsertAtIndex(undefined);
    // Clear any section context
    delete (window as unknown as { __blockEditorSectionContext?: { sectionId: string; index?: number } })
      .__blockEditorSectionContext;
  }, []);

  // Handle copy to clipboard
  const handleCopy = useCallback(() => {
    const guide = editor.getGuide();
    const json = JSON.stringify(guide, null, 2);

    if (onCopy) {
      onCopy(json);
    } else {
      navigator.clipboard.writeText(json).then(() => {
        // Could add a toast notification here
        console.log('Copied to clipboard');
      });
    }
  }, [editor, onCopy]);

  // Handle download
  const handleDownload = useCallback(() => {
    const guide = editor.getGuide();

    if (onDownload) {
      onDownload(guide);
    } else {
      const json = JSON.stringify(guide, null, 2);
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      // Open in new window/tab
      const newWindow = window.open(url, '_blank');

      // Revoke URL after window loads to free memory
      if (newWindow) {
        newWindow.onload = () => {
          URL.revokeObjectURL(url);
        };
      } else {
        // If popup was blocked, revoke immediately
        URL.revokeObjectURL(url);
      }
    }
  }, [editor, onDownload]);

  // Handle new guide (reset and clear storage)
  const handleNewGuide = useCallback(() => {
    persistence.clear(); // Clear localStorage
    editor.resetGuide(); // Reset editor state
    setIsNewGuideConfirmOpen(false);
  }, [editor, persistence]);

  // Handle import guide
  const handleImportGuide = useCallback(
    (guide: JsonGuide) => {
      editor.loadGuide(guide);
      setIsImportModalOpen(false);
    },
    [editor]
  );

  // Handle nesting a block into a section
  const handleNestBlock = useCallback(
    (blockId: string, sectionId: string, insertIndex?: number) => {
      editor.nestBlockInSection(blockId, sectionId, insertIndex);
    },
    [editor]
  );

  // Handle unnesting a block from a section
  const handleUnnestBlock = useCallback(
    (nestedBlockId: string, sectionId: string) => {
      editor.unnestBlockFromSection(nestedBlockId, sectionId);
    },
    [editor]
  );

  // Handle inserting a block directly into a section
  const handleInsertBlockInSection = useCallback((type: BlockType, sectionId: string, index?: number) => {
    // Open the form modal for this block type, but target the section
    setEditingBlockType(type);
    setEditingBlock(null);
    // We'll need to handle section insertion differently
    // For now, store the section ID and handle in submit
    setInsertAtIndex(undefined);
    setIsBlockFormOpen(true);

    // Store section context for insertion
    (
      window as unknown as { __blockEditorSectionContext?: { sectionId: string; index?: number } }
    ).__blockEditorSectionContext = {
      sectionId,
      index,
    };
  }, []);

  // Handle editing a nested block
  const handleNestedBlockEdit = useCallback((sectionId: string, nestedIndex: number, block: JsonBlock) => {
    setEditingBlockType(block.type as BlockType);
    setEditingBlock(null);
    setEditingNestedBlock({ sectionId, nestedIndex, block });
    setInsertAtIndex(undefined);
    setIsBlockFormOpen(true);
  }, []);

  // Handle deleting a nested block
  const handleNestedBlockDelete = useCallback(
    (sectionId: string, nestedIndex: number) => {
      editor.deleteNestedBlock(sectionId, nestedIndex);
    },
    [editor]
  );

  // Handle duplicating a nested block
  const handleNestedBlockDuplicate = useCallback(
    (sectionId: string, nestedIndex: number) => {
      editor.duplicateNestedBlock(sectionId, nestedIndex);
    },
    [editor]
  );

  // Handle moving a nested block within its section
  const handleNestedBlockMove = useCallback(
    (sectionId: string, fromIndex: number, toIndex: number) => {
      editor.moveNestedBlock(sectionId, fromIndex, toIndex);
    },
    [editor]
  );

  // Handle section recording toggle
  const handleSectionRecord = useCallback(
    (sectionId: string) => {
      if (recordingIntoSection === sectionId) {
        // Stop recording - convert recorded steps to Interactive blocks and add to section
        actionRecorder.stopRecording();
        const steps = actionRecorder.recordedSteps;

        // Convert each recorded step to an Interactive block
        steps.forEach((step) => {
          const interactiveBlock: JsonInteractiveBlock = {
            type: 'interactive',
            action: step.action as JsonInteractiveBlock['action'],
            reftarget: step.selector,
            content: step.description || `${step.action} on element`,
            ...(step.value && { targetvalue: step.value }),
          };
          editor.addBlockToSection(interactiveBlock, sectionId);
        });

        actionRecorder.clearRecording();
        setRecordingIntoSection(null);
      } else {
        // Start recording into this section
        actionRecorder.clearRecording();
        actionRecorder.startRecording();
        setRecordingIntoSection(sectionId);
      }
    },
    [recordingIntoSection, actionRecorder, editor]
  );

  // Handle stop recording from overlay
  const handleStopRecording = useCallback(() => {
    if (recordingIntoSection) {
      handleSectionRecord(recordingIntoSection);
    }
  }, [recordingIntoSection, handleSectionRecord]);

  // Handle "Add and Start Recording" for new sections
  const handleSubmitAndStartRecording = useCallback(
    (block: JsonBlock) => {
      // Add the section block - returns the EditorBlock ID (UUID)
      const editorBlockId = editor.addBlock(block, insertAtIndex);
      setIsBlockFormOpen(false);
      setEditingBlockType(null);
      setEditingBlock(null);
      setInsertAtIndex(undefined);

      // Start recording into this section after a brief delay to allow UI to update
      pendingSectionIdRef.current = editorBlockId;
      setTimeout(() => {
        if (pendingSectionIdRef.current) {
          actionRecorder.clearRecording();
          actionRecorder.startRecording();
          setRecordingIntoSection(pendingSectionIdRef.current);
          pendingSectionIdRef.current = null;
        }
      }, 100);
    },
    [editor, insertAtIndex, actionRecorder]
  );

  // Selection mode handlers
  const handleToggleSelectionMode = useCallback(() => {
    setIsSelectionMode((prev) => {
      if (prev) {
        // Exiting selection mode - clear selection
        setSelectedBlockIds(new Set());
      }
      return !prev;
    });
  }, []);

  const handleToggleBlockSelection = useCallback((blockId: string) => {
    setSelectedBlockIds((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) {
        next.delete(blockId);
      } else {
        next.add(blockId);
      }
      return next;
    });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedBlockIds(new Set());
    setIsSelectionMode(false);
  }, []);

  const handleMergeToMultistep = useCallback(() => {
    if (selectedBlockIds.size < 2) {
      return;
    }
    editor.mergeBlocksToMultistep(Array.from(selectedBlockIds));
    setSelectedBlockIds(new Set());
    setIsSelectionMode(false);
  }, [selectedBlockIds, editor]);

  const handleMergeToGuided = useCallback(() => {
    if (selectedBlockIds.size < 2) {
      return;
    }
    editor.mergeBlocksToGuided(Array.from(selectedBlockIds));
    setSelectedBlockIds(new Set());
    setIsSelectionMode(false);
  }, [selectedBlockIds, editor]);

  // Modified form submit to handle section insertions and nested block edits
  const handleBlockFormSubmitWithSection = useCallback(
    (block: JsonBlock) => {
      const sectionContext = (
        window as unknown as { __blockEditorSectionContext?: { sectionId: string; index?: number } }
      ).__blockEditorSectionContext;

      if (editingNestedBlock) {
        // Editing a nested block
        editor.updateNestedBlock(editingNestedBlock.sectionId, editingNestedBlock.nestedIndex, block);
        setEditingNestedBlock(null);
      } else if (editingBlock) {
        editor.updateBlock(editingBlock.id, block);
      } else if (sectionContext) {
        editor.addBlockToSection(block, sectionContext.sectionId, sectionContext.index);
        delete (window as unknown as { __blockEditorSectionContext?: { sectionId: string; index?: number } })
          .__blockEditorSectionContext;
      } else {
        editor.addBlock(block, insertAtIndex);
      }
      setIsBlockFormOpen(false);
      setEditingBlockType(null);
      setEditingBlock(null);
      setInsertAtIndex(undefined);
    },
    [editor, editingBlock, editingNestedBlock, insertAtIndex]
  );

  const { state } = editor;
  const hasBlocks = state.blocks.length > 0;

  return (
    <div className={styles.container} data-testid="block-editor">
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h3 className={styles.guideTitle}>{state.guide.title}</h3>
          {state.isDirty ? (
            <Badge text="Auto-saving..." color="orange" icon="fa fa-spinner" />
          ) : (
            <Badge text="Saved" color="green" icon="check" />
          )}
          <Button
            variant="secondary"
            size="sm"
            icon="cog"
            onClick={() => setIsMetadataOpen(true)}
            tooltip="Edit guide settings"
          />
        </div>

        <div className={styles.headerRight}>
          {/* View mode toggle */}
          <ButtonGroup>
            <Button
              variant={!state.isPreviewMode ? 'primary' : 'secondary'}
              size="sm"
              icon="pen"
              onClick={() => editor.setPreviewMode(false)}
            >
              Edit
            </Button>
            <Button
              variant={state.isPreviewMode ? 'primary' : 'secondary'}
              size="sm"
              icon="eye"
              onClick={() => editor.setPreviewMode(true)}
            >
              Preview
            </Button>
          </ButtonGroup>

          {/* Selection mode toggle - only in edit mode */}
          {!state.isPreviewMode && (
            <Button
              variant={isSelectionMode ? 'primary' : 'secondary'}
              size="sm"
              icon="check-square"
              onClick={handleToggleSelectionMode}
              tooltip={isSelectionMode ? 'Done selecting (click to exit)' : 'Select blocks to merge into multistep/guided'}
            />
          )}

          {/* Import button */}
          <Button
            variant="secondary"
            size="sm"
            icon="upload"
            onClick={() => setIsImportModalOpen(true)}
            tooltip="Import JSON guide"
          />

          {/* Export actions */}
          <Button variant="secondary" size="sm" icon="copy" onClick={handleCopy} tooltip="Copy JSON to clipboard" />
          <Button
            variant="secondary"
            size="sm"
            icon="download-alt"
            onClick={handleDownload}
            tooltip="Download JSON file"
          />
          <Button
            variant="secondary"
            size="sm"
            icon="file-blank"
            onClick={() => setIsNewGuideConfirmOpen(true)}
            tooltip="Start new guide"
          />
        </div>
      </div>

      {/* Content */}
      <div className={styles.content}>
        {/* Selection action bar - shown at top when blocks are selected */}
        {isSelectionMode && selectedBlockIds.size >= 2 && (
          <div className={styles.selectionActionBar}>
            <span className={styles.selectionCount}>{selectedBlockIds.size} blocks selected</span>
            <Button variant="primary" size="sm" onClick={handleMergeToMultistep}>
              Create multistep
            </Button>
            <Button variant="primary" size="sm" onClick={handleMergeToGuided}>
              Create guided
            </Button>
            <Button variant="secondary" size="sm" onClick={handleClearSelection}>
              Cancel
            </Button>
          </div>
        )}

        {state.isPreviewMode ? (
          <BlockPreview guide={editor.getGuide()} />
        ) : hasBlocks ? (
          <BlockList
            blocks={state.blocks}
            onBlockEdit={handleBlockEdit}
            onBlockDelete={editor.removeBlock}
            onBlockMove={editor.moveBlock}
            onBlockDuplicate={editor.duplicateBlock}
            onInsertBlock={handleBlockTypeSelect}
            onNestBlock={handleNestBlock}
            onUnnestBlock={handleUnnestBlock}
            onInsertBlockInSection={handleInsertBlockInSection}
            onNestedBlockEdit={handleNestedBlockEdit}
            onNestedBlockDelete={handleNestedBlockDelete}
            onNestedBlockDuplicate={handleNestedBlockDuplicate}
            onNestedBlockMove={handleNestedBlockMove}
            onSectionRecord={handleSectionRecord}
            recordingIntoSection={recordingIntoSection}
            isSelectionMode={isSelectionMode}
            selectedBlockIds={selectedBlockIds}
            onToggleBlockSelection={handleToggleBlockSelection}
          />
        ) : (
          <div className={styles.emptyState}>
            <div className={styles.emptyStateIcon}>📄</div>
            <p className={styles.emptyStateText}>Your guide is empty. Add your first block to get started.</p>
          </div>
        )}
      </div>

      {/* Footer with add block button (only in edit mode) */}
      {!state.isPreviewMode && (
        <div className={styles.footer}>
          <BlockPalette onSelect={handleBlockTypeSelect} embedded />
        </div>
      )}

      {/* Modals */}
      <GuideMetadataForm
        isOpen={isMetadataOpen}
        guide={state.guide}
        onUpdate={editor.updateGuideMetadata}
        onClose={() => setIsMetadataOpen(false)}
      />

      {isBlockFormOpen && editingBlockType && (
        <BlockFormModal
          blockType={editingBlockType}
          initialData={editingNestedBlock?.block ?? editingBlock?.block}
          onSubmit={handleBlockFormSubmitWithSection}
          onSubmitAndRecord={editingBlockType === 'section' ? handleSubmitAndStartRecording : undefined}
          onCancel={handleBlockFormCancel}
          isEditing={!!editingBlock || !!editingNestedBlock}
        />
      )}

      <ConfirmModal
        isOpen={isNewGuideConfirmOpen}
        title="Start New Guide"
        body="Are you sure you want to start a new guide? Your current work will be deleted and cannot be recovered."
        confirmText="Start New"
        dismissText="Cancel"
        onConfirm={handleNewGuide}
        onDismiss={() => setIsNewGuideConfirmOpen(false)}
      />

      <ImportGuideModal
        isOpen={isImportModalOpen}
        onImport={handleImportGuide}
        onClose={() => setIsImportModalOpen(false)}
        hasUnsavedChanges={state.isDirty || state.blocks.length > 0}
      />

      {/* Record mode overlay for section recording */}
      {recordingIntoSection && (
        <RecordModeOverlay
          isRecording={actionRecorder.isRecording}
          stepCount={actionRecorder.recordedSteps.length}
          onStop={handleStopRecording}
          sectionName={
            state.blocks
              .find((b) => b.id === recordingIntoSection)
              ?.block.type === 'section'
              ? ((state.blocks.find((b) => b.id === recordingIntoSection)?.block as { title?: string }).title ??
                'Section')
              : 'Section'
          }
        />
      )}
    </div>
  );
}

// Add display name for debugging
BlockEditor.displayName = 'BlockEditor';
