/**
 * Image Block Form
 *
 * Form for creating/editing image blocks.
 */

import React, { useState, useCallback } from 'react';
import { Button, Field, Input, Alert, useStyles2 } from '@grafana/ui';
import { getBlockFormStyles } from '../block-editor.styles';
import { TypeSwitchDropdown } from './TypeSwitchDropdown';
import { PLACEHOLDER_URL } from '../utils';
import type { BlockFormProps, JsonBlock } from '../types';
import type { JsonImageBlock } from '../../../types/json-guide.types';

/**
 * Type guard for image blocks
 */
function isImageBlock(block: JsonBlock): block is JsonImageBlock {
  return block.type === 'image';
}

/**
 * Image block form component
 */
export function ImageBlockForm({
  initialData,
  onSubmit,
  onCancel,
  isEditing = false,
  onSwitchBlockType,
}: BlockFormProps) {
  const styles = useStyles2(getBlockFormStyles);

  // Initialize from existing data or defaults
  // Clear placeholder URL so user sees an empty field to fill in
  const initial = initialData && isImageBlock(initialData) ? initialData : null;
  const initialSrc = initial?.src === PLACEHOLDER_URL ? '' : (initial?.src ?? '');
  const needsUrl = initial?.src === PLACEHOLDER_URL;
  const [src, setSrc] = useState(initialSrc);
  const [alt, setAlt] = useState(initial?.alt ?? '');
  const [width, setWidth] = useState(initial?.width?.toString() ?? '');
  const [height, setHeight] = useState(initial?.height?.toString() ?? '');

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const block: JsonImageBlock = {
        type: 'image',
        src: src.trim(),
        ...(alt.trim() && { alt: alt.trim() }),
        ...(width && { width: parseInt(width, 10) }),
        ...(height && { height: parseInt(height, 10) }),
      };
      onSubmit(block);
    },
    [src, alt, width, height, onSubmit]
  );

  const isValid = src.trim().length > 0;

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      {needsUrl && (
        <Alert title="Image URL required" severity="info">
          Please provide an image URL to complete this block.
        </Alert>
      )}

      <Field label="Image URL" description="Full URL to the image" required>
        <Input
          value={src}
          onChange={(e) => setSrc(e.currentTarget.value)}
          placeholder="https://example.com/image.png"
          autoFocus
        />
      </Field>

      <Field label="Alt Text" description="Accessibility description for the image">
        <Input value={alt} onChange={(e) => setAlt(e.currentTarget.value)} placeholder="Description of the image" />
      </Field>

      <div className={styles.row}>
        <Field label="Width" description="Display width in pixels (optional)">
          <Input
            type="number"
            value={width}
            onChange={(e) => setWidth(e.currentTarget.value)}
            placeholder="e.g., 400"
            min={1}
          />
        </Field>

        <Field label="Height" description="Display height in pixels (optional)">
          <Input
            type="number"
            value={height}
            onChange={(e) => setHeight(e.currentTarget.value)}
            placeholder="e.g., 300"
            min={1}
          />
        </Field>
      </div>

      {/* Preview */}
      {src && (
        <Field label="Preview">
          <div
            style={{
              maxWidth: width ? `${width}px` : '100%',
              maxHeight: '200px',
              overflow: 'hidden',
              borderRadius: '4px',
              border: '1px solid var(--border-weak)',
            }}
          >
            <img
              src={src}
              alt={alt || 'Preview'}
              style={{
                width: '100%',
                height: 'auto',
                display: 'block',
              }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        </Field>
      )}

      <div className={styles.footer}>
        {isEditing && onSwitchBlockType && (
          <div className={styles.footerLeft}>
            <TypeSwitchDropdown currentType="image" onSwitch={onSwitchBlockType} blockData={initialData} />
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
ImageBlockForm.displayName = 'ImageBlockForm';
