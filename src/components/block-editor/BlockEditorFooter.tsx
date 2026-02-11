/**
 * Block Editor Footer
 *
 * Footer component containing the block palette.
 * Hidden in non-edit modes (preview, json).
 */

import React from 'react';
import { useStyles2 } from '@grafana/ui';
import { getBlockEditorStyles } from './block-editor.styles';
import { BlockPalette } from './BlockPalette';
import type { BlockType, ViewMode } from './types';

interface BlockEditorFooterProps {
  /** Current view mode (footer only shown in edit mode) */
  viewMode: ViewMode;
  /** Called when a block type is selected from the palette */
  onBlockTypeSelect: (type: BlockType, insertAtIndex?: number) => void;
}

/**
 * Footer component containing the block palette.
 * Hidden in non-edit modes.
 */
export function BlockEditorFooter({ viewMode, onBlockTypeSelect }: BlockEditorFooterProps) {
  const styles = useStyles2(getBlockEditorStyles);

  if (viewMode !== 'edit') {
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
