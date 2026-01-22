/**
 * Block Form Modal
 *
 * Modal wrapper that renders the appropriate form for each block type.
 * Hides when element picker is active to allow clicking on page elements.
 * Handles type switch confirmation at the modal level to avoid nested modal timing bugs.
 *
 * ## Type Switch Architecture
 *
 * The ConfirmModal for type switch warnings is rendered at this level
 * (not inside TypeSwitchDropdown) because:
 *
 * 1. When type switches occur, the form component unmounts and remounts
 * 2. Grafana's Modal cleanup during unmount can trigger dismiss events
 * 3. Keeping ConfirmModal here ensures it survives form component unmounts
 *
 * Flow: FormComponent -> TypeSwitchDropdown -> handleTypeSwitchRequest ->
 *       (if warning) pendingSwitch state -> ConfirmModal -> onSwitchBlockType
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Modal, ConfirmModal, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { BLOCK_TYPE_METADATA } from './constants';
import { ElementPicker } from './ElementPicker';
import { RecordModeOverlay } from './RecordModeOverlay';
import type { BlockType, JsonBlock, BlockFormProps } from './types';
import type { ConversionWarning } from './forms/TypeSwitchDropdown';

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
  warningDetails: css({
    marginTop: theme.spacing(2),
    padding: theme.spacing(1.5),
    backgroundColor: theme.colors.warning.transparent,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.warning.border}`,
  }),
  warningFields: css({
    marginTop: theme.spacing(1),
    paddingLeft: theme.spacing(2),
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    '& li': {
      marginBottom: theme.spacing(0.5),
    },
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
  const [pendingMultiStepCount, setPendingMultiStepCount] = useState(0);
  const [isGroupingMultiStep, setIsGroupingMultiStep] = useState(false);
  const [isMultiStepGroupingEnabled, setIsMultiStepGroupingEnabled] = useState(true);

  // State for type switch confirmation - lifted from TypeSwitchDropdown to avoid nested modal timing bugs
  const [pendingSwitch, setPendingSwitch] = useState<{
    type: BlockType;
    warning: ConversionWarning;
  } | null>(null);

  // Store a callback to receive the selected element
  const pickerCallbackRef = useRef<((selector: string) => void) | null>(null);

  // Store callbacks for record mode
  const recordStopCallbackRef = useRef<(() => void) | null>(null);
  const recordGetStepCountRef = useRef<(() => number) | null>(null);
  const recordGetPendingMultiStepCountRef = useRef<(() => number) | null>(null);
  const recordIsGroupingMultiStepRef = useRef<(() => boolean) | null>(null);
  const recordIsMultiStepGroupingEnabledRef = useRef<(() => boolean) | null>(null);
  const recordToggleMultiStepGroupingRef = useRef<(() => void) | null>(null);

  // Update step count and multi-step grouping state periodically while recording
  useEffect(() => {
    if (!isRecordModeActive || !recordGetStepCountRef.current) {
      return;
    }

    // Update state immediately
    setRecordStepCount(recordGetStepCountRef.current());
    if (recordGetPendingMultiStepCountRef.current) {
      setPendingMultiStepCount(recordGetPendingMultiStepCountRef.current());
    }
    if (recordIsGroupingMultiStepRef.current) {
      setIsGroupingMultiStep(recordIsGroupingMultiStepRef.current());
    }
    if (recordIsMultiStepGroupingEnabledRef.current) {
      setIsMultiStepGroupingEnabled(recordIsMultiStepGroupingEnabledRef.current());
    }

    // Update periodically while recording
    const interval = setInterval(() => {
      if (recordGetStepCountRef.current) {
        setRecordStepCount(recordGetStepCountRef.current());
      }
      if (recordGetPendingMultiStepCountRef.current) {
        setPendingMultiStepCount(recordGetPendingMultiStepCountRef.current());
      }
      if (recordIsGroupingMultiStepRef.current) {
        setIsGroupingMultiStep(recordIsGroupingMultiStepRef.current());
      }
      if (recordIsMultiStepGroupingEnabledRef.current) {
        setIsMultiStepGroupingEnabled(recordIsMultiStepGroupingEnabledRef.current());
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
    (
      isActive: boolean,
      options?: {
        onStop: () => void;
        getStepCount: () => number;
        getPendingMultiStepCount?: () => number;
        isGroupingMultiStep?: () => boolean;
        isMultiStepGroupingEnabled?: () => boolean;
        toggleMultiStepGrouping?: () => void;
      }
    ) => {
      setIsRecordModeActive(isActive);
      if (isActive && options) {
        recordStopCallbackRef.current = options.onStop;
        recordGetStepCountRef.current = options.getStepCount;
        recordGetPendingMultiStepCountRef.current = options.getPendingMultiStepCount ?? null;
        recordIsGroupingMultiStepRef.current = options.isGroupingMultiStep ?? null;
        recordIsMultiStepGroupingEnabledRef.current = options.isMultiStepGroupingEnabled ?? null;
        recordToggleMultiStepGroupingRef.current = options.toggleMultiStepGrouping ?? null;
        setRecordStepCount(options.getStepCount());
        setPendingMultiStepCount(options.getPendingMultiStepCount?.() ?? 0);
        setIsGroupingMultiStep(options.isGroupingMultiStep?.() ?? false);
        setIsMultiStepGroupingEnabled(options.isMultiStepGroupingEnabled?.() ?? true);
        setRecordStartUrl(window.location.href);
      } else if (!isActive) {
        recordStopCallbackRef.current = null;
        recordGetStepCountRef.current = null;
        recordGetPendingMultiStepCountRef.current = null;
        recordIsGroupingMultiStepRef.current = null;
        recordIsMultiStepGroupingEnabledRef.current = null;
        recordToggleMultiStepGroupingRef.current = null;
        setRecordStepCount(0);
        setPendingMultiStepCount(0);
        setIsGroupingMultiStep(false);
        setIsMultiStepGroupingEnabled(true);
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

  // Called when user toggles multi-step grouping via overlay
  const handleToggleMultiStepGrouping = useCallback(() => {
    if (recordToggleMultiStepGroupingRef.current) {
      recordToggleMultiStepGroupingRef.current();
    }
  }, []);

  // Don't dismiss if in overlay mode - clicks should go to page, not close modal
  const handleDismiss = useCallback(() => {
    if (isOverlayActive) {
      return;
    }
    onCancel();
  }, [isOverlayActive, onCancel]);

  /**
   * Handle type switch request from TypeSwitchDropdown.
   * If there's a warning (data loss), show confirmation dialog.
   * Otherwise, proceed directly with the type switch.
   */
  const handleTypeSwitchRequest = useCallback(
    (newType: BlockType, warning?: ConversionWarning) => {
      if (warning) {
        // Show confirmation dialog at modal level - survives form component unmount
        setPendingSwitch({ type: newType, warning });
      } else {
        // No data loss - proceed directly
        onSwitchBlockType?.(newType);
      }
    },
    [onSwitchBlockType]
  );

  /**
   * Handle confirmation from the type switch warning dialog.
   */
  const handleTypeSwitchConfirm = useCallback(() => {
    const type = pendingSwitch?.type;
    setPendingSwitch(null);
    if (type) {
      onSwitchBlockType?.(type);
    }
  }, [pendingSwitch, onSwitchBlockType]);

  /**
   * Handle cancellation of the type switch warning dialog.
   */
  const handleTypeSwitchCancel = useCallback(() => {
    setPendingSwitch(null);
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

  const pendingTypeMeta = pendingSwitch ? BLOCK_TYPE_METADATA[pendingSwitch.type] : null;

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
            onSwitchBlockType={onSwitchBlockType ? handleTypeSwitchRequest : undefined}
          />
        </div>
      </Modal>

      {/* Type switch confirmation modal - rendered at BlockFormModal level to survive form unmount */}
      <ConfirmModal
        isOpen={pendingSwitch !== null}
        title={`Convert to ${pendingTypeMeta?.name}?`}
        body={
          <div>
            <p>{pendingSwitch?.warning.message}</p>
            {pendingSwitch && pendingSwitch.warning.lostFields.length > 0 && (
              <div className={styles.warningDetails}>
                <strong>Fields that will be lost:</strong>
                <ul className={styles.warningFields}>
                  {pendingSwitch.warning.lostFields.map((field, i) => (
                    <li key={i}>{field}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        }
        confirmText="Convert anyway"
        dismissText="Cancel"
        onConfirm={handleTypeSwitchConfirm}
        onDismiss={handleTypeSwitchCancel}
      />

      {/* Element picker - rendered outside the modal so it stays mounted */}
      {isPickerActive && <ElementPicker onSelect={handleElementSelect} onCancel={handlePickerCancel} />}

      {/* Record mode overlay - rendered outside the modal so clicks propagate to the page */}
      {isRecordModeActive && (
        <RecordModeOverlay
          onStop={handleRecordStop}
          stepCount={recordStepCount}
          startingUrl={recordStartUrl ?? undefined}
          pendingMultiStepCount={pendingMultiStepCount}
          isGroupingMultiStep={isGroupingMultiStep}
          isMultiStepGroupingEnabled={isMultiStepGroupingEnabled}
          onToggleMultiStepGrouping={handleToggleMultiStepGrouping}
        />
      )}
    </>
  );
}

// Add display name for debugging
BlockFormModal.displayName = 'BlockFormModal';
