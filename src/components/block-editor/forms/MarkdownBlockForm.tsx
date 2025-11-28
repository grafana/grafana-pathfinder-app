/**
 * Markdown Block Form
 *
 * Form for creating/editing markdown content blocks.
 */

import React, { useState, useCallback } from 'react';
import { Button, Field, TextArea, useStyles2 } from '@grafana/ui';
import { getBlockFormStyles } from '../block-editor.styles';
import type { BlockFormProps, JsonBlock } from '../types';
import type { JsonMarkdownBlock } from '../../../types/json-guide.types';

/**
 * Type guard for markdown blocks
 */
function isMarkdownBlock(block: JsonBlock): block is JsonMarkdownBlock {
  return block.type === 'markdown';
}

/**
 * Markdown block form component
 */
export function MarkdownBlockForm({ initialData, onSubmit, onCancel, isEditing = false }: BlockFormProps) {
  const styles = useStyles2(getBlockFormStyles);

  // Initialize from existing data or defaults
  const initial = initialData && isMarkdownBlock(initialData) ? initialData : null;
  const [content, setContent] = useState(initial?.content ?? '');

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const block: JsonMarkdownBlock = {
        type: 'markdown',
        content: content.trim(),
      };
      onSubmit(block);
    },
    [content, onSubmit]
  );

  const isValid = content.trim().length > 0;

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <Field
        label="Content"
        description="Markdown-formatted text. Supports headings, bold, italic, code, links, and lists."
        required
      >
        <TextArea
          value={content}
          onChange={(e) => setContent(e.currentTarget.value)}
          rows={12}
          placeholder={`# Heading

Write your **markdown** content here.

- List item 1
- List item 2

\`\`\`promql
rate(http_requests_total[5m])
\`\`\``}
          autoFocus
        />
      </Field>

      <div className={styles.helpText}>
        <strong>Tip:</strong> Use # for headings, **bold**, *italic*, `code`, and [links](url).
      </div>

      <div className={styles.footer}>
        <Button variant="secondary" onClick={onCancel} type="button">
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={!isValid}>
          {isEditing ? 'Update Block' : 'Add Block'}
        </Button>
      </div>
    </form>
  );
}

// Add display name for debugging
MarkdownBlockForm.displayName = 'MarkdownBlockForm';
