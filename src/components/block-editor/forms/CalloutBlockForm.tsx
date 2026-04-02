/**
 * Callout Block Form
 *
 * Form for creating/editing callout blocks.
 * Follows the ImageBlockForm pattern.
 */

import React, { useState, useCallback } from 'react';
import { Button, Field, Input, TextArea, RadioButtonGroup, useStyles2 } from '@grafana/ui';
import { getBlockFormStyles } from '../block-editor.styles';
import { TypeSwitchDropdown } from './TypeSwitchDropdown';
import { testIds } from '../../../constants/testIds';
import type { BlockFormProps, JsonBlock } from '../types';
import type { JsonCalloutBlock } from '../../../types/json-guide.types';

/**
 * Type guard for callout blocks
 */
function isCalloutBlock(block: JsonBlock): block is JsonCalloutBlock {
  return block.type === 'callout';
}

const VARIANT_OPTIONS = [
  { label: 'ℹ️ Info', value: 'info' as const },
  { label: '⚠️ Warning', value: 'warning' as const },
  { label: '✅ Success', value: 'success' as const },
  { label: '❌ Error', value: 'error' as const },
];

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

  // Initialize from existing data or defaults
  const initial = initialData && isCalloutBlock(initialData) ? initialData : null;
  const [variant, setVariant] = useState<'info' | 'warning' | 'success' | 'error'>(initial?.variant ?? 'info');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [content, setContent] = useState(initial?.content ?? '');

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const block: JsonCalloutBlock = {
        type: 'callout',
        variant,
        content: content.trim(),
        ...(title.trim() && { title: title.trim() }),
      };
      onSubmit(block);
    },
    [variant, title, content, onSubmit]
  );

  const isValid = content.trim().length > 0;

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <Field label="Variant" description="Visual style of the callout">
        <RadioButtonGroup options={VARIANT_OPTIONS} value={variant} onChange={(v) => setVariant(v)} />
      </Field>

      <Field label="Title" description="Optional heading displayed at the top of the callout">
        <Input
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          placeholder="e.g., Watch out, Tip, Important"
        />
      </Field>

      <Field label="Content" description="Markdown body text for the callout" required>
        <TextArea
          value={content}
          onChange={(e) => setContent(e.currentTarget.value)}
          placeholder="Enter callout content (supports markdown)"
          rows={4}
          autoFocus
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
        <Button variant="primary" type="submit" disabled={!isValid}>
          {isEditing ? 'Update block' : 'Add block'}
        </Button>
      </div>
    </form>
  );
}

// Add display name for debugging
CalloutBlockForm.displayName = 'CalloutBlockForm';
