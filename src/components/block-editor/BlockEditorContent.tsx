/**
 * BlockEditorContent Component
 *
 * Main content area of the block editor containing:
 * - Selection controls for merge operations
 * - BlockList (edit mode) or BlockPreview (preview mode)
 * - Empty state for new guides
 */

import React from 'react';
import { Button } from '@grafana/ui';
import { BlockList } from './BlockList';
import { BlockPreview } from './BlockPreview';
import type { EditorBlock, BlockOperations, JsonGuide } from './types';

export interface BlockEditorContentProps {
  /** Whether in preview mode */
  isPreviewMode: boolean;
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
  };
  /** Selection mode toggle */
  onToggleSelectionMode: () => void;
  /** Merge handlers */
  onMergeToMultistep: () => void;
  onMergeToGuided: () => void;
  onClearSelection: () => void;
  /** Empty state actions */
  onLoadTemplate: () => void;
  onOpenTour: () => void;
}

export function BlockEditorContent({
  isPreviewMode,
  blocks,
  guide,
  operations,
  hasBlocks,
  styles,
  onToggleSelectionMode,
  onMergeToMultistep,
  onMergeToGuided,
  onClearSelection,
  onLoadTemplate,
  onOpenTour,
}: BlockEditorContentProps) {
  const { isSelectionMode, selectedBlockIds } = operations;
  const selectedCount = selectedBlockIds.size;

  return (
    <div className={styles.content} data-testid="block-editor-content">
      {/* Selection controls - shown in edit mode, above blocks */}
      {!isPreviewMode && hasBlocks && (
        <div className={styles.selectionControls}>
          {isSelectionMode && selectedCount >= 2 ? (
            <>
              <span className={styles.selectionCount}>{selectedCount} blocks selected</span>
              <Button variant="primary" size="sm" onClick={onMergeToMultistep}>
                Create multistep
              </Button>
              <Button variant="primary" size="sm" onClick={onMergeToGuided}>
                Create guided
              </Button>
              <Button variant="secondary" size="sm" onClick={onClearSelection}>
                Cancel
              </Button>
            </>
          ) : (
            <Button
              variant={isSelectionMode ? 'primary' : 'secondary'}
              size="sm"
              icon="check-square"
              onClick={onToggleSelectionMode}
              tooltip={
                isSelectionMode ? 'Click to exit selection mode' : 'Select blocks to merge into multistep/guided'
              }
            >
              {isSelectionMode ? 'Done selecting' : 'Select blocks'}
            </Button>
          )}
        </div>
      )}

      {isPreviewMode ? (
        <BlockPreview guide={guide} />
      ) : hasBlocks ? (
        <BlockList blocks={blocks} operations={operations} />
      ) : (
        <div className={styles.emptyState}>
          <div className={styles.emptyStateIcon}>📄</div>
          <p className={styles.emptyStateText}>Your guide is empty. Add your first block to get started.</p>
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <Button variant="secondary" onClick={onLoadTemplate} icon="file-alt">
              Load example guide
            </Button>
            <Button variant="secondary" onClick={onOpenTour} icon="question-circle">
              Take a tour
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

BlockEditorContent.displayName = 'BlockEditorContent';
