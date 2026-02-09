/**
 * Video Block Form
 *
 * Form for creating/editing video blocks.
 */

import React, { useState, useCallback } from 'react';
import { Button, Field, Input, Combobox, Alert, useStyles2, type ComboboxOption } from '@grafana/ui';
import { getBlockFormStyles } from '../block-editor.styles';
import { VIDEO_PROVIDERS } from '../constants';
import { TypeSwitchDropdown } from './TypeSwitchDropdown';
import { PLACEHOLDER_URL } from '../utils';
import type { BlockFormProps, JsonBlock } from '../types';
import type { JsonVideoBlock } from '../../../types/json-guide.types';

/**
 * Type guard for video blocks
 */
function isVideoBlock(block: JsonBlock): block is JsonVideoBlock {
  return block.type === 'video';
}

const PROVIDER_OPTIONS: Array<ComboboxOption<'youtube' | 'native'>> = VIDEO_PROVIDERS.map((p) => ({
  value: p.value,
  label: p.label,
}));

/**
 * Video block form component
 */
export function VideoBlockForm({
  initialData,
  onSubmit,
  onCancel,
  isEditing = false,
  onSwitchBlockType,
}: BlockFormProps) {
  const styles = useStyles2(getBlockFormStyles);

  // Initialize from existing data or defaults
  // Clear placeholder URL so user sees an empty field to fill in
  const initial = initialData && isVideoBlock(initialData) ? initialData : null;
  const initialSrc = initial?.src === PLACEHOLDER_URL ? '' : (initial?.src ?? '');
  const needsUrl = initial?.src === PLACEHOLDER_URL;
  const [src, setSrc] = useState(initialSrc);
  const [provider, setProvider] = useState<'youtube' | 'native'>(initial?.provider ?? 'youtube');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [start, setStart] = useState(initial?.start?.toString() ?? '');
  const [end, setEnd] = useState(initial?.end?.toString() ?? '');

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const block: JsonVideoBlock = {
        type: 'video',
        src: src.trim(),
        ...(provider && { provider }),
        ...(title.trim() && { title: title.trim() }),
        ...(start.trim() && !isNaN(Number(start)) && Number(start) >= 0 && { start: Number(start) }),
        ...(end.trim() && !isNaN(Number(end)) && Number(end) >= 0 && { end: Number(end) }),
      };
      onSubmit(block);
    },
    [src, provider, title, start, end, onSubmit]
  );

  const handleProviderChange = useCallback((option: ComboboxOption<'youtube' | 'native'>) => {
    setProvider(option.value);
  }, []);

  const isValid = src.trim().length > 0;

  // Get YouTube embed URL hint
  const getUrlHint = () => {
    if (provider === 'youtube') {
      return 'Use the embed URL format: https://www.youtube.com/embed/VIDEO_ID';
    }
    return 'Direct URL to an MP4 or WebM video file';
  };

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      {needsUrl && (
        <Alert title="Video URL required" severity="info">
          Please provide a video URL to complete this block.
        </Alert>
      )}

      <Field label="Video Provider" description="Select the video source type">
        <Combobox options={PROVIDER_OPTIONS} value={provider} onChange={handleProviderChange} />
      </Field>

      <Field label="Video URL" description={getUrlHint()} required>
        <Input
          value={src}
          onChange={(e) => setSrc(e.currentTarget.value)}
          placeholder={
            provider === 'youtube' ? 'https://www.youtube.com/embed/dQw4w9WgXcQ' : 'https://example.com/video.mp4'
          }
          autoFocus
        />
      </Field>

      <Field label="Title" description="Video title for accessibility">
        <Input value={title} onChange={(e) => setTitle(e.currentTarget.value)} placeholder="Video title" />
      </Field>

      <Field label="Start time (seconds)" description="Optional start time in seconds">
        <Input
          type="number"
          min="0"
          step="0.1"
          value={start}
          onChange={(e) => setStart(e.currentTarget.value)}
          placeholder="0"
        />
      </Field>

      <Field label="End time (seconds)" description="Optional end time in seconds">
        <Input
          type="number"
          min="0"
          step="0.1"
          value={end}
          onChange={(e) => setEnd(e.currentTarget.value)}
          placeholder="0"
        />
      </Field>

      {/* Preview for YouTube */}
      {src && provider === 'youtube' && (
        <Field label="Preview">
          <div
            style={{
              aspectRatio: '16/9',
              maxWidth: '100%',
              borderRadius: '4px',
              overflow: 'hidden',
              border: '1px solid var(--border-weak)',
            }}
          >
            <iframe
              src={src}
              title={title || 'Video preview'}
              style={{ width: '100%', height: '100%', border: 'none' }}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </Field>
      )}

      <div className={styles.footer}>
        {isEditing && onSwitchBlockType && (
          <div className={styles.footerLeft}>
            <TypeSwitchDropdown currentType="video" onSwitch={onSwitchBlockType} blockData={initialData} />
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
VideoBlockForm.displayName = 'VideoBlockForm';
