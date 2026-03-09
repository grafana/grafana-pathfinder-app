/**
 * BlockEditorHeader Component
 *
 * Header section of the block editor containing:
 * - Guide title, ID, and status indicators
 * - View mode toggle
 * - Import/export actions
 * - Publishing controls
 */

import React from 'react';
import { Button, Badge, ButtonGroup, Tooltip, Dropdown, Menu, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import type { ViewMode } from './types';

export interface BlockEditorHeaderProps {
  /** Guide title to display */
  guideTitle: string;
  /** Guide ID */
  guideId: string;
  /** Whether there are unsaved local changes */
  isDirty: boolean;
  /**
   * Backend publish status:
   * - 'not-saved': guide exists only in localStorage
   * - 'draft': saved to library but not visible to users
   * - 'published': visible in docs panel Custom guides section
   */
  publishedStatus: 'not-saved' | 'draft' | 'published';
  /** Whether a published guide has local changes not yet sent to the backend */
  hasUnpublishedChanges: boolean;
  /** Current view mode */
  viewMode: ViewMode;
  /** Callback to set view mode */
  onSetViewMode: (mode: ViewMode) => void;
  /** Callback to open metadata modal */
  onOpenMetadata: () => void;
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
    alignItems: 'baseline',
    gap: theme.spacing(1),
    minWidth: 0,
    flex: 1,
  }),
  guideTitle: css({
    fontSize: theme.typography.h5.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    margin: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
  guideId: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.fontFamilyMonospace,
    flexShrink: 0,
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
  hasUnpublishedChanges,
  viewMode,
  onSetViewMode,
  onOpenMetadata,
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

  // More menu for less-used actions
  const moreMenu = (
    <Menu>
      <Menu.Item label="Copy JSON" icon="copy" onClick={onCopy} data-testid="copy-json-button" />
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
      return (
        <Tooltip content="Saved to library but not published to users">
          <Badge text="Draft" color="purple" icon="circle" />
        </Tooltip>
      );
    }
    // published
    if (hasUnpublishedChanges) {
      return (
        <Tooltip content="Unpublished changes">
          <Badge text="Modified" color="orange" icon="exclamation-triangle" />
        </Tooltip>
      );
    }
    return (
      <Tooltip content="Published and visible to users">
        <Badge text="Published" color="blue" icon="cloud-upload" />
      </Tooltip>
    );
  };

  // Derive backend action buttons based on publishedStatus
  const backendButtons = () => {
    if (publishedStatus === 'not-saved') {
      return (
        <>
          <Button
            variant="secondary"
            size="sm"
            icon="save"
            onClick={onSaveDraft}
            disabled={isPostingToBackend}
            tooltip="Save to library without publishing"
            data-testid="save-draft-button"
          >
            Save to library
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon="cloud-upload"
            onClick={onPostToBackend}
            disabled={isPostingToBackend}
            tooltip="Publish and make visible to users"
            data-testid="post-to-backend-button"
          >
            {isPostingToBackend ? 'Publishing...' : 'Publish'}
          </Button>
        </>
      );
    }

    if (publishedStatus === 'draft') {
      return (
        <>
          <Button
            variant="secondary"
            size="sm"
            icon="save"
            onClick={onSaveDraft}
            disabled={isPostingToBackend}
            tooltip="Save current changes to library draft"
            data-testid="save-draft-button"
          >
            Update draft
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon="cloud-upload"
            onClick={onPostToBackend}
            disabled={isPostingToBackend}
            tooltip="Publish and make visible to users"
            data-testid="post-to-backend-button"
          >
            {isPostingToBackend ? 'Publishing...' : 'Publish'}
          </Button>
        </>
      );
    }

    // published (with or without local changes)
    return (
      <>
        <Button
          variant="secondary"
          size="sm"
          icon="times-circle"
          onClick={onUnpublish}
          disabled={isPostingToBackend}
          tooltip="Remove from docs panel; guide stays in library"
          data-testid="unpublish-button"
        >
          Unpublish
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon="cloud-upload"
          onClick={onPostToBackend}
          disabled={isPostingToBackend}
          tooltip="Save changes and keep published"
          data-testid="post-to-backend-button"
        >
          {isPostingToBackend ? 'Saving...' : 'Update'}
        </Button>
      </>
    );
  };

  return (
    <div className={styles.header}>
      {/* Top Row: Guide info and status */}
      <div className={styles.topRow}>
        <div className={styles.guideInfo}>
          <div className={styles.guideTitleContainer}>
            <h3 className={styles.guideTitle} title={guideTitle}>
              {guideTitle}
            </h3>
            <div className={styles.guideId}>({guideId})</div>
          </div>
          <Button
            variant="secondary"
            fill="text"
            size="sm"
            icon="cog"
            onClick={onOpenMetadata}
            tooltip="Guide settings"
            data-testid="guide-metadata-button"
          />
        </div>

        <div className={styles.statusBadges}>
          {/* Local save status */}
          {isDirty ? (
            <Tooltip content="Saving changes to local storage">
              <Badge text="Saving..." color="orange" icon="fa fa-spinner" />
            </Tooltip>
          ) : (
            <Tooltip content="All changes saved to local storage">
              <Badge text="Saved" color="green" icon="check" />
            </Tooltip>
          )}

          {/* Backend publish status — only meaningful when backend is available */}
          {isBackendAvailable && backendBadge()}
        </div>
      </div>

      {/* Toolbar Row: Tools and actions */}
      <div className={styles.toolbarRow}>
        {/* Left: File operations */}
        <div className={styles.leftSection}>
          <Button variant="secondary" size="sm" icon="file-blank" onClick={onNewGuide}>
            New
          </Button>
          {isBackendAvailable && (
            <Button variant="secondary" size="sm" icon="book-open" onClick={onOpenGuideLibrary}>
              Library
            </Button>
          )}
          <Button variant="secondary" size="sm" icon="upload" onClick={onOpenImport}>
            Import
          </Button>
        </div>

        {/* Right: View mode, publish, and more */}
        <div className={styles.rightSection}>
          <ButtonGroup data-testid="view-mode-toggle">
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
              {backendButtons()}
            </>
          )}

          <div className={styles.moreButton}>
            <Dropdown overlay={moreMenu} placement="bottom-end">
              <Button
                variant="secondary"
                size="sm"
                icon="ellipsis-v"
                tooltip="More actions"
                data-testid="more-actions-button"
              />
            </Dropdown>
          </div>
        </div>
      </div>
    </div>
  );
}

BlockEditorHeader.displayName = 'BlockEditorHeader';
