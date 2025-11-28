/**
 * Guide Metadata Form
 *
 * Form for editing guide id, title, and match metadata.
 */

import React, { useCallback } from 'react';
import { Button, Field, Input, Modal, TagsInput, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import type { BlockEditorState } from './types';

const getStyles = (theme: GrafanaTheme2) => ({
  form: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
  }),
  row: css({
    display: 'flex',
    gap: theme.spacing(2),
    '& > *': {
      flex: 1,
    },
  }),
  footer: css({
    display: 'flex',
    justifyContent: 'flex-end',
    gap: theme.spacing(1),
    paddingTop: theme.spacing(2),
    borderTop: `1px solid ${theme.colors.border.weak}`,
    marginTop: theme.spacing(1),
  }),
});

export interface GuideMetadataFormProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Current guide metadata */
  guide: BlockEditorState['guide'];
  /** Called when metadata changes */
  onUpdate: (updates: Partial<BlockEditorState['guide']>) => void;
  /** Called to close the modal */
  onClose: () => void;
}

export function GuideMetadataForm({ isOpen, guide, onUpdate, onClose }: GuideMetadataFormProps) {
  const styles = useStyles2(getStyles);

  const handleIdChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdate({ id: e.target.value });
    },
    [onUpdate]
  );

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdate({ title: e.target.value });
    },
    [onUpdate]
  );

  const handleUrlPrefixChange = useCallback(
    (tags: string[]) => {
      onUpdate({
        match: {
          ...guide.match,
          urlPrefix: tags,
        },
      });
    },
    [guide.match, onUpdate]
  );

  const handleTagsChange = useCallback(
    (tags: string[]) => {
      onUpdate({
        match: {
          ...guide.match,
          tags,
        },
      });
    },
    [guide.match, onUpdate]
  );

  return (
    <Modal title="Guide Settings" isOpen={isOpen} onDismiss={onClose}>
      <div className={styles.form}>
        <div className={styles.row}>
          <Field label="Guide ID" description="Unique identifier for this guide (kebab-case recommended)" required>
            <Input value={guide.id} onChange={handleIdChange} placeholder="my-guide-id" />
          </Field>
        </div>

        <Field label="Title" description="Display title shown to users" required>
          <Input value={guide.title} onChange={handleTitleChange} placeholder="My Guide Title" />
        </Field>

        <Field
          label="URL Prefixes"
          description="URL paths where this guide should be recommended (e.g., /dashboards, /explore)"
        >
          <TagsInput
            tags={guide.match?.urlPrefix ?? []}
            onChange={handleUrlPrefixChange}
            placeholder="Add URL prefix..."
          />
        </Field>

        <Field label="Tags" description="Tags for categorization and filtering">
          <TagsInput tags={guide.match?.tags ?? []} onChange={handleTagsChange} placeholder="Add tag..." />
        </Field>

        <div className={styles.footer}>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
