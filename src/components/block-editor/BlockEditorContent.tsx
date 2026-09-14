/**
 * BlockEditorContent Component
 *
 * Main content area of the block editor containing:
 * - Selection controls for merge and bulk-delete operations
 * - BlockList (edit mode) or BlockPreview (preview mode)
 * - Empty state for new guides
 */

import React from 'react';
import { Button } from '@grafana/ui';
import { BlockJsonEditor } from './BlockJsonEditor';
import { BlockList } from './BlockList';
import { BlockPreview } from './BlockPreview';
import { ConfirmModal } from './NotificationModals';
import type {
  EditorBlock,
  BlockType,
  BlockOperations,
  JsonGuide,
  ViewMode,
  JsonModeState,
  PositionedError,
  PreviewTarget,
} from './types';
import { testIds } from '../../constants/testIds';

export interface BlockEditorContentProps {
  /** Current view mode */
  viewMode: ViewMode;
  /** List of blocks */
  blocks: EditorBlock[];
  /** Full guide for preview mode */
  guide: JsonGuide;
  /** Consolidated block operations */
  operations: BlockOperations;
  /** Whether there are any blocks */
  hasBlocks: boolean;
  /** Style classes */
  styles: {
    content: string;
    selectionControls: string;
    selectionCount: string;
    emptyState: string;
    emptyStateIcon: string;
    emptyStateText: string;
    blockPreviewContainer: string;
  };
  /** Merge handlers */
  onMergeToMultistep: () => void;
  onMergeToGuided: () => void;
  /** Whether the current selection is eligible for merge. */
  canMergeSelection: boolean;
  /** Delete all selected blocks as one undoable operation. */
  onDeleteSelected: () => void;
  onClearSelection: () => void;
  /** Empty state actions */
  onLoadTemplate: () => void;
  onOpenTour: () => void;
  /** JSON mode state (present when in JSON editing mode) */
  jsonModeState: JsonModeState | null;
  /** Called when JSON text changes */
  onJsonChange: (json: string) => void;
  /** Validation errors for the current JSON */
  jsonValidationErrors: Array<string | PositionedError>;
  /** Whether the current JSON is valid */
  isJsonValid: boolean;
  /** Whether undo is available for JSON mode */
  canJsonUndo?: boolean;
  /** Called when user clicks the undo button in JSON mode */
  onJsonUndo?: () => void;
  /** Pinned block previews that stay visible until toggled off via the eye button */
  pinnedPreviews?: Array<{ target: PreviewTarget; guide: JsonGuide }>;
  /** Shared eligibility gate for preview affordances in block list rows. */
  canPreviewBlockType?: (type: BlockType) => boolean;
}

export function BlockEditorContent({
  viewMode,
  blocks,
  guide,
  operations,
  hasBlocks,
  styles,
  onMergeToMultistep,
  onMergeToGuided,
  canMergeSelection,
  onDeleteSelected,
  onClearSelection,
  onLoadTemplate,
  onOpenTour,
  jsonModeState,
  onJsonChange,
  jsonValidationErrors,
  isJsonValid,
  canJsonUndo,
  onJsonUndo,
  pinnedPreviews,
  canPreviewBlockType,
}: BlockEditorContentProps) {
  const { isSelectionMode, selectedBlockIds } = operations;
  const selectedCount = selectedBlockIds.size;
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = React.useState(false);
  const selectedLabel = `${selectedCount} block${selectedCount === 1 ? '' : 's'} selected`;
  const deleteLabel = `Delete ${selectedCount} block${selectedCount === 1 ? '' : 's'}`;

  return (
    <div className={styles.content} data-testid={testIds.blockEditor.content}>
      {/* Selection toolbar — only renders when selection mode is
          active. The trigger lives in BlockEditorHeader. */}
      {viewMode === 'edit' && hasBlocks && isSelectionMode && (
        <div className={styles.selectionControls}>
          {selectedCount >= 1 ? (
            <>
              <span className={styles.selectionCount}>{selectedLabel}</span>
              {selectedCount >= 2 ? (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={onMergeToMultistep}
                    disabled={!canMergeSelection}
                    title={!canMergeSelection ? 'Only mergeable blocks can be combined' : undefined}
                    data-testid={testIds.blockEditor.mergeMultistepButton}
                  >
                    Create multistep
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={onMergeToGuided}
                    disabled={!canMergeSelection}
                    title={!canMergeSelection ? 'Only mergeable blocks can be combined' : undefined}
                    data-testid={testIds.blockEditor.mergeGuidedButton}
                  >
                    Create guided
                  </Button>
                </>
              ) : (
                <span style={{ fontSize: '13px', color: '#888' }}>Select at least two mergeable blocks to merge.</span>
              )}
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setIsDeleteConfirmOpen(true)}
                data-testid={testIds.blockEditor.bulkDeleteButton}
              >
                {deleteLabel}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={onClearSelection}
                data-testid={testIds.blockEditor.clearSelectionButton}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <span className={styles.selectionCount}>{selectedLabel}</span>
              <span style={{ fontSize: '13px', color: '#888' }}>Select a block to merge or delete it.</span>
              <Button
                variant="secondary"
                size="sm"
                onClick={onClearSelection}
                data-testid={testIds.blockEditor.clearSelectionButton}
              >
                Cancel
              </Button>
            </>
          )}
        </div>
      )}

      <ConfirmModal
        isOpen={isDeleteConfirmOpen}
        title="Delete selected blocks"
        message={`Delete ${selectedCount} selected block${selectedCount === 1 ? '' : 's'}? You can undo this as one change.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={() => {
          onDeleteSelected();
          setIsDeleteConfirmOpen(false);
        }}
        onCancel={() => setIsDeleteConfirmOpen(false)}
      />

      {viewMode === 'json' && jsonModeState ? (
        <BlockJsonEditor
          jsonText={jsonModeState.json}
          onJsonChange={onJsonChange}
          validationErrors={jsonValidationErrors}
          isValid={isJsonValid}
          canUndo={canJsonUndo}
          onUndo={onJsonUndo}
        />
      ) : viewMode === 'preview' ? (
        // Header owns the "Reset guide" affordance in preview mode, so the
        // rendered guide stays free of editor chrome.
        <BlockPreview guide={guide} hideResetButton />
      ) : viewMode === 'edit' && hasBlocks ? (
        <>
          <BlockList
            blocks={blocks}
            operations={operations}
            pinnedPreviews={pinnedPreviews ?? []}
            previewClasses={{ container: styles.blockPreviewContainer }}
            canPreviewBlockType={canPreviewBlockType}
          />
        </>
      ) : viewMode === 'edit' ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyStateIcon}>📄</div>
          <p className={styles.emptyStateText}>Your guide is empty. Add your first block to get started.</p>
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <Button
              variant="secondary"
              onClick={onLoadTemplate}
              icon="file-alt"
              data-testid={testIds.blockEditor.loadTemplateButton}
            >
              Load example guide
            </Button>
            <Button
              variant="secondary"
              onClick={onOpenTour}
              icon="question-circle"
              data-testid={testIds.blockEditor.openTourButton}
            >
              Take a tour
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

BlockEditorContent.displayName = 'BlockEditorContent';
