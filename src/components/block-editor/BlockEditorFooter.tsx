/**
 * Block Editor Footer
 *
 * Footer component containing the block palette.
 * Hidden in preview mode.
 */

import React from 'react';
import { useStyles2 } from '@grafana/ui';
import { getBlockEditorStyles } from './block-editor.styles';
import { BlockPalette } from './BlockPalette';
import type { BlockType } from './types';

interface BlockEditorFooterProps {
  /** Whether the editor is in preview mode (hides footer) */
  isPreviewMode: boolean;
  /** Called when a block type is selected from the palette */
  onBlockTypeSelect: (type: BlockType, insertAtIndex?: number) => void;
}

/**
 * Footer component containing the block palette.
 * Hidden in preview mode.
 */
export function BlockEditorFooter({ isPreviewMode, onBlockTypeSelect }: BlockEditorFooterProps) {
  const styles = useStyles2(getBlockEditorStyles);

  if (isPreviewMode) {
    return null;
  }

  return (
    <div data-testid="block-palette" className={styles.footer}>
      <BlockPalette onSelect={onBlockTypeSelect} embedded />
    </div>
  );
}

// Add display name for debugging
BlockEditorFooter.displayName = 'BlockEditorFooter';
