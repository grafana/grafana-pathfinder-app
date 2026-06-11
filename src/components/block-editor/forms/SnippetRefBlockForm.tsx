/**
 * Snippet reference block form. The author picks a snippet; the block stores
 * only a reference, resolved to content at render time.
 */

import React, { useCallback, useState } from 'react';
import { Button, Field, Input, useStyles2 } from '@grafana/ui';
import { getBlockFormStyles } from '../block-editor.styles';
import type { BlockFormProps, JsonBlock } from '../types';
import type { JsonSnippetRefBlock } from '../../../types/json-guide.types';
import { SnippetPicker } from '../SnippetPicker';

function isSnippetRefBlock(block: JsonBlock): block is JsonSnippetRefBlock {
  return block.type === 'snippet-ref';
}

export function SnippetRefBlockForm({ initialData, onSubmit, onCancel, isEditing = false }: BlockFormProps) {
  const styles = useStyles2(getBlockFormStyles);
  const initial = initialData && isSnippetRefBlock(initialData) ? initialData : null;

  const [snippetId, setSnippetId] = useState(initial?.snippetId ?? '');
  const [authorNote, setAuthorNote] = useState(initial?.authorNote ?? '');

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmedId = snippetId.trim();
      if (!trimmedId) {
        return;
      }
      const block: JsonSnippetRefBlock = {
        type: 'snippet-ref',
        snippetId: trimmedId,
        ...(authorNote.trim() && { authorNote: authorNote.trim() }),
      };
      onSubmit(block);
    },
    [snippetId, authorNote, onSubmit]
  );

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <Field
        label="Snippet"
        description="Pick a published snippet to reference. The guide always renders the latest version."
        required
      >
        <SnippetPicker value={snippetId} onSelect={setSnippetId} />
      </Field>

      <Field
        label="Snippet ID"
        description="Set automatically when you pick a snippet above. Edit only if you know what you're doing."
      >
        <Input
          value={snippetId}
          onChange={(e) => setSnippetId(e.currentTarget.value)}
          placeholder="e.g. create-prometheus-ds"
        />
      </Field>

      <Field label="Author note (optional)" description="Editor-only — not shown to readers.">
        <Input value={authorNote} onChange={(e) => setAuthorNote(e.currentTarget.value)} placeholder="" />
      </Field>

      <div className={styles.footer}>
        <Button variant="secondary" onClick={onCancel} type="button">
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={!snippetId.trim()}>
          {isEditing ? 'Update reference' : 'Add reference'}
        </Button>
      </div>
    </form>
  );
}

SnippetRefBlockForm.displayName = 'SnippetRefBlockForm';
