/**
 * BlockEditorHeader Component
 *
 * Header section of the block editor containing:
 * - Guide title, ID, and status indicators
 * - View mode toggle
 * - Import/export actions
 * - Publishing controls
 */

import React, { useState, useEffect, useRef } from 'react';
import { Button, Badge, ButtonGroup, Tooltip, Dropdown, Menu, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import type { ViewMode } from './types';
import { testIds } from '../../constants/testIds';

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
}

const getHeaderStyles = (theme: GrafanaTheme2) => ({
  header: css({
    display: 'flex',
    flexDirection: 'column',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    backgroundColor: theme.colors.background.primary,
  }),
  topRow: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${theme.spacing(1.5)} ${theme.spacing(2)} ${theme.spacing(1)}`,
    gap: theme.spacing(2),
    flexWrap: 'wrap',
  }),
  guideInfo: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    minWidth: 0,
    flex: 1,
  }),
  guideTitleContainer: css({
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    flex: 1,
    '&:hover .guide-id': {
      opacity: 1,
    },
  }),
  guideTitleInput: css({
    background: 'transparent',
    border: 'none',
    borderBottom: `1px solid transparent`,
    borderRadius: 0,
    color: theme.colors.text.primary,
    fontSize: theme.typography.h5.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    fontFamily: theme.typography.fontFamily,
    padding: '0 2px',
    margin: 0,
    outline: 'none',
    width: '100%',
    minWidth: 0,
    '&:hover': {
      borderBottomColor: theme.colors.border.medium,
    },
    '&:focus': {
      borderBottomColor: theme.colors.primary.main,
      background: theme.colors.background.secondary,
    },
  }),
  guideId: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.fontFamilyMonospace,
    opacity: 0,
    transition: 'opacity 0.15s',
    padding: '0 2px',
  }),
  statusBadges: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    flexShrink: 0,
  }),
  toolbarRow: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${theme.spacing(1)} ${theme.spacing(2)} ${theme.spacing(1.5)}`,
    gap: theme.spacing(2),
    flexWrap: 'wrap',
  }),
  leftSection: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  rightSection: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  divider: css({
    width: '1px',
    height: '20px',
    backgroundColor: theme.colors.border.weak,
    margin: `0 ${theme.spacing(0.5)}`,
  }),
  moreButton: css({
    '& > button': {
      padding: '4px 8px',
    },
  }),
});

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
}: BlockEditorHeaderProps) {
  const styles = useStyles2(getHeaderStyles);

  // Inline title editing
  const [titleDraft, setTitleDraft] = useState(guideTitle);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Keep draft in sync when title changes externally (e.g. guide loaded from library)
  useEffect(() => {
    setTitleDraft(guideTitle);
  }, [guideTitle]);

  const commitTitle = () => {
    const trimmed = titleDraft.trim();
    if (!trimmed) {
      setTitleDraft(guideTitle); // revert if cleared
      return;
    }
    if (trimmed !== guideTitle) {
      onTitleCommit(trimmed);
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      titleInputRef.current?.blur();
    } else if (e.key === 'Escape') {
      setTitleDraft(guideTitle);
      titleInputRef.current?.blur();
    }
  };

  // Context-sensitive item at the top of the more menu
  const moreMenuContextItem = () => {
    if (!isBackendAvailable) {
      return null;
    }
    if (publishedStatus === 'not-saved') {
      return <Menu.Item label="Publish" icon="cloud-upload" onClick={onPostToBackend} disabled={isPostingToBackend} />;
    }
    if (publishedStatus === 'draft' && hasUnsyncedChanges) {
      // Primary = "Update draft" → offer "Publish" as shortcut
      return <Menu.Item label="Publish" icon="cloud-upload" onClick={onPostToBackend} disabled={isPostingToBackend} />;
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
        disabled={isPostingToBackend}
        data-testid={testIds.blockEditor.unpublishButton}
      />
    );
  };

  // More menu for less-used actions
  const moreMenu = (
    <Menu>
      {moreMenuContextItem()}
      {isBackendAvailable && <Menu.Divider />}
      <Menu.Item label="Import" icon="upload" onClick={onOpenImport} />
      <Menu.Divider />
      <Menu.Item label="Copy JSON" icon="copy" onClick={onCopy} data-testid={testIds.blockEditor.copyJsonButton} />
      <Menu.Item label="Download JSON" icon="download-alt" onClick={onDownload} />
      <Menu.Item label="Create GitHub PR" icon="github" onClick={onOpenGitHubPR} />
      <Menu.Divider />
      <Menu.Item label="Take tour" icon="question-circle" onClick={onOpenTour} />
    </Menu>
  );

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

  // Single smart primary action button based on publishedStatus and hasUnsyncedChanges
  const renderBackendButton = () => {
    if (publishedStatus === 'not-saved') {
      return (
        <Button
          variant="secondary"
          size="sm"
          icon="save"
          onClick={onSaveDraft}
          disabled={isPostingToBackend}
          tooltip="Save as draft without publishing"
          data-testid={testIds.blockEditor.saveDraftButton}
        >
          Save as draft
        </Button>
      );
    }

    if (publishedStatus === 'draft') {
      if (hasUnsyncedChanges) {
        return (
          <Button
            variant="secondary"
            size="sm"
            icon="save"
            onClick={onSaveDraft}
            disabled={isPostingToBackend}
            tooltip="Save current changes to library draft"
            data-testid={testIds.blockEditor.saveDraftButton}
          >
            Update draft
          </Button>
        );
      }
      return (
        <Button
          variant="primary"
          size="sm"
          icon="cloud-upload"
          onClick={onPostToBackend}
          disabled={isPostingToBackend}
          tooltip="Publish and make visible to users"
          data-testid={testIds.blockEditor.publishButton}
        >
          Publish
        </Button>
      );
    }

    // published
    return (
      <Button
        variant="primary"
        size="sm"
        icon="cloud-upload"
        onClick={onPostToBackend}
        disabled={isPostingToBackend}
        tooltip="Save changes and keep published"
        data-testid={testIds.blockEditor.publishButton}
      >
        Update
      </Button>
    );
  };

  return (
    <div className={styles.header}>
      {/* Top Row: Guide info and status */}
      <div className={styles.topRow}>
        <div className={styles.guideInfo}>
          <div className={styles.guideTitleContainer}>
            <input
              ref={titleInputRef}
              className={styles.guideTitleInput}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={handleTitleKeyDown}
              aria-label="Guide title"
            />
            {guideId && <div className={`${styles.guideId} guide-id`}>({guideId})</div>}
          </div>
        </div>

        <div className={styles.statusBadges}>
          {/* Local save status — only shown when backend is unavailable */}
          {!isBackendAvailable &&
            (isDirty ? (
              <Tooltip content="Saving changes to local storage">
                <Badge text="Saving..." color="orange" icon="fa fa-spinner" />
              </Tooltip>
            ) : (
              <Tooltip content="All changes saved to local storage">
                <Badge text="Saved" color="green" icon="check" />
              </Tooltip>
            ))}

          {/* Backend publish status */}
          {isBackendAvailable && backendBadge()}
        </div>
      </div>

      {/* Toolbar Row: Tools and actions */}
      <div className={styles.toolbarRow}>
        {/* Left: New + Library */}
        <div className={styles.leftSection}>
          <Button
            variant="secondary"
            size="sm"
            icon="file-blank"
            onClick={onNewGuide}
            data-testid={testIds.blockEditor.newGuideButton}
          >
            New
          </Button>
          {isBackendAvailable && (
            <Button
              variant="secondary"
              size="sm"
              icon="book-open"
              onClick={onOpenGuideLibrary}
              data-testid={testIds.blockEditor.libraryButton}
            >
              Library
            </Button>
          )}
        </div>

        {/* Right: View mode, publish, and more */}
        <div className={styles.rightSection}>
          <ButtonGroup data-testid={testIds.blockEditor.viewModeToggle}>
            <Button
              variant={viewMode === 'edit' ? 'primary' : 'secondary'}
              size="sm"
              icon="pen"
              onClick={() => onSetViewMode('edit')}
              tooltip="Edit"
            />
            <Button
              variant={viewMode === 'preview' ? 'primary' : 'secondary'}
              size="sm"
              icon="eye"
              onClick={() => onSetViewMode('preview')}
              tooltip="Preview"
            />
            <Button
              variant={viewMode === 'json' ? 'primary' : 'secondary'}
              size="sm"
              icon="brackets-curly"
              onClick={() => onSetViewMode('json')}
              tooltip="JSON"
            />
          </ButtonGroup>

          {isBackendAvailable && (
            <>
              <div className={styles.divider} />
              {renderBackendButton()}
            </>
          )}

          <div className={styles.moreButton}>
            <Dropdown overlay={moreMenu} placement="bottom-end">
              <Button
                variant="secondary"
                size="sm"
                icon="ellipsis-v"
                tooltip="More actions"
                data-testid={testIds.blockEditor.moreActionsButton}
              />
            </Dropdown>
          </div>
        </div>
      </div>
    </div>
  );
}

BlockEditorHeader.displayName = 'BlockEditorHeader';
