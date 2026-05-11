/**
 * BlockEditorHeader Component
 *
 * Header section of the block editor containing:
 * - Guide title, ID, and status indicators
 * - View mode toggle
 * - Import/export actions
 * - Publishing controls
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button, Badge, ButtonGroup, Icon, IconButton, Tooltip, Dropdown, Menu, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import type { ViewMode } from './types';
import { testIds } from '../../constants/testIds';
import { panelModeManager, type PanelMode } from '../../global-state/panel-mode';

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
  /** Whether the guide has any blocks (drives selection-mode trigger visibility) */
  hasBlocks: boolean;
  /** Whether selection mode is currently active */
  isSelectionMode: boolean;
  /** Toggle selection mode on/off */
  onToggleSelectionMode: () => void;
}

const getHeaderStyles = (theme: GrafanaTheme2) => ({
  // Sticky so the toolbar stays pinned to the top of the editor's scroll
  // container — same belt-and-braces approach used by the fullscreen layout
  // (`full-screen.styles.ts:stickyTopBar`). `flexShrink: 0` keeps it from
  // collapsing inside a flex parent.
  header: css({
    display: 'flex',
    flexDirection: 'column',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    backgroundColor: theme.colors.background.primary,
    position: 'sticky',
    top: 0,
    zIndex: theme.zIndex.navbarFixed,
    flexShrink: 0,
  }),
  // Single-row toolbar: title (flex 1) + actions cluster on the right.
  // `containerType: inline-size` lets the `@container` rule on `actions`
  // collapse button labels to icon-only when the row gets narrow. Wraps
  // to a second line when the cluster still doesn't fit.
  row: css({
    display: 'flex',
    alignItems: 'center',
    padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
    gap: theme.spacing(1),
    flexWrap: 'wrap',
    containerType: 'inline-size',
  }),
  // Title is guaranteed at least ~180px so the actions cluster has to wrap
  // to a new row when the row gets narrow, instead of crushing the title to
  // zero. The input inside still keeps `minWidth: 0 + flex: 1` so long
  // titles ellipsis within the reserved 180px rather than overflowing.
  titleArea: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    minWidth: 180,
    flex: '1 1 180px',
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
    minWidth: 0,
    flex: 1,
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
    flexShrink: 0,
  }),
  // Right-side action cluster.
  // - `marginLeft: auto` pushes the cluster to the right edge of the row,
  //   and — when the cluster wraps onto its own line — keeps it right-aligned
  //   on that line as well.
  // - `flexWrap` + `rowGap` let the buttons inside the cluster spill onto a
  //   second line once even the icon-only collapse can't keep them on one row.
  // - The `@container` rule fires off `row`'s `containerType: inline-size`
  //   (above): under 640px (sidebar / floating-panel widths) we hide each
  //   Grafana `Button`'s label `<span>` (rendered as a direct `<span class="content">`
  //   child of `<button>`) and tighten its horizontal padding so the buttons
  //   read as icon-only. The native tooltip / aria-label keeps them
  //   discoverable. Full-screen (>= 640px wide) keeps the labels.
  actions: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: theme.spacing(0.5),
    flexShrink: 0,
    flexWrap: 'wrap',
    rowGap: theme.spacing(0.5),
    marginLeft: 'auto',
    '@container (max-width: 640px)': {
      '& button > span': { display: 'none' },
      '& button': {
        paddingLeft: theme.spacing(0.75),
        paddingRight: theme.spacing(0.75),
      },
    },
  }),
  // Subtler "Saved" indicator (replaces the green chip) — small
  // check-circle icon. Tooltip preserved for context.
  savedIndicator: css({
    display: 'inline-flex',
    alignItems: 'center',
    color: theme.colors.success.text,
    flexShrink: 0,
  }),
  savingIndicator: css({
    display: 'inline-flex',
    alignItems: 'center',
    color: theme.colors.warning.text,
    flexShrink: 0,
  }),
  divider: css({
    width: '1px',
    height: '20px',
    backgroundColor: theme.colors.border.weak,
    margin: `0 ${theme.spacing(0.25)}`,
    flexShrink: 0,
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
  hasBlocks,
  isSelectionMode,
  onToggleSelectionMode,
}: BlockEditorHeaderProps) {
  const styles = useStyles2(getHeaderStyles);

  // Inline title editing
  const [titleDraft, setTitleDraft] = useState(guideTitle);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Track the current panel mode so the Pop out button can swap between
  // "Pop out" (sidebar) and "Dock" (floating) at runtime.
  const [panelMode, setPanelMode] = useState<PanelMode>(() => panelModeManager.getMode());
  useEffect(() => {
    const handleModeChange = (e: CustomEvent<{ mode: PanelMode }>) => {
      setPanelMode(e.detail.mode);
    };
    document.addEventListener('pathfinder-panel-mode-change', handleModeChange as EventListener);
    return () => {
      document.removeEventListener('pathfinder-panel-mode-change', handleModeChange as EventListener);
    };
  }, []);

  // Dispatch the same document-level events used by interactive popout steps.
  // The sidebar's docs-panel handler picks up pop-out for the editor tab; the
  // FloatingPanelManager handles dock requests.
  const handleTogglePanelMode = useCallback(() => {
    if (panelMode === 'sidebar') {
      document.dispatchEvent(new CustomEvent('pathfinder-request-pop-out'));
    } else {
      document.dispatchEvent(new CustomEvent('pathfinder-request-dock'));
    }
  }, [panelMode]);

  // Symmetric to docs-panel / FloatingPanelManager — both listen for this
  // event to swap the active surface to full screen.
  const handleGoFullScreen = useCallback(() => {
    document.dispatchEvent(new CustomEvent('pathfinder-request-full-screen'));
  }, []);

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

  // More menu for less-used actions. New + Library moved here (from
  // the toolbar) — both are infrequent and "New" is destructive, so
  // it's an improvement to guard them behind a menu.
  // Context item can return null (backend available, draft, no
  // unsynced changes) — gate its trailing divider on the item itself,
  // not on backend availability, to avoid an orphan double-divider.
  const contextItem = moreMenuContextItem();
  const moreMenu = (
    <Menu>
      <Menu.Item
        label="New guide"
        icon="file-blank"
        onClick={onNewGuide}
        data-testid={testIds.blockEditor.newGuideButton}
      />
      {isBackendAvailable && (
        <Menu.Item
          label="Library"
          icon="book-open"
          onClick={onOpenGuideLibrary}
          data-testid={testIds.blockEditor.libraryButton}
        />
      )}
      <Menu.Divider />
      {contextItem}
      {contextItem && <Menu.Divider />}
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
      {/* Single-row toolbar: title (flex 1) + actions on the right.
          New / Library moved into the kebab menu; selection-mode
          trigger is a small icon button next to the view-mode toggle. */}
      <div className={styles.row}>
        <div className={styles.titleArea}>
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

          {isBackendAvailable && renderBackendButton()}

          <Button
            variant="secondary"
            size="sm"
            icon={panelMode === 'sidebar' ? 'corner-up-right' : 'arrow-to-right'}
            onClick={handleTogglePanelMode}
            tooltip={
              panelMode === 'sidebar'
                ? 'Pop out the editor into a floating window'
                : 'Dock the editor back into the sidebar'
            }
            aria-label={panelMode === 'sidebar' ? 'Pop out editor' : 'Dock editor'}
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
              data-testid="pathfinder-block-editor-go-fullscreen"
            >
              Full screen
            </Button>
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
