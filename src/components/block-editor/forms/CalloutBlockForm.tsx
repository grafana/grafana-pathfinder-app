/**
 * Callout Block Form
 *
 * Form for creating/editing callout blocks — a labeled, colored box for
 * calling out anything the author wants to set apart.
 */

import React, { useState, useCallback } from 'react';
import { Button, Field, Input, TextArea, useStyles2 } from '@grafana/ui';
import { getBlockFormStyles } from '../block-editor.styles';
import { TypeSwitchDropdown } from './TypeSwitchDropdown';
import { testIds } from '../../../constants/testIds';
import type { BlockFormProps, JsonBlock } from '../types';
import type { JsonCalloutBlock } from '../../../types/json-guide.types';

function isCalloutBlock(block: JsonBlock): block is JsonCalloutBlock {
  return block.type === 'callout';
}

/**
 * Callout block form component
 */
export function CalloutBlockForm({
  initialData,
  onSubmit,
  onCancel,
  isEditing = false,
  onSwitchBlockType,
}: BlockFormProps) {
  const styles = useStyles2(getBlockFormStyles);

  const initial = initialData && isCalloutBlock(initialData) ? initialData : null;
  const initialId = initial?.id;
  const initialAuthorNote = initial?.authorNote;
  const [title, setTitle] = useState(initial?.title ?? '');
  const [content, setContent] = useState(initial?.content ?? '');

  const handleSubmit = useCallback(
    (e: React.SubmitEvent) => {
      e.preventDefault();
      const block: JsonCalloutBlock = {
        type: 'callout',
        title: title.trim(),
        content: content.trim(),
        ...(initialId && { id: initialId }),
        ...(initialAuthorNote && { authorNote: initialAuthorNote }),
      };
      onSubmit(block);
    },
    [title, content, initialId, initialAuthorNote, onSubmit]
  );

  const isValid = title.trim().length > 0 && content.trim().length > 0;

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <Field label="Label" description="Shown at the top of the box, e.g. Objective" required>
        <Input
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          placeholder="Objective"
          autoFocus
          data-testid={testIds.blockEditor.calloutTitleInput}
        />
      </Field>

      <Field label="Content" description="Markdown body shown inside the callout" required>
        <TextArea
          value={content}
          onChange={(e) => setContent(e.currentTarget.value)}
          placeholder="In this section you will learn..."
          rows={3}
          data-testid={testIds.blockEditor.calloutContentInput}
        />
      </Field>

      <div className={styles.footer}>
        {isEditing && onSwitchBlockType && (
          <div className={styles.footerLeft}>
            <TypeSwitchDropdown currentType="callout" onSwitch={onSwitchBlockType} blockData={initialData} />
          </div>
        )}
        <Button variant="secondary" onClick={onCancel} type="button" data-testid={testIds.blockEditor.formCancelButton}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={!isValid} data-testid={testIds.blockEditor.submitButton}>
          {isEditing ? 'Update block' : 'Add block'}
        </Button>
      </div>
    </form>
  );
}

// Add display name for debugging
CalloutBlockForm.displayName = 'CalloutBlockForm';
