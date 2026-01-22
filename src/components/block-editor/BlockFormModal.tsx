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
import { RecordModeOverlay } from './RecordModeOverlay';
import type { BlockType, JsonBlock, BlockFormProps } from './types';

// Unique identifier for our modal - used to find and manipulate only our modal's overlay
const BLOCK_EDITOR_MODAL_ATTR = 'data-block-editor-modal';

// Import form components
import { MarkdownBlockForm } from './forms/MarkdownBlockForm';
import { HtmlBlockForm } from './forms/HtmlBlockForm';
import { ImageBlockForm } from './forms/ImageBlockForm';
import { VideoBlockForm } from './forms/VideoBlockForm';
import { SectionBlockForm } from './forms/SectionBlockForm';
import { ConditionalBlockForm } from './forms/ConditionalBlockForm';
import { InteractiveBlockForm } from './forms/InteractiveBlockForm';
import { MultistepBlockForm } from './forms/MultistepBlockForm';
import { GuidedBlockForm } from './forms/GuidedBlockForm';
import { QuizBlockForm } from './forms/QuizBlockForm';
import { InputBlockForm } from './forms/InputBlockForm';

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
  /** Called when form is submitted AND recording should start (for section blocks) */
  onSubmitAndRecord?: (block: JsonBlock) => void;
  /** Called when form is cancelled */
  onCancel: () => void;
  /** Whether editing an existing block */
  isEditing?: boolean;
  /** Called when user wants to split multistep/guided into individual blocks */
  onSplitToBlocks?: () => void;
  /** Called when user wants to convert between multistep and guided */
  onConvertType?: (newType: 'multistep' | 'guided') => void;
  /** Called when user wants to switch to a different block type */
  onSwitchBlockType?: (newType: BlockType) => void;
}

// Map block types to form components - defined outside render
const FORM_COMPONENTS: Record<BlockType, React.ComponentType<BlockFormProps>> = {
  markdown: MarkdownBlockForm,
  html: HtmlBlockForm,
  image: ImageBlockForm,
  video: VideoBlockForm,
  section: SectionBlockForm,
  conditional: ConditionalBlockForm,
  interactive: InteractiveBlockForm,
  multistep: MultistepBlockForm,
  guided: GuidedBlockForm,
  quiz: QuizBlockForm,
  input: InputBlockForm,
};

/**
 * Block form modal component
 */
export function BlockFormModal({
  blockType,
  initialData,
  onSubmit,
  onSubmitAndRecord,
  onCancel,
  isEditing = false,
  onSplitToBlocks,
  onConvertType,
  onSwitchBlockType,
}: BlockFormModalProps) {
  const styles = useStyles2(getStyles);
  const meta = BLOCK_TYPE_METADATA[blockType];
  const FormComponent = FORM_COMPONENTS[blockType];
  const [isPickerActive, setIsPickerActive] = useState(false);
  const [isRecordModeActive, setIsRecordModeActive] = useState(false);
  const [recordStepCount, setRecordStepCount] = useState(0);
  const [recordStartUrl, setRecordStartUrl] = useState<string | null>(null);

  /**
   * Guard to prevent dismiss during type switch operations.
   *
   * IMPORTANT: This ref exists because of a subtle timing bug with Grafana's nested modals.
   *
   * When a user switches block types via TypeSwitchDropdown:
   * 1. If there's a data loss warning, a ConfirmModal opens (nested inside this modal)
   * 2. When user confirms, ConfirmModal closes (isOpen becomes false)
   * 3. During ConfirmModal's unmount, Grafana's modal cleanup can trigger events
   *    (focus restoration, backdrop cleanup, etc.) that call THIS modal's onDismiss
   * 4. Without this guard, the parent modal (BlockFormModal) would close unexpectedly
   *
   * The guard is set SYNCHRONOUSLY via handlePrepareTypeSwitch BEFORE any React state
   * updates that would cause ConfirmModal to unmount. This ensures handleDismiss can
   * check the guard and reject spurious dismiss events during the type switch.
   *
   * We use a ref instead of state because:
   * - State updates are batched and may not be visible synchronously
   * - The guard check in handleDismiss must see the value immediately
   * - Refs update synchronously and are visible immediately to all readers
   *
   * @see handlePrepareTypeSwitch - sets this guard
   * @see handleDismiss - checks this guard
   * @see TypeSwitchDropdown.handleConfirm - triggers the sequence
   */
  const isTypeSwitchPendingRef = useRef(false);

  // Store a callback to receive the selected element
  const pickerCallbackRef = useRef<((selector: string) => void) | null>(null);

  // Store callbacks for record mode
  const recordStopCallbackRef = useRef<(() => void) | null>(null);
  const recordGetStepCountRef = useRef<(() => number) | null>(null);

  // Update step count periodically while recording
  useEffect(() => {
    if (!isRecordModeActive || !recordGetStepCountRef.current) {
      return;
    }

    // Update step count immediately
    setRecordStepCount(recordGetStepCountRef.current());

    // Update periodically while recording
    const interval = setInterval(() => {
      if (recordGetStepCountRef.current) {
        setRecordStepCount(recordGetStepCountRef.current());
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isRecordModeActive]);

  // Whether either overlay mode is active
  const isOverlayActive = isPickerActive || isRecordModeActive;

  // Ref to track elements we've hidden and their original styles
  const hiddenElementsRef = useRef<Map<HTMLElement, { bg: string; pe: string; vis: string }>>(new Map());

  // Hide modal overlays when picker or record mode is active
  useEffect(() => {
    if (!isOverlayActive) {
      // Restore all hidden elements
      hiddenElementsRef.current.forEach((styles, el) => {
        el.style.backgroundColor = styles.bg;
        el.style.pointerEvents = styles.pe;
        el.style.visibility = styles.vis;
      });
      hiddenElementsRef.current.clear();
      return;
    }

    // When overlay mode is active, find and hide modal overlay elements
    const hideOverlays = () => {
      // Find our modal marker element
      const modalMarker = document.querySelector(`[${BLOCK_EDITOR_MODAL_ATTR}]`);
      if (!modalMarker) {
        return;
      }

      // Find the portal entry that contains our modal
      // Grafana renders modals in #grafana-portal-container
      const portalContainer = document.getElementById('grafana-portal-container');
      if (!portalContainer) {
        return;
      }

      // Find which portal entry contains our modal
      for (const child of Array.from(portalContainer.children)) {
        if (!(child instanceof HTMLElement)) {
          continue;
        }
        if (!child.contains(modalMarker)) {
          continue;
        }

        // Found the portal entry containing our modal
        // Now hide all overlay-like elements within this entry
        const elementsToCheck = [child, ...Array.from(child.querySelectorAll('*'))];

        for (const el of elementsToCheck) {
          if (!(el instanceof HTMLElement)) {
            continue;
          }
          // Skip our own picker/recorder overlays
          if (el.hasAttribute('data-element-picker') || el.hasAttribute('data-record-overlay')) {
            continue;
          }
          // Skip the modal content itself (let the CSS handle hiding that)
          if (el.hasAttribute(BLOCK_EDITOR_MODAL_ATTR)) {
            continue;
          }

          const computed = window.getComputedStyle(el);

          // Check if this looks like a modal overlay/backdrop
          const isOverlay =
            (computed.position === 'fixed' || computed.position === 'absolute') &&
            computed.backgroundColor !== 'transparent' &&
            computed.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
            (computed.inset === '0px' ||
              (computed.top === '0px' &&
                computed.left === '0px' &&
                computed.right === '0px' &&
                computed.bottom === '0px'));

          if (isOverlay && !hiddenElementsRef.current.has(el)) {
            // Save original styles and hide
            hiddenElementsRef.current.set(el, {
              bg: el.style.backgroundColor,
              pe: el.style.pointerEvents,
              vis: el.style.visibility,
            });
            el.style.backgroundColor = 'transparent';
            el.style.pointerEvents = 'none';
          }
        }
        break; // Only process the portal entry containing our modal
      }
    };

    // Run immediately and also after a short delay (in case modal renders async)
    hideOverlays();
    const timeoutId = setTimeout(hideOverlays, 50);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [isOverlayActive]);

  // Cleanup on unmount
  useEffect(() => {
    // REACT: capture ref value for cleanup (R1)
    const hiddenElements = hiddenElementsRef.current;
    return () => {
      hiddenElements.forEach((styles, el) => {
        el.style.backgroundColor = styles.bg;
        el.style.pointerEvents = styles.pe;
        el.style.visibility = styles.vis;
      });
      hiddenElements.clear();
    };
  }, []);

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

  // Called by forms when they want to start/stop record mode
  const handleRecordModeChange = useCallback(
    (isActive: boolean, options?: { onStop: () => void; getStepCount: () => number }) => {
      setIsRecordModeActive(isActive);
      if (isActive && options) {
        recordStopCallbackRef.current = options.onStop;
        recordGetStepCountRef.current = options.getStepCount;
        setRecordStepCount(options.getStepCount());
        setRecordStartUrl(window.location.href);
      } else if (!isActive) {
        recordStopCallbackRef.current = null;
        recordGetStepCountRef.current = null;
        setRecordStepCount(0);
        setRecordStartUrl(null);
      }
    },
    []
  );

  // Called when user stops recording via overlay
  const handleRecordStop = useCallback(() => {
    if (recordStopCallbackRef.current) {
      recordStopCallbackRef.current();
    }
    setIsRecordModeActive(false);
    recordStopCallbackRef.current = null;
    recordGetStepCountRef.current = null;
  }, []);

  /**
   * Dismiss handler with guard check.
   *
   * This can be called by Grafana's modal in various scenarios:
   * - User clicks backdrop
   * - User presses Escape
   * - Nested modal cleanup triggers parent events (the bug we're protecting against)
   *
   * We reject dismiss events when:
   * - Element picker or record mode overlay is active (user is interacting with page)
   * - Type switch is pending (guard set by handlePrepareTypeSwitch)
   */
  const handleDismiss = useCallback(() => {
    if (isOverlayActive || isTypeSwitchPendingRef.current) {
      return;
    }
    onCancel();
  }, [isOverlayActive, onCancel]);

  /**
   * Called SYNCHRONOUSLY by TypeSwitchDropdown before any React state updates.
   *
   * This is the critical fix for the nested modal timing bug. The sequence is:
   *
   *   TypeSwitchDropdown.handleConfirm():
   *     1. onPrepareTypeSwitch() → THIS FUNCTION → sets guard to true
   *     2. setPendingType(null) → schedules React update
   *     3. React update runs → ConfirmModal gets isOpen=false → unmounts
   *     4. Grafana cleanup might call handleDismiss → guard check returns early!
   *     5. setTimeout fires → onSwitchBlockType called → type changes
   *     6. After stabilization → guard resets to false
   *
   * Without step 1, the guard wouldn't be set until after step 4, and the
   * modal would close unexpectedly during nested modal cleanup.
   */
  const handlePrepareTypeSwitch = useCallback(() => {
    isTypeSwitchPendingRef.current = true;
  }, []);

  /**
   * Performs the actual type switch after guard is already set.
   *
   * The guard was set earlier by handlePrepareTypeSwitch (called synchronously
   * from TypeSwitchDropdown before its ConfirmModal closes). This function just
   * needs to:
   * 1. Call the parent's type switch handler
   * 2. Reset the guard after the modal has stabilized
   */
  const handleSwitchBlockTypeWithGuard = useCallback(
    (newType: BlockType) => {
      if (!onSwitchBlockType) {
        return;
      }
      // Guard is already set by handlePrepareTypeSwitch - proceed with switch
      onSwitchBlockType(newType);
      // Reset guard after TWO animation frames to ensure React has reconciled
      // and any modal cleanup events have fired
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          isTypeSwitchPendingRef.current = false;
        });
      });
    },
    [onSwitchBlockType]
  );

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
      {/* Modal - always mounted, but visually hidden when picker or record mode is active to preserve form state */}
      <Modal
        title={title}
        ariaLabel={isEditing ? `Edit ${meta.name} block` : `Add ${meta.name} block`}
        isOpen={true}
        onDismiss={handleDismiss}
        className={`${styles.modal} ${isOverlayActive ? styles.modalHidden : ''}`}
      >
        {/* Wrapper with unique identifier so CSS :has() selector can target only our modal's overlay */}
        <div {...{ [BLOCK_EDITOR_MODAL_ATTR]: 'true' }}>
          <FormComponent
            initialData={initialData}
            onSubmit={onSubmit}
            onSubmitAndRecord={onSubmitAndRecord}
            onCancel={onCancel}
            isEditing={isEditing}
            onPickerModeChange={handlePickerModeChange}
            onRecordModeChange={handleRecordModeChange}
            onSplitToBlocks={blockType === 'multistep' || blockType === 'guided' ? onSplitToBlocks : undefined}
            onConvertType={blockType === 'multistep' || blockType === 'guided' ? onConvertType : undefined}
            onSwitchBlockType={onSwitchBlockType ? handleSwitchBlockTypeWithGuard : undefined}
            onPrepareTypeSwitch={onSwitchBlockType ? handlePrepareTypeSwitch : undefined}
          />
        </div>
      </Modal>

      {/* Element picker - rendered outside the modal so it stays mounted */}
      {isPickerActive && <ElementPicker onSelect={handleElementSelect} onCancel={handlePickerCancel} />}

      {/* Record mode overlay - rendered outside the modal so clicks propagate to the page */}
      {isRecordModeActive && (
        <RecordModeOverlay
          onStop={handleRecordStop}
          stepCount={recordStepCount}
          startingUrl={recordStartUrl ?? undefined}
        />
      )}
    </>
  );
}

// Add display name for debugging
BlockFormModal.displayName = 'BlockFormModal';
