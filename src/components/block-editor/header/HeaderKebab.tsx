import React from 'react';
import { Button, Dropdown, Menu, useStyles2 } from '@grafana/ui';
import { testIds } from '../../../constants/testIds';
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
 * "More actions" kebab menu for less-used editor actions (New, Library, Import,
 * Copy/Download JSON, GitHub PR, tour) plus a context-sensitive publish shortcut.
 */
export function HeaderKebab({
  isBackendAvailable,
  hasBackendGuides,
  publishedStatus,
  hasUnsyncedChanges,
  isPosting,
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

  // Context-sensitive item at the top of the more menu
  const moreMenuContextItem = () => {
    if (!isBackendAvailable) {
      return null;
    }
    if (publishedStatus === 'not-saved') {
      return <Menu.Item label="Publish" icon="cloud-upload" onClick={onPostToBackend} disabled={isPosting} />;
    }
    if (publishedStatus === 'draft' && hasUnsyncedChanges) {
      // Primary = "Update draft" → offer "Publish" as shortcut
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
        data-testid={testIds.blockEditor.unpublishButton}
      />
    );
  };

  // New + Library live here (moved from the toolbar) — both are infrequent and
  // "New" is destructive, so it's an improvement to guard them behind a menu.
  // The context item can return null (backend available, draft, no unsynced
  // changes) — gate its trailing divider on the item itself, not on backend
  // availability, to avoid an orphan double-divider.
  const contextItem = moreMenuContextItem();
  const moreMenu = (
    <Menu>
      <Menu.Item
        label="New guide"
        icon="file-blank"
        onClick={onNewGuide}
        data-testid={testIds.blockEditor.newGuideButton}
      />
      {isBackendAvailable && hasBackendGuides && (
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

  return (
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
  );
}

HeaderKebab.displayName = 'HeaderKebab';
