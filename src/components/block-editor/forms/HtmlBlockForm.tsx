/**
 * HTML Block Form
 *
 * Form for creating/editing raw HTML content blocks.
 */

import React, { useState, useCallback } from 'react';
import { Button, Field, TextArea, Alert, useStyles2 } from '@grafana/ui';
import { getBlockFormStyles } from '../block-editor.styles';
import { TypeSwitchDropdown } from './TypeSwitchDropdown';
import type { BlockFormProps, JsonBlock } from '../types';
import type { JsonHtmlBlock } from '../../../types/json-guide.types';

/**
 * Type guard for HTML blocks
 */
function isHtmlBlock(block: JsonBlock): block is JsonHtmlBlock {
  return block.type === 'html';
}

/**
 * HTML block form component
 */
export function HtmlBlockForm({
  initialData,
  onSubmit,
  onCancel,
  isEditing = false,
  onSwitchBlockType,
}: BlockFormProps) {
  const styles = useStyles2(getBlockFormStyles);

  // Initialize from existing data or defaults
  const initial = initialData && isHtmlBlock(initialData) ? initialData : null;
  const [content, setContent] = useState(initial?.content ?? '');

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const block: JsonHtmlBlock = {
        type: 'html',
        content: content.trim(),
      };
      onSubmit(block);
    },
    [content, onSubmit]
  );

  const isValid = content.trim().length > 0;

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <Alert title="HTML Content" severity="info">
        HTML content is sanitized before rendering to prevent XSS attacks. Prefer markdown blocks for new content - HTML
        blocks are mainly for migrating existing guides.
      </Alert>

      <Field label="HTML Content" description="Raw HTML that will be sanitized before display" required>
        <TextArea
          value={content}
          onChange={(e) => setContent(e.currentTarget.value)}
          rows={10}
          placeholder={`<div style="padding: 16px; background: rgba(50, 100, 150, 0.1); border-radius: 8px;">
  <p>Your <strong>HTML content</strong> here.</p>
  <ul>
    <li>Item 1</li>
    <li>Item 2</li>
  </ul>
</div>`}
          autoFocus
          style={{ fontFamily: 'monospace' }}
        />
      </Field>

      <div className={styles.footer}>
        {isEditing && onSwitchBlockType && (
          <div className={styles.footerLeft}>
            <TypeSwitchDropdown currentType="html" onSwitch={onSwitchBlockType} blockData={initialData} />
          </div>
        )}
        <Button variant="secondary" onClick={onCancel} type="button">
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={!isValid}>
          {isEditing ? 'Update block' : 'Add block'}
        </Button>
      </div>
    </form>
  );
}

// Add display name for debugging
HtmlBlockForm.displayName = 'HtmlBlockForm';
