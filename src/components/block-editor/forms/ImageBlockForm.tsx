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
import { testIds } from '../../../constants/testIds';
import type { BlockFormProps, JsonBlock } from '../types';
import type { JsonImageBlock } from '../../../types/json-guide.types';

/**
 * Type guard for image blocks
 */
function isImageBlock(block: JsonBlock): block is JsonImageBlock {
  return block.type === 'image';
}

function getImageUrlError(value: string): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return 'Enter an absolute http or https image URL';
    }
    return undefined;
  } catch {
    return 'Enter an absolute http or https image URL';
  }
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
  const [imageLoadError, setImageLoadError] = useState(false);

  const trimmedSrc = src.trim();
  const imageUrlError = getImageUrlError(trimmedSrc);
  const imageFieldError =
    imageUrlError ??
    (imageLoadError ? 'Unable to load image preview. Check that the URL points to an image.' : undefined);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!trimmedSrc || imageFieldError) {
        return;
      }

      const block: JsonImageBlock = {
        type: 'image',
        src: trimmedSrc,
        ...(alt.trim() && { alt: alt.trim() }),
        ...(width && { width: parseInt(width, 10) }),
        ...(height && { height: parseInt(height, 10) }),
      };
      onSubmit(block);
    },
    [trimmedSrc, imageFieldError, alt, width, height, onSubmit]
  );

  const isValid = trimmedSrc.length > 0 && !imageFieldError;

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      {needsUrl && (
        <Alert title="Image URL required" severity="info">
          Please provide an image URL to complete this block.
        </Alert>
      )}

      <Field
        label="Image URL"
        description="Full URL to the image"
        required
        invalid={!!imageFieldError}
        error={imageFieldError}
      >
        <Input
          value={src}
          onChange={(e) => {
            setSrc(e.currentTarget.value);
            setImageLoadError(false);
          }}
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
      {trimmedSrc && !imageUrlError && (
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
              src={trimmedSrc}
              alt={alt || 'Preview'}
              style={{
                width: '100%',
                height: 'auto',
                display: 'block',
              }}
              onLoad={() => setImageLoadError(false)}
              onError={() => {
                setImageLoadError(true);
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
ImageBlockForm.displayName = 'ImageBlockForm';
