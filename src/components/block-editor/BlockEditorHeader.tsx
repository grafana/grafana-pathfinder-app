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
  /** Whether the guide has been published to backend */
  isPublished: boolean;
  /** Whether published version is outdated (local changes not published) */
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
  /** Callback to POST guide to backend */
  onPostToBackend: () => void;
  /** Whether POST request is in progress */
  isPostingToBackend?: boolean;
  /** Callback to start new guide */
  onNewGuide: () => void;
  /** Whether there are blocks to select */
  hasBlocks?: boolean;
  /** Whether selection mode is active */
  isSelectionMode?: boolean;
  /** Callback to toggle selection mode */
  onToggleSelectionMode?: () => void;
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
  }),
  leftSection: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  centerSection: css({
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
  isPublished,
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
  onPostToBackend,
  isPostingToBackend = false,
  onNewGuide,
  hasBlocks = false,
  isSelectionMode = false,
  onToggleSelectionMode,
}: BlockEditorHeaderProps) {
  const styles = useStyles2(getHeaderStyles);

  // More menu for less-used actions
  const moreMenu = (
    <Menu>
      <Menu.Item label="Copy JSON" icon="copy" onClick={onCopy} />
      <Menu.Item label="Download JSON" icon="download-alt" onClick={onDownload} />
      <Menu.Item label="Create GitHub PR" icon="github" onClick={onOpenGitHubPR} />
      <Menu.Divider />
      <Menu.Item label="Take tour" icon="question-circle" onClick={onOpenTour} />
    </Menu>
  );

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

          {/* Publish status */}
          {!isPublished ? (
            <Tooltip content="Not yet published to backend">
              <Badge text="Draft" color="purple" icon="circle" />
            </Tooltip>
          ) : hasUnpublishedChanges ? (
            <Tooltip content="You have unpublished changes">
              <Badge text="Modified" color="orange" icon="exclamation-triangle" />
            </Tooltip>
          ) : (
            <Tooltip content="Published and up to date">
              <Badge text="Published" color="blue" icon="cloud-upload" />
            </Tooltip>
          )}
        </div>
      </div>

      {/* Toolbar Row: Tools and actions */}
      <div className={styles.toolbarRow}>
        {/* Left: File operations */}
        <div className={styles.leftSection}>
          <Button variant="secondary" size="sm" icon="file-blank" onClick={onNewGuide}>
            New
          </Button>
          <Button variant="secondary" size="sm" icon="book-open" onClick={onOpenGuideLibrary}>
            Library
          </Button>
          <Button variant="secondary" size="sm" icon="upload" onClick={onOpenImport}>
            Import
          </Button>
        </div>

        {/* Center: Empty for now */}
        <div className={styles.centerSection}></div>

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

          <div className={styles.divider} />

          <Button
            variant="primary"
            size="sm"
            icon="cloud-upload"
            onClick={onPostToBackend}
            disabled={isPostingToBackend}
            tooltip={isPublished ? 'Update published guide' : 'Publish to backend'}
            data-testid="post-to-backend-button"
          >
            {isPostingToBackend ? 'Publishing...' : isPublished ? 'Update' : 'Publish'}
          </Button>

          <div className={styles.moreButton}>
            <Dropdown overlay={moreMenu} placement="bottom-end">
              <Button variant="secondary" size="sm" icon="ellipsis-v" tooltip="More actions" />
            </Dropdown>
          </div>
        </div>
      </div>
    </div>
  );
}

BlockEditorHeader.displayName = 'BlockEditorHeader';
