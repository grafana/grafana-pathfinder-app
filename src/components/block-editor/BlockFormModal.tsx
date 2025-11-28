/**
 * Block Form Modal
 *
 * Modal wrapper that renders the appropriate form for each block type.
 * Hides when element picker is active to allow clicking on page elements.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Modal, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { BLOCK_TYPE_METADATA } from './constants';
import { ElementPicker } from './ElementPicker';
import type { BlockType, JsonBlock, BlockFormProps } from './types';

// Global style to hide ALL modal overlays when picker is active
const PICKER_ACTIVE_STYLE_ID = 'block-editor-picker-active-style';
const PICKER_ACTIVE_CSS = `
  .modal-backdrop, 
  [class*="modal-backdrop"],
  .ReactModal__Overlay,
  [class*="ReactModal__Overlay"] {
    visibility: hidden !important;
    pointer-events: none !important;
  }
`;

// Import form components
import { MarkdownBlockForm } from './forms/MarkdownBlockForm';
import { HtmlBlockForm } from './forms/HtmlBlockForm';
import { ImageBlockForm } from './forms/ImageBlockForm';
import { VideoBlockForm } from './forms/VideoBlockForm';
import { SectionBlockForm } from './forms/SectionBlockForm';
import { InteractiveBlockForm } from './forms/InteractiveBlockForm';
import { MultistepBlockForm } from './forms/MultistepBlockForm';
import { GuidedBlockForm } from './forms/GuidedBlockForm';

const getStyles = (theme: GrafanaTheme2) => ({
  modal: css({
    maxWidth: '700px',
    width: '100%',
  }),
  modalHidden: css({
    // Hide modal visually but keep it mounted to preserve form state
    visibility: 'hidden',
    pointerEvents: 'none',
  }),
  modalTitle: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  modalIcon: css({
    fontSize: '20px',
  }),
});

export interface BlockFormModalProps {
  /** The type of block being edited */
  blockType: BlockType;
  /** Initial data for editing (undefined for new blocks) */
  initialData?: JsonBlock;
  /** Called when form is submitted */
  onSubmit: (block: JsonBlock) => void;
  /** Called when form is cancelled */
  onCancel: () => void;
  /** Whether editing an existing block */
  isEditing?: boolean;
}

// Map block types to form components - defined outside render
const FORM_COMPONENTS: Record<BlockType, React.ComponentType<BlockFormProps>> = {
  markdown: MarkdownBlockForm,
  html: HtmlBlockForm,
  image: ImageBlockForm,
  video: VideoBlockForm,
  section: SectionBlockForm,
  interactive: InteractiveBlockForm,
  multistep: MultistepBlockForm,
  guided: GuidedBlockForm,
};

/**
 * Block form modal component
 */
export function BlockFormModal({ blockType, initialData, onSubmit, onCancel, isEditing = false }: BlockFormModalProps) {
  const styles = useStyles2(getStyles);
  const meta = BLOCK_TYPE_METADATA[blockType];
  const FormComponent = FORM_COMPONENTS[blockType];
  const [isPickerActive, setIsPickerActive] = useState(false);

  // Store a callback to receive the selected element
  const pickerCallbackRef = useRef<((selector: string) => void) | null>(null);

  // Inject/remove global style to hide modal overlays when picker is active
  useEffect(() => {
    if (isPickerActive) {
      // Add style to hide modal overlays
      let styleEl = document.getElementById(PICKER_ACTIVE_STYLE_ID);
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = PICKER_ACTIVE_STYLE_ID;
        styleEl.textContent = PICKER_ACTIVE_CSS;
        document.head.appendChild(styleEl);
      }
    } else {
      // Remove the style
      const styleEl = document.getElementById(PICKER_ACTIVE_STYLE_ID);
      if (styleEl) {
        styleEl.remove();
      }
    }

    // Cleanup on unmount
    return () => {
      const styleEl = document.getElementById(PICKER_ACTIVE_STYLE_ID);
      if (styleEl) {
        styleEl.remove();
      }
    };
  }, [isPickerActive]);

  // Called by forms when they want to start the picker
  const handlePickerModeChange = useCallback((isActive: boolean, onSelect?: (selector: string) => void) => {
    setIsPickerActive(isActive);
    if (isActive && onSelect) {
      pickerCallbackRef.current = onSelect;
    } else if (!isActive) {
      pickerCallbackRef.current = null;
    }
  }, []);

  // Called when user selects an element
  const handleElementSelect = useCallback((selector: string) => {
    if (pickerCallbackRef.current) {
      pickerCallbackRef.current(selector);
    }
    setIsPickerActive(false);
    pickerCallbackRef.current = null;
  }, []);

  // Called when user cancels the picker
  const handlePickerCancel = useCallback(() => {
    setIsPickerActive(false);
    pickerCallbackRef.current = null;
  }, []);

  if (!FormComponent) {
    return null;
  }

  const title = (
    <div className={styles.modalTitle}>
      <span className={styles.modalIcon}>{meta.icon}</span>
      <span>{isEditing ? `Edit ${meta.name} Block` : `Add ${meta.name} Block`}</span>
    </div>
  );

  return (
    <>
      {/* Modal - always mounted, but visually hidden when picker is active to preserve form state */}
      <Modal
        title={title}
        isOpen={true}
        onDismiss={onCancel}
        className={`${styles.modal} ${isPickerActive ? styles.modalHidden : ''}`}
      >
        <FormComponent
          initialData={initialData}
          onSubmit={onSubmit}
          onCancel={onCancel}
          isEditing={isEditing}
          onPickerModeChange={handlePickerModeChange}
        />
      </Modal>

      {/* Element picker - rendered outside the modal so it stays mounted */}
      {isPickerActive && <ElementPicker onSelect={handleElementSelect} onCancel={handlePickerCancel} />}
    </>
  );
}

// Add display name for debugging
BlockFormModal.displayName = 'BlockFormModal';
