/**
 * BlockEditorHeader Component
 *
 * Header section of the block editor. Orchestrates the title row, view-mode
 * rocker, smart save action, and the "more actions" kebab (each extracted into
 * its own component under `header/`), plus the inline status/undo/redo/panel
 * controls that live directly on the toolbar.
 */

import React from 'react';
import { Button, Badge, Icon, IconButton, Tooltip, useStyles2 } from '@grafana/ui';
import type { ViewMode } from './types';
import { testIds } from '../../constants/testIds';
import { usePanelModeControls } from '../../global-state/use-panel-mode';
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

/**
 * Header component for the block editor.
 * Compact single-row design with better organization.
 */
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

  // Panel mode drives the Pop out / Dock swap and the full-screen affordance.
  const { panelMode, handleTogglePanelMode, handleGoFullScreen } = usePanelModeControls();

  // Derive backend status badge
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
    // published
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

  return (
    <div className={styles.header}>
      {/* Single-row toolbar: title (flex 1) + actions on the right.
          New / Library moved into the kebab menu; selection-mode
          trigger is a small icon button next to the view-mode toggle. */}
      <div className={styles.row}>
        <HeaderTitleRow guideTitle={guideTitle} guideId={guideId} viewMode={viewMode} onTitleCommit={onTitleCommit} />

        <div className={styles.actions}>
          {/* Local-save indicator — subtle icon (replaces the green
              chip). Only shown when backend isn't available. The icon
              is deliberately a floppy `save` so it doesn't visually
              clash with the `check-square` selection trigger that
              follows. */}
          {!isBackendAvailable &&
            (isDirty ? (
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
            ))}

          {/* Backend publish status — kept as a Badge since the
              Draft/Published distinction is genuinely informative. */}
          {isBackendAvailable && backendBadge()}

          {/* Preview-mode "Reset guide" trigger. Mirrors the affordance that
              previously lived inside the preview content area, but lifted into
              the header so the rendered guide stays free of editor chrome. */}
          {viewMode === 'preview' && hasPreviewProgress && onResetPreviewProgress && (
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
          )}

          {/* Selection-mode trigger — only meaningful in edit mode
              with at least one block. The preceding divider exists
              specifically to break the visual pairing between the
              status icon and this `check-square` button, so it only
              appears when the trigger does. */}
          {viewMode === 'edit' && hasBlocks && (
            <>
              <div className={styles.divider} />
              <IconButton
                name="check-square"
                size="sm"
                variant={isSelectionMode ? 'primary' : 'secondary'}
                onClick={onToggleSelectionMode}
                aria-label={isSelectionMode ? 'Exit selection mode' : 'Select blocks for merging'}
                tooltip={isSelectionMode ? 'Exit selection mode' : 'Select blocks for merging'}
                data-testid={testIds.blockEditor.toggleSelectionButton}
              />
            </>
          )}

          {/* Undo / redo for the in-session history ring buffer. The
              labels (when present) describe the next operation in the
              stack — useful for tooltip-driven discoverability. The
              `corner-up-left` / `corner-up-right` icons are the
              conventional curved-arrow glyphs every word processor /
              editor uses for undo/redo. */}
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

          <ViewModeRocker viewMode={viewMode} onSetViewMode={onSetViewMode} />

          {isBackendAvailable && (
            <SaveActions
              publishedStatus={publishedStatus}
              hasUnsyncedChanges={hasUnsyncedChanges}
              isPosting={isPostingToBackend}
              onSaveDraft={onSaveDraft}
              onPostToBackend={onPostToBackend}
            />
          )}

          <Button
            variant="secondary"
            size="sm"
            icon={panelMode === 'sidebar' ? 'corner-up-right' : 'corner-down-right-alt'}
            onClick={handleTogglePanelMode}
            tooltip={
              panelMode === 'sidebar'
                ? 'Pop out the editor into a floating window'
                : 'Dock the editor back into the sidebar'
            }
            aria-label={panelMode === 'sidebar' ? 'Pop out editor' : 'Dock editor'}
            className={styles.collapsibleLabel}
            data-testid="pathfinder-block-editor-toggle-popout"
          >
            {panelMode === 'sidebar' ? 'Pop out' : 'Dock'}
          </Button>

          {/* Full-screen affordance — hidden when already in fullscreen
              because the FullScreenLayout's back-arrow handles the inverse. */}
          {panelMode !== 'fullscreen' && (
            <Button
              variant="secondary"
              size="sm"
              icon="expand-arrows"
              onClick={handleGoFullScreen}
              tooltip="Open the editor in full screen"
              aria-label="Open editor in full screen"
              className={styles.collapsibleLabel}
              data-testid="pathfinder-block-editor-go-fullscreen"
            >
              Full screen
            </Button>
          )}

          <HeaderKebab
            isBackendAvailable={isBackendAvailable}
            hasBackendGuides={hasBackendGuides}
            publishedStatus={publishedStatus}
            hasUnsyncedChanges={hasUnsyncedChanges}
            isPosting={isPostingToBackend}
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
