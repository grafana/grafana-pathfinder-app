/**
 * BlockEditorHeader Component
 *
 * Header section of the block editor. Orchestrates the title row, view-mode
 * rocker, smart save action, and the "more actions" kebab (each extracted into
 * its own component under `header/`), plus the inline status and undo/redo
 * controls that live directly on the toolbar.
 */

import React from 'react';
import { Button, Badge, Icon, IconButton, Tooltip, useStyles2 } from '@grafana/ui';
import type { ViewMode } from './types';
import { testIds } from '../../constants/testIds';
import { getHeaderStyles } from './header/header.styles';
import { HeaderTitleRow } from './header/HeaderTitleRow';
import { ViewModeRocker } from './header/ViewModeRocker';
import { SaveActions } from './header/SaveActions';
import { HeaderKebab } from './header/HeaderKebab';

export interface BlockEditorHeaderProps {
  /** Guide title to display */
  guideTitle: string;
  /** Guide ID — null means not yet assigned (hides the ID display) */
  guideId: string | null;
  /** Whether there are unsaved local changes */
  isDirty: boolean;
  /**
   * Backend publish status:
   * - 'not-saved': guide exists only in localStorage
   * - 'draft': saved to library but not visible to users
   * - 'published': visible in docs panel Custom guides section
   */
  publishedStatus: 'not-saved' | 'draft' | 'published';
  /** Whether the guide (draft or published) has local changes not yet sent to the backend */
  hasUnsyncedChanges: boolean;
  /** Current view mode */
  viewMode: ViewMode;
  /** Callback to set view mode */
  onSetViewMode: (mode: ViewMode) => void;
  /** Callback when the guide title is committed (blur or Enter) */
  onTitleCommit: (title: string) => void;
  /** Callback to open tour */
  onOpenTour: () => void;
  /** Callback to open guide library */
  onOpenGuideLibrary: () => void;
  /** Callback to open import modal */
  onOpenImport: () => void;
  /** Callback to copy JSON to clipboard */
  onCopy: () => void;
  /** Callback to download JSON */
  onDownload: () => void;
  /** Callback to open GitHub PR modal */
  onOpenGitHubPR: () => void;
  /** Callback to save guide as draft (not visible to users) */
  onSaveDraft: () => void;
  /** Callback to publish/update the guide (makes it visible to users) */
  onPostToBackend: () => void;
  /** Callback to unpublish a published guide (sets back to draft) */
  onUnpublish: () => void;
  /** Whether a backend operation is in progress */
  isPostingToBackend?: boolean;
  /** Callback to start new guide */
  onNewGuide: () => void;
  /** Whether the Pathfinder backend API is available; hides Library and Publish controls when false */
  isBackendAvailable: boolean;
  /** Whether the guide Library entry should be offered (stays hidden until the user has a saved guide) */
  hasBackendGuides: boolean;
  /** Whether the guide has any blocks (drives selection-mode trigger visibility) */
  hasBlocks: boolean;
  /** Whether selection mode is currently active */
  isSelectionMode: boolean;
  /** Toggle selection mode on/off */
  onToggleSelectionMode: () => void;
  /**
   * Preview-mode reset action. Provided by the parent so the header can render
   * a "Reset guide" affordance in `viewMode === 'preview'` instead of having
   * the BlockPreview content area render its own button.
   */
  hasPreviewProgress?: boolean;
  onResetPreviewProgress?: () => void;
  /** Step backwards through the in-session undo history. */
  onUndo: () => void;
  /** Step forwards through the in-session redo history. */
  onRedo: () => void;
  /** True iff undo is available. */
  canUndo: boolean;
  /** True iff redo is available. */
  canRedo: boolean;
  /** Optional label for the next undo target — surfaced as the button tooltip. */
  undoLabel: string | null;
  /** Optional label for the next redo target — surfaced as the button tooltip. */
  redoLabel: string | null;
}

export function BlockEditorHeader({
  guideTitle,
  guideId,
  isDirty,
  publishedStatus,
  hasUnsyncedChanges,
  viewMode,
  onSetViewMode,
  onTitleCommit,
  onOpenTour,
  onOpenGuideLibrary,
  onOpenImport,
  onCopy,
  onDownload,
  onOpenGitHubPR,
  onSaveDraft,
  onPostToBackend,
  onUnpublish,
  isPostingToBackend = false,
  onNewGuide,
  isBackendAvailable,
  hasBackendGuides,
  hasBlocks,
  isSelectionMode,
  onToggleSelectionMode,
  hasPreviewProgress = false,
  onResetPreviewProgress,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  undoLabel,
  redoLabel,
}: BlockEditorHeaderProps) {
  const styles = useStyles2(getHeaderStyles);

  const backendBadge = () => {
    if (publishedStatus === 'not-saved') {
      return (
        <Tooltip content="Not yet saved to library">
          <Badge text="Draft" color="purple" icon="circle" />
        </Tooltip>
      );
    }
    if (publishedStatus === 'draft') {
      if (hasUnsyncedChanges) {
        return (
          <Tooltip content="Draft has unsaved changes">
            <Badge text="Draft (modified)" color="orange" icon="exclamation-triangle" />
          </Tooltip>
        );
      }
      return (
        <Tooltip content="Saved to library but not published to users">
          <Badge text="Draft" color="purple" icon="circle" />
        </Tooltip>
      );
    }
    if (hasUnsyncedChanges) {
      return (
        <Tooltip content="Published guide has unsaved changes">
          <Badge text="Published (modified)" color="orange" icon="exclamation-triangle" />
        </Tooltip>
      );
    }
    return (
      <Tooltip content="Published and visible to users">
        <Badge text="Published" color="blue" icon="cloud-upload" />
      </Tooltip>
    );
  };

  const localSaveIndicator = !isBackendAvailable && (
    <>
      {isDirty ? (
        <Tooltip content="Saving changes to local storage">
          <span className={styles.savingIndicator} aria-label="Saving">
            <Icon name="fa fa-spinner" size="sm" />
          </span>
        </Tooltip>
      ) : (
        <Tooltip content="All changes saved to local storage">
          <span className={styles.savedIndicator} aria-label="Saved">
            <Icon name="save" size="sm" />
          </span>
        </Tooltip>
      )}
    </>
  );

  const previewResetButton = viewMode === 'preview' && hasPreviewProgress && onResetPreviewProgress && (
    <Button
      variant="secondary"
      size="sm"
      icon="history-alt"
      onClick={onResetPreviewProgress}
      tooltip="Resets all interactive steps"
      data-testid={testIds.blockEditor.previewResetButton}
    >
      Reset guide
    </Button>
  );

  return (
    <div className={styles.header}>
      {/* Title row: editable title + guide id on the left, publish status on the
          right. In preview HeaderTitleRow renders a spacer instead of the input
          (the rendered guide shows its own <h1>), so the row stays put without
          duplicating the title. Fully hiding the row in preview is deferred to
          the title-row PR. */}
      <div className={styles.titleRow}>
        <HeaderTitleRow guideTitle={guideTitle} guideId={guideId} viewMode={viewMode} onTitleCommit={onTitleCommit} />
        <div className={styles.rightCluster}>
          {localSaveIndicator}
          {isBackendAvailable && backendBadge()}
        </div>
      </div>

      {/* Single-line — never wraps; the rocker and Save collapse to icons via
          the container-query tiers instead (see toolbarRow). */}
      <div className={styles.toolbarRow}>
        <ViewModeRocker viewMode={viewMode} onSetViewMode={onSetViewMode} />

        <div className={styles.rightCluster}>
          {/* "Reset guide" affordance, lifted out of the preview content area. */}
          {previewResetButton}

          {/* Undo / redo — edit mode only. Kept visible at all widths: there's no
              keyboard shortcut, so hiding them would strand the action. */}
          {viewMode === 'edit' && (
            <>
              <IconButton
                name="corner-up-left"
                size="sm"
                variant="secondary"
                onClick={onUndo}
                disabled={!canUndo}
                aria-label={undoLabel ? `Undo: ${undoLabel}` : 'Undo'}
                tooltip={undoLabel ? `Undo: ${undoLabel}` : 'Undo'}
                data-testid="pathfinder-block-editor-undo"
              />
              <IconButton
                name="corner-up-right"
                size="sm"
                variant="secondary"
                onClick={onRedo}
                disabled={!canRedo}
                aria-label={redoLabel ? `Redo: ${redoLabel}` : 'Redo'}
                tooltip={redoLabel ? `Redo: ${redoLabel}` : 'Redo'}
                data-testid="pathfinder-block-editor-redo"
              />
            </>
          )}

          {isBackendAvailable && (
            <SaveActions
              publishedStatus={publishedStatus}
              hasUnsyncedChanges={hasUnsyncedChanges}
              isPosting={isPostingToBackend}
              onSaveDraft={onSaveDraft}
              onPostToBackend={onPostToBackend}
            />
          )}

          <HeaderKebab
            isBackendAvailable={isBackendAvailable}
            hasBackendGuides={hasBackendGuides}
            publishedStatus={publishedStatus}
            hasUnsyncedChanges={hasUnsyncedChanges}
            isPosting={isPostingToBackend}
            viewMode={viewMode}
            hasBlocks={hasBlocks}
            isSelectionMode={isSelectionMode}
            onToggleSelectionMode={onToggleSelectionMode}
            onNewGuide={onNewGuide}
            onOpenGuideLibrary={onOpenGuideLibrary}
            onOpenImport={onOpenImport}
            onCopy={onCopy}
            onDownload={onDownload}
            onOpenGitHubPR={onOpenGitHubPR}
            onOpenTour={onOpenTour}
            onPostToBackend={onPostToBackend}
            onUnpublish={onUnpublish}
          />
        </div>
      </div>
    </div>
  );
}

BlockEditorHeader.displayName = 'BlockEditorHeader';
