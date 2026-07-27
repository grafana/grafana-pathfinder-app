import React from 'react';
import { Button, Dropdown, Menu, useStyles2 } from '@grafana/ui';
import type { ViewMode } from '../types';
import { testIds } from '../../../constants/testIds';
import { usePanelModeControls } from '../../../global-state/use-panel-mode';
import { getHeaderStyles } from './header.styles';

export interface HeaderKebabProps {
  /** Whether the Pathfinder backend API is available; gates publish shortcut + Library. */
  isBackendAvailable: boolean;
  /** Whether the guide Library entry should be offered. */
  hasBackendGuides: boolean;
  /** Backend publish status, drives the context-sensitive top menu item. */
  publishedStatus: 'not-saved' | 'draft' | 'published';
  /** Whether the guide has local changes not yet sent to the backend. */
  hasUnsyncedChanges: boolean;
  /** Whether a backend operation is in progress. */
  isPosting: boolean;
  /** Current view mode — the selection-mode item only shows in edit mode. */
  viewMode: ViewMode;
  /** Whether the guide has any blocks — gates the selection-mode item. */
  hasBlocks: boolean;
  /** Whether block-selection mode is currently active. */
  isSelectionMode: boolean;
  onToggleSelectionMode: () => void;
  onNewGuide: () => void;
  onOpenGuideLibrary: () => void;
  onOpenImport: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onOpenGitHubPR: () => void;
  onOpenTour: () => void;
  onPostToBackend: () => void;
  onUnpublish: () => void;
}

/**
 * "More actions" kebab menu: guide actions (New, Library, block selection), a
 * context-sensitive publish shortcut, view controls (pop out / dock, full
 * screen), and file actions (import, copy/download JSON, GitHub PR, tour).
 */
export function HeaderKebab({
  isBackendAvailable,
  hasBackendGuides,
  publishedStatus,
  hasUnsyncedChanges,
  isPosting,
  viewMode,
  hasBlocks,
  isSelectionMode,
  onToggleSelectionMode,
  onNewGuide,
  onOpenGuideLibrary,
  onOpenImport,
  onCopy,
  onDownload,
  onOpenGitHubPR,
  onOpenTour,
  onPostToBackend,
  onUnpublish,
}: HeaderKebabProps) {
  const styles = useStyles2(getHeaderStyles);

  const { panelMode, handleTogglePanelMode, handleGoFullScreen } = usePanelModeControls();

  // Context-sensitive publish/unpublish shortcut, rendered after the New/Library section.
  const moreMenuContextItem = () => {
    if (!isBackendAvailable) {
      return null;
    }
    if (publishedStatus === 'not-saved') {
      return <Menu.Item label="Publish" icon="cloud-upload" onClick={onPostToBackend} disabled={isPosting} />;
    }
    if (publishedStatus === 'draft' && hasUnsyncedChanges) {
      // Main save action is "Save" → offer "Publish" as a shortcut here
      return <Menu.Item label="Publish" icon="cloud-upload" onClick={onPostToBackend} disabled={isPosting} />;
    }
    if (publishedStatus === 'draft' && !hasUnsyncedChanges) {
      // Draft with no changes — nothing extra to show
      return null;
    }
    // published
    return (
      <Menu.Item
        label="Unpublish"
        icon="times-circle"
        onClick={onUnpublish}
        disabled={isPosting}
        testId={testIds.blockEditor.unpublishButton}
      />
    );
  };

  // The context item can return null (backend available, draft, no unsynced
  // changes) — gate its trailing divider on the item itself, not on backend
  // availability, to avoid an orphan double-divider.
  const contextItem = moreMenuContextItem();
  const showSelectionItem = viewMode === 'edit' && hasBlocks;
  const moreMenu = (
    <Menu>
      <Menu.Item label="New guide" icon="file-blank" onClick={onNewGuide} testId={testIds.blockEditor.newGuideButton} />
      {showSelectionItem && (
        <Menu.Item
          label={isSelectionMode ? 'Exit selection mode' : 'Select blocks for merging'}
          icon="check-square"
          onClick={onToggleSelectionMode}
          testId={testIds.blockEditor.toggleSelectionButton}
        />
      )}
      {isBackendAvailable && hasBackendGuides && (
        <Menu.Item
          label="Library"
          icon="book-open"
          onClick={onOpenGuideLibrary}
          testId={testIds.blockEditor.libraryButton}
        />
      )}
      <Menu.Divider />
      {contextItem}
      {contextItem && <Menu.Divider />}
      {/* Full screen is hidden when already fullscreen (the FullScreenLayout
          back-arrow handles the inverse). */}
      <Menu.Item
        label={panelMode === 'sidebar' ? 'Pop out' : 'Dock'}
        ariaLabel={panelMode === 'sidebar' ? 'Pop out editor' : 'Dock editor'}
        icon={panelMode === 'sidebar' ? 'corner-up-right' : 'corner-down-right-alt'}
        onClick={handleTogglePanelMode}
        testId="pathfinder-block-editor-toggle-popout"
      />
      {panelMode !== 'fullscreen' && (
        <Menu.Item
          label="Full screen"
          ariaLabel="Open editor in full screen"
          icon="expand-arrows"
          onClick={handleGoFullScreen}
          testId="pathfinder-block-editor-go-fullscreen"
        />
      )}
      <Menu.Divider />
      <Menu.Item label="Import" icon="upload" onClick={onOpenImport} />
      <Menu.Divider />
      <Menu.Item label="Copy JSON" icon="copy" onClick={onCopy} testId={testIds.blockEditor.copyJsonButton} />
      <Menu.Item label="Download JSON" icon="download-alt" onClick={onDownload} />
      <Menu.Item label="Create GitHub PR" icon="github" onClick={onOpenGitHubPR} />
      <Menu.Divider />
      <Menu.Item label="Take tour" icon="question-circle" onClick={onOpenTour} />
    </Menu>
  );

  return (
    <div className={styles.moreButton}>
      <Dropdown overlay={moreMenu} placement="bottom-end">
        <Button
          variant="secondary"
          size="sm"
          icon="ellipsis-v"
          tooltip="More actions"
          aria-label="More actions"
          data-testid={testIds.blockEditor.moreActionsButton}
        />
      </Dropdown>
    </div>
  );
}

HeaderKebab.displayName = 'HeaderKebab';
