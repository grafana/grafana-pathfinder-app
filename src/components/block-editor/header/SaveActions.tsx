import React from 'react';
import { Button, useStyles2 } from '@grafana/ui';
import { testIds } from '../../../constants/testIds';
import { getHeaderStyles } from './header.styles';

export interface SaveActionsProps {
  /**
   * Backend publish status:
   * - 'not-saved': guide exists only in localStorage
   * - 'draft': saved to library but not visible to users
   * - 'published': visible in docs panel Custom guides section
   */
  publishedStatus: 'not-saved' | 'draft' | 'published';
  /** Whether the guide (draft or published) has local changes not yet sent to the backend. */
  hasUnsyncedChanges: boolean;
  /** Whether a backend operation is in progress. */
  isPosting: boolean;
  /** Save the current guide as a draft (not visible to users). */
  onSaveDraft: () => void;
  /** Publish/update the guide (makes it visible to users). */
  onPostToBackend: () => void;
}

/**
 * Single smart primary action button whose label/variant follow the backend
 * publish state: Save as draft / Update draft / Publish / Update.
 */
export function SaveActions({
  publishedStatus,
  hasUnsyncedChanges,
  isPosting,
  onSaveDraft,
  onPostToBackend,
}: SaveActionsProps) {
  const styles = useStyles2(getHeaderStyles);

  if (publishedStatus === 'not-saved') {
    return (
      <Button
        variant="secondary"
        size="sm"
        icon="save"
        onClick={onSaveDraft}
        disabled={isPosting}
        tooltip="Save as draft without publishing"
        className={styles.collapsibleLabel}
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
          disabled={isPosting}
          tooltip="Save current changes to library draft"
          className={styles.collapsibleLabel}
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
        disabled={isPosting}
        tooltip="Publish and make visible to users"
        className={styles.collapsibleLabel}
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
      disabled={isPosting}
      tooltip="Save changes and keep published"
      className={styles.collapsibleLabel}
      data-testid={testIds.blockEditor.publishButton}
    >
      Update
    </Button>
  );
}

SaveActions.displayName = 'SaveActions';
