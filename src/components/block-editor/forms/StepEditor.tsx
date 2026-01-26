/**
 * Step Editor Component
 *
 * Shared component for editing steps in multistep and guided blocks.
 * Uses @dnd-kit for drag-and-drop reordering.
 * Includes record mode integration for capturing steps automatically.
 */

import React, { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { Button, Field, Input, Select, Badge, IconButton, Checkbox, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { css, cx } from '@emotion/css';
// @dnd-kit
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  MeasuringStrategy,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { INTERACTIVE_ACTIONS } from '../constants';
import { COMMON_REQUIREMENTS } from '../../../constants/interactive-config';
import { useActionRecorder } from '../../../utils/devtools';
import type { JsonStep, JsonInteractiveAction } from '../types';

// Exclude our overlay UI from being recorded as steps
const RECORD_EXCLUDE_SELECTORS = [
  '[class*="debug"]',
  '.context-container',
  '[data-devtools-panel]',
  '[data-record-overlay]', // Our recording overlay banner/buttons
];

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
  }),
  stepsList: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    maxHeight: '300px',
    overflowY: 'auto',
    padding: theme.spacing(1),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  stepItem: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    backgroundColor: theme.colors.background.primary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    cursor: 'grab',
    transition: 'all 0.15s ease',
    userSelect: 'none',
    touchAction: 'none',

    '&:hover': {
      borderColor: theme.colors.border.medium,
      boxShadow: theme.shadows.z1,
    },

    '&:active': {
      cursor: 'grabbing',
    },
  }),
  stepItemDragging: css({
    opacity: 0.4,
    cursor: 'grabbing',
  }),
  // Drag handle - matches BlockItem
  dragHandle: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    color: theme.colors.text.disabled,
    flexShrink: 0,
    pointerEvents: 'none',
  }),
  stepContent: css({
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
  }),
  stepHeader: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
  }),
  stepSelector: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
  stepActions: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    flexShrink: 0,
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  editButton: css({
    color: theme.colors.primary.text,
    backgroundColor: theme.colors.primary.transparent,
    borderRadius: theme.shape.radius.default,
    transition: 'all 0.15s ease',

    '&:hover': {
      backgroundColor: theme.colors.primary.shade,
      color: theme.colors.primary.contrastText,
    },
  }),
  actionButton: css({
    opacity: 0.7,
    transition: 'all 0.15s ease',

    '&:hover': {
      opacity: 1,
      backgroundColor: theme.colors.action.hover,
    },
  }),
  deleteButton: css({
    opacity: 0.7,
    color: theme.colors.error.text,
    transition: 'all 0.15s ease',

    '&:hover': {
      opacity: 1,
      backgroundColor: theme.colors.error.transparent,
    },
  }),
  emptyState: css({
    textAlign: 'center',
    padding: theme.spacing(3),
    color: theme.colors.text.secondary,
  }),
  addStepForm: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    padding: theme.spacing(1.5),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  addStepRow: css({
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'flex-end',
  }),
  controlButtons: css({
    display: 'flex',
    gap: theme.spacing(1),
    flexWrap: 'wrap',
  }),
  // Checkbox - ensures left alignment
  checkbox: css({
    alignSelf: 'flex-start',
    textAlign: 'left',
  }),
});

const ACTION_OPTIONS: Array<SelectableValue<JsonInteractiveAction>> = INTERACTIVE_ACTIONS.map((a) => ({
  value: a.value as JsonInteractiveAction,
  label: a.label,
}));

export interface StepEditorProps {
  /** Current steps */
  steps: JsonStep[];
  /** Called when steps change */
  onChange: (steps: JsonStep[]) => void;
  /** Whether to show record mode button */
  showRecordMode?: boolean;
  /** Whether this is for a guided block (uses description instead of tooltip) */
  isGuided?: boolean;
  /** Called to start/stop the element picker with a callback for receiving the selector */
  onPickerModeChange?: (isActive: boolean, onSelect?: (selector: string) => void) => void;
  /**
   * Called when record mode starts/stops.
   * When starting (isActive=true), provides callbacks so parent can control the overlay.
   * The parent should render RecordModeOverlay and call onStop when user clicks stop.
   */
  onRecordModeChange?: (
    isActive: boolean,
    options?: {
      onStop: () => void;
      getStepCount: () => number;
      /** Get number of steps pending in multi-step group (modal/dropdown detected) */
      getPendingMultiStepCount?: () => number;
      /** Check if currently grouping steps into a multi-step */
      isGroupingMultiStep?: () => boolean;
      /** Check if multi-step grouping is enabled */
      isMultiStepGroupingEnabled?: () => boolean;
      /** Toggle multi-step grouping on/off */
      toggleMultiStepGrouping?: () => void;
    }
  ) => void;
}

/**
 * Sortable step item wrapper using @dnd-kit
 */
function SortableStepItem({
  id,
  index,
  children,
  disabled,
}: {
  id: string;
  index: number;
  children: React.ReactNode;
  disabled: boolean;
}) {
  const styles = useStyles2(getStyles);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: { type: 'step', index },
    disabled,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cx(styles.stepItem, isDragging && styles.stepItemDragging)}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

/**
 * Step editor component
 */
export function StepEditor({
  steps,
  onChange,
  showRecordMode = true,
  isGuided = false,
  onPickerModeChange,
  onRecordModeChange,
}: StepEditorProps) {
  const styles = useStyles2(getStyles);

  // Add step form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAction, setNewAction] = useState<JsonInteractiveAction>('highlight');
  const [newReftarget, setNewReftarget] = useState('');
  const [newTargetvalue, setNewTargetvalue] = useState('');
  const [newTooltip, setNewTooltip] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newFormHint, setNewFormHint] = useState('');
  const [newValidateInput, setNewValidateInput] = useState(false);
  const [newLazyRender, setNewLazyRender] = useState(false);
  const [newScrollContainer, setNewScrollContainer] = useState('');
  const [newRequirements, setNewRequirements] = useState('');
  const [newSkippable, setNewSkippable] = useState(false);

  // Edit step form state
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);
  const [editAction, setEditAction] = useState<JsonInteractiveAction>('highlight');
  const [editReftarget, setEditReftarget] = useState('');
  const [editTargetvalue, setEditTargetvalue] = useState('');
  const [editTooltip, setEditTooltip] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editFormHint, setEditFormHint] = useState('');
  const [editValidateInput, setEditValidateInput] = useState(false);
  const [editLazyRender, setEditLazyRender] = useState(false);
  const [editScrollContainer, setEditScrollContainer] = useState('');
  const [editRequirements, setEditRequirements] = useState('');
  const [editSkippable, setEditSkippable] = useState(false);

  // Keep a ref to current steps length so getStepCount always returns fresh value
  const stepsLengthRef = useRef(steps.length);
  // REACT: update ref in effect, not during render (R2)
  useEffect(() => {
    stepsLengthRef.current = steps.length;
  }, [steps.length]);

  // Configure @dnd-kit sensors
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 8 },
  });
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  });
  const sensors = useSensors(pointerSensor, keyboardSensor);

  // Generate stable IDs for sortable items
  const stepIds = useMemo(() => steps.map((_, i) => `step-${i}`), [steps]);

  // Handle drag end - reorder steps
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) {
        return;
      }

      const activeIndex = stepIds.indexOf(String(active.id));
      const overIndex = stepIds.indexOf(String(over.id));

      if (activeIndex !== -1 && overIndex !== -1 && activeIndex !== overIndex) {
        const newSteps = [...steps];
        const [removed] = newSteps.splice(activeIndex, 1);
        newSteps.splice(overIndex, 0, removed);
        onChange(newSteps);
      }
    },
    [steps, stepIds, onChange]
  );

  // Start element picker for new step - pass callback to receive selected element
  const startPicker = useCallback(() => {
    onPickerModeChange?.(true, (selector: string) => {
      setNewReftarget(selector);
    });
  }, [onPickerModeChange]);

  // Start element picker for editing step
  const startEditPicker = useCallback(() => {
    onPickerModeChange?.(true, (selector: string) => {
      setEditReftarget(selector);
    });
  }, [onPickerModeChange]);

  // Start editing a step
  const handleStartEdit = useCallback(
    (index: number) => {
      const step = steps[index];
      setEditingStepIndex(index);
      setEditAction(step.action);
      setEditReftarget(step.reftarget ?? '');
      setEditTargetvalue(step.targetvalue ?? '');
      setEditFormHint(step.formHint ?? '');
      setEditValidateInput(step.validateInput ?? false);
      setEditLazyRender(step.lazyRender ?? false);
      setEditScrollContainer(step.scrollContainer ?? '');
      setEditRequirements(step.requirements?.join(', ') ?? '');
      setEditSkippable(step.skippable ?? false);
      if (isGuided) {
        setEditDescription(step.description ?? '');
        setEditTooltip('');
      } else {
        setEditTooltip(step.tooltip ?? '');
        setEditDescription('');
      }
      // Close add form if open
      setShowAddForm(false);
    },
    [steps, isGuided]
  );

  // Save edited step
  const handleSaveEdit = useCallback(() => {
    // noop actions don't require a reftarget
    if (editingStepIndex === null || (editAction !== 'noop' && !editReftarget.trim())) {
      return;
    }

    // Parse requirements from comma-separated string
    const reqArray = editRequirements
      .split(',')
      .map((r) => r.trim())
      .filter((r) => r.length > 0);

    const updatedStep: JsonStep = {
      action: editAction,
      reftarget: editReftarget.trim(),
      ...(editAction === 'formfill' && editTargetvalue.trim() && { targetvalue: editTargetvalue.trim() }),
      ...(editAction === 'formfill' && editFormHint.trim() && { formHint: editFormHint.trim() }),
      ...(editAction === 'formfill' && editValidateInput && { validateInput: true }),
      ...(isGuided
        ? editDescription.trim() && { description: editDescription.trim() }
        : editTooltip.trim() && { tooltip: editTooltip.trim() }),
      ...(editLazyRender && { lazyRender: true }),
      ...(editLazyRender && editScrollContainer.trim() && { scrollContainer: editScrollContainer.trim() }),
      ...(reqArray.length > 0 && { requirements: reqArray }),
      ...(isGuided && editSkippable && { skippable: true }),
    };

    const newSteps = [...steps];
    newSteps[editingStepIndex] = updatedStep;
    onChange(newSteps);

    setEditingStepIndex(null);
  }, [
    editingStepIndex,
    editAction,
    editReftarget,
    editTargetvalue,
    editFormHint,
    editValidateInput,
    editTooltip,
    editDescription,
    editLazyRender,
    editScrollContainer,
    editRequirements,
    editSkippable,
    isGuided,
    steps,
    onChange,
  ]);

  // Cancel editing
  const handleCancelEdit = useCallback(() => {
    setEditingStepIndex(null);
  }, []);

  // REACT: memoize onStepRecorded to prevent effect re-runs on every render (R12)
  const handleStepRecorded = useCallback(
    (step: { action: string; selector: string; value?: string }) => {
      // Convert recorded step to JsonStep and add to steps
      const jsonStep: JsonStep = {
        action: step.action as JsonInteractiveAction,
        reftarget: step.selector,
        ...(step.value && { targetvalue: step.value }),
      };
      onChange([...steps, jsonStep]);
    },
    [onChange, steps]
  );

  // State to control multi-step grouping on/off during recording
  const [isMultiStepGroupingEnabled, setIsMultiStepGroupingEnabled] = useState(true);

  // Action recorder for record mode - exclude our overlay UI
  const { isRecording, startRecording, stopRecording, clearRecording, activeModal, pendingGroupSteps } =
    useActionRecorder({
      excludeSelectors: RECORD_EXCLUDE_SELECTORS,
      onStepRecorded: handleStepRecorded,
      enableModalDetection: isMultiStepGroupingEnabled, // Controlled by toggle
    });

  // Keep refs for multi-step grouping state so getters always return fresh values
  const activeModalRef = useRef(activeModal);
  const pendingGroupStepsRef = useRef(pendingGroupSteps);
  const isMultiStepGroupingEnabledRef = useRef(isMultiStepGroupingEnabled);

  // REACT: use useLayoutEffect to update refs synchronously after render
  // This ensures polling reads the correct values before next paint
  useLayoutEffect(() => {
    activeModalRef.current = activeModal;
  }, [activeModal]);

  useLayoutEffect(() => {
    pendingGroupStepsRef.current = pendingGroupSteps;
  }, [pendingGroupSteps]);

  useLayoutEffect(() => {
    isMultiStepGroupingEnabledRef.current = isMultiStepGroupingEnabled;
  }, [isMultiStepGroupingEnabled]);

  // Handle adding a manual step
  const handleAddStep = useCallback(() => {
    // noop actions don't require a reftarget
    if (newAction !== 'noop' && !newReftarget.trim()) {
      return;
    }

    // Parse requirements from comma-separated string
    const reqArray = newRequirements
      .split(',')
      .map((r) => r.trim())
      .filter((r) => r.length > 0);

    const step: JsonStep = {
      action: newAction,
      reftarget: newReftarget.trim(),
      ...(newAction === 'formfill' && newTargetvalue.trim() && { targetvalue: newTargetvalue.trim() }),
      ...(newAction === 'formfill' && newFormHint.trim() && { formHint: newFormHint.trim() }),
      ...(newAction === 'formfill' && newValidateInput && { validateInput: true }),
      ...(isGuided
        ? newDescription.trim() && { description: newDescription.trim() }
        : newTooltip.trim() && { tooltip: newTooltip.trim() }),
      ...(newLazyRender && { lazyRender: true }),
      ...(newLazyRender && newScrollContainer.trim() && { scrollContainer: newScrollContainer.trim() }),
      ...(reqArray.length > 0 && { requirements: reqArray }),
      ...(isGuided && newSkippable && { skippable: true }),
    };

    onChange([...steps, step]);
    setNewReftarget('');
    setNewTargetvalue('');
    setNewTooltip('');
    setNewDescription('');
    setNewFormHint('');
    setNewValidateInput(false);
    setNewLazyRender(false);
    setNewScrollContainer('');
    setNewRequirements('');
    setNewSkippable(false);
    setShowAddForm(false);
  }, [
    newAction,
    newReftarget,
    newTargetvalue,
    newFormHint,
    newValidateInput,
    newLazyRender,
    newScrollContainer,
    newRequirements,
    newSkippable,
    newTooltip,
    newDescription,
    isGuided,
    steps,
    onChange,
  ]);

  // Handle removing a step
  const handleRemoveStep = useCallback(
    (index: number) => {
      onChange(steps.filter((_, i) => i !== index));
    },
    [steps, onChange]
  );

  // Handle duplicating a step
  const handleDuplicateStep = useCallback(
    (index: number) => {
      const stepToDuplicate = steps[index];
      const duplicatedStep = JSON.parse(JSON.stringify(stepToDuplicate));
      const newSteps = [...steps];
      newSteps.splice(index + 1, 0, duplicatedStep);
      onChange(newSteps);
    },
    [steps, onChange]
  );

  // Get current step count (for overlay display) - uses ref so it always returns fresh value
  const getStepCount = useCallback(() => stepsLengthRef.current, []);

  // Get pending multi-step count (for overlay display) - uses ref so it always returns fresh value
  const getPendingMultiStepCount = useCallback(() => pendingGroupStepsRef.current.length, []);

  // Check if currently grouping steps into a multi-step
  const isGroupingMultiStep = useCallback(() => activeModalRef.current !== null, []);

  // Check if multi-step grouping is enabled
  const getIsMultiStepGroupingEnabled = useCallback(() => isMultiStepGroupingEnabledRef.current, []);

  // Toggle multi-step grouping on/off
  const toggleMultiStepGrouping = useCallback(() => {
    setIsMultiStepGroupingEnabled((prev) => !prev);
  }, []);

  // Stop record mode - notify parent to hide overlay
  const handleStopRecord = useCallback(() => {
    stopRecording();
    onRecordModeChange?.(false);
  }, [stopRecording, onRecordModeChange]);

  // Start record mode - notify parent to show overlay with stop callback
  const handleStartRecord = useCallback(() => {
    clearRecording();
    startRecording();
    // Reset multi-step grouping to enabled when starting a new recording
    setIsMultiStepGroupingEnabled(true);
    // Pass callbacks so parent can control the overlay
    // getStepCount uses a ref so it always returns fresh value
    onRecordModeChange?.(true, {
      onStop: handleStopRecord,
      getStepCount,
      getPendingMultiStepCount,
      isGroupingMultiStep,
      isMultiStepGroupingEnabled: getIsMultiStepGroupingEnabled,
      toggleMultiStepGrouping,
    });
  }, [
    clearRecording,
    startRecording,
    onRecordModeChange,
    handleStopRecord,
    getStepCount,
    getPendingMultiStepCount,
    isGroupingMultiStep,
    getIsMultiStepGroupingEnabled,
    toggleMultiStepGrouping,
  ]);

  const getActionEmoji = (action: JsonInteractiveAction) => {
    const found = INTERACTIVE_ACTIONS.find((a) => {
      return a.value === action;
    });
    return found?.label.split(' ')[0] ?? '⚡';
  };

  return (
    <div className={styles.container}>
      {/* Steps list with @dnd-kit */}
      {steps.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={stepIds} strategy={verticalListSortingStrategy}>
            <div className={styles.stepsList}>
              {steps.map((step, index) => (
                <React.Fragment key={stepIds[index]}>
                  {editingStepIndex === index ? (
                    /* Edit form for this step */
                    <div className={styles.addStepForm}>
                      <div style={{ fontWeight: 500, marginBottom: '8px' }}>Edit step {index + 1}</div>
                      <div className={styles.addStepRow}>
                        <Field label="Action" style={{ marginBottom: 0, flex: '0 0 150px' }}>
                          <Select
                            options={ACTION_OPTIONS}
                            value={ACTION_OPTIONS.find((o) => o.value === editAction)}
                            onChange={(opt) => opt.value && setEditAction(opt.value)}
                            menuPlacement="top"
                          />
                        </Field>
                        {/* Navigation path - for navigate actions only */}
                        {editAction === 'navigate' && (
                          <Field label="Path" style={{ marginBottom: 0, flex: 1 }}>
                            <Input
                              value={editReftarget}
                              onChange={(e) => setEditReftarget(e.currentTarget.value)}
                              placeholder="e.g., /dashboards, /d/abc123"
                            />
                          </Field>
                        )}
                        {/* Selector with picker - for actions that need a DOM element */}
                        {editAction !== 'noop' && editAction !== 'navigate' && (
                          <>
                            <Field label="Selector" style={{ marginBottom: 0, flex: 1 }}>
                              <Input
                                value={editReftarget}
                                onChange={(e) => setEditReftarget(e.currentTarget.value)}
                                placeholder="Click Pick or enter selector"
                              />
                            </Field>
                            <Button
                              variant="secondary"
                              onClick={startEditPicker}
                              icon="crosshair"
                              style={{ marginTop: '22px' }}
                            >
                              Pick
                            </Button>
                          </>
                        )}
                      </div>

                      {editAction === 'formfill' && (
                        <>
                          {/* For multistep: always show value field (it's what gets auto-filled) */}
                          {/* For guided: show value field only when validation is enabled */}
                          {!isGuided && (
                            <Field
                              label="Value to fill"
                              description="The value that will be automatically entered into the form field"
                              style={{ marginBottom: 0 }}
                            >
                              <Input
                                value={editTargetvalue}
                                onChange={(e) => setEditTargetvalue(e.currentTarget.value)}
                                placeholder="Value to automatically fill"
                              />
                            </Field>
                          )}
                          {isGuided && (
                            <>
                              <Checkbox
                                className={styles.checkbox}
                                label="Validate input (require value/pattern match)"
                                description="When enabled, user must enter a value matching the pattern. When disabled, any non-empty input completes the step."
                                checked={editValidateInput}
                                onChange={(e) => setEditValidateInput(e.currentTarget.checked)}
                              />
                              {editValidateInput && (
                                <>
                                  <Field
                                    label="Expected value (supports regex: ^pattern, /pattern/)"
                                    style={{ marginBottom: 0 }}
                                  >
                                    <Input
                                      value={editTargetvalue}
                                      onChange={(e) => setEditTargetvalue(e.currentTarget.value)}
                                      placeholder="Value or regex pattern to validate against"
                                    />
                                  </Field>
                                  <Field label="Validation hint (optional)" style={{ marginBottom: 0 }}>
                                    <Input
                                      value={editFormHint}
                                      onChange={(e) => setEditFormHint(e.currentTarget.value)}
                                      placeholder="Hint when validation fails"
                                    />
                                  </Field>
                                </>
                              )}
                            </>
                          )}
                        </>
                      )}

                      {isGuided ? (
                        <Field label="Description (optional)" style={{ marginBottom: 0 }}>
                          <Input
                            value={editDescription}
                            onChange={(e) => setEditDescription(e.currentTarget.value)}
                            placeholder="Description shown in the steps panel"
                          />
                        </Field>
                      ) : (
                        <Field label="Tooltip (optional)" style={{ marginBottom: 0 }}>
                          <Input
                            value={editTooltip}
                            onChange={(e) => setEditTooltip(e.currentTarget.value)}
                            placeholder="Tooltip shown during this step"
                          />
                        </Field>
                      )}

                      {/* Lazy render only applies to actions with DOM elements */}
                      {editAction !== 'navigate' && (
                        <Checkbox
                          className={styles.checkbox}
                          label="Element may be off-screen (scroll to find)"
                          description="Enable if the target is in a long list that requires scrolling. The system will scroll until the element is found."
                          checked={editLazyRender}
                          onChange={(e) => setEditLazyRender(e.currentTarget.checked)}
                        />
                      )}
                      {editLazyRender && editAction !== 'navigate' && (
                        <Field label="Scroll container (optional)" style={{ marginBottom: 0 }}>
                          <div className={styles.addStepRow}>
                            <Input
                              value={editScrollContainer}
                              onChange={(e) => setEditScrollContainer(e.currentTarget.value)}
                              placeholder=".scrollbar-view (default)"
                              style={{ flex: 1 }}
                            />
                            <Button
                              variant="secondary"
                              onClick={() => {
                                onPickerModeChange?.(true, (selector: string) => {
                                  setEditScrollContainer(selector);
                                });
                              }}
                              icon="crosshair"
                            >
                              Pick
                            </Button>
                          </div>
                        </Field>
                      )}

                      {/* Per-step requirements */}
                      <Field
                        label="Step requirements (optional)"
                        description="Conditions checked before this step executes (comma-separated)"
                        style={{ marginBottom: 0 }}
                      >
                        <Input
                          value={editRequirements}
                          onChange={(e) => setEditRequirements(e.currentTarget.value)}
                          placeholder="e.g., exists-reftarget, navmenu-open"
                        />
                      </Field>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '-4px' }}>
                        {COMMON_REQUIREMENTS.slice(0, 4).map((req) => (
                          <Badge
                            key={req}
                            text={req}
                            color="blue"
                            style={{ cursor: 'pointer' }}
                            onClick={() => {
                              setEditRequirements((prev) =>
                                prev.includes(req) ? prev : prev ? `${prev}, ${req}` : req
                              );
                            }}
                          />
                        ))}
                      </div>

                      {/* Per-step skippable (guided only) */}
                      {isGuided && (
                        <Checkbox
                          className={styles.checkbox}
                          label="Skippable (user can skip this step)"
                          description="Allow user to proceed without completing this step"
                          checked={editSkippable}
                          onChange={(e) => setEditSkippable(e.currentTarget.checked)}
                        />
                      )}

                      <div className={styles.addStepRow}>
                        <Button variant="secondary" onClick={handleCancelEdit}>
                          Cancel
                        </Button>
                        <Button
                          variant="primary"
                          onClick={handleSaveEdit}
                          disabled={editAction !== 'noop' && !editReftarget.trim()}
                        >
                          Save changes
                        </Button>
                      </div>
                    </div>
                  ) : (
                    /* Display view for this step - sortable via @dnd-kit */
                    <SortableStepItem
                      id={stepIds[index]}
                      index={index}
                      disabled={editingStepIndex !== null}
                    >
                      {/* Drag handle */}
                      <div className={styles.dragHandle} title="Drag to reorder">
                        <span style={{ fontSize: '12px' }}>⋮⋮</span>
                      </div>

                      {/* Content */}
                      <div className={styles.stepContent}>
                        <div className={styles.stepHeader}>
                          <span>{getActionEmoji(step.action)}</span>
                          <Badge text={step.action} color="blue" />
                          {step.targetvalue && <Badge text={`= "${step.targetvalue}"`} color="purple" />}
                        </div>
                        {/* Show description/tooltip if available, otherwise show selector (or "Info step" for noop) */}
                        <div className={styles.stepSelector} title={step.reftarget}>
                          {step.action === 'noop'
                            ? isGuided
                              ? step.description || 'Informational step'
                              : step.tooltip || 'Informational step'
                            : isGuided
                              ? step.description || step.reftarget
                              : step.tooltip || step.reftarget}
                        </div>
                      </div>

                      {/* Actions - stop propagation to prevent drag when clicking buttons */}
                      <div
                        className={styles.stepActions}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <IconButton
                          name="edit"
                          size="md"
                          aria-label="Edit"
                          onClick={() => handleStartEdit(index)}
                          className={styles.editButton}
                          tooltip="Edit step"
                        />
                        <IconButton
                          name="copy"
                          size="md"
                          aria-label="Duplicate"
                          onClick={() => handleDuplicateStep(index)}
                          className={styles.actionButton}
                          tooltip="Duplicate step"
                        />
                        <IconButton
                          name="trash-alt"
                          size="md"
                          aria-label="Remove"
                          onClick={() => handleRemoveStep(index)}
                          className={styles.deleteButton}
                          tooltip="Remove step"
                        />
                      </div>
                    </SortableStepItem>
                  )}
                </React.Fragment>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className={styles.emptyState}>
          <p>No steps yet. Add steps manually or use Record Mode.</p>
        </div>
      )}

      {/* Add step form */}
      {showAddForm && (
        <div className={styles.addStepForm}>
          <div className={styles.addStepRow}>
            <Field label="Action" style={{ marginBottom: 0, flex: '0 0 150px' }}>
              <Select
                options={ACTION_OPTIONS}
                value={ACTION_OPTIONS.find((o) => o.value === newAction)}
                onChange={(opt) => opt.value && setNewAction(opt.value)}
                menuPlacement="top"
              />
            </Field>
            {/* Navigation path - for navigate actions only */}
            {newAction === 'navigate' && (
              <Field label="Path" style={{ marginBottom: 0, flex: 1 }}>
                <Input
                  value={newReftarget}
                  onChange={(e) => setNewReftarget(e.currentTarget.value)}
                  placeholder="e.g., /dashboards, /d/abc123"
                />
              </Field>
            )}
            {/* Selector with picker - for actions that need a DOM element */}
            {newAction !== 'noop' && newAction !== 'navigate' && (
              <>
                <Field label="Selector" style={{ marginBottom: 0, flex: 1 }}>
                  <Input
                    value={newReftarget}
                    onChange={(e) => setNewReftarget(e.currentTarget.value)}
                    placeholder="Click Pick or enter selector"
                  />
                </Field>
                <Button variant="secondary" onClick={startPicker} icon="crosshair" style={{ marginTop: '22px' }}>
                  Pick
                </Button>
              </>
            )}
          </div>

          {newAction === 'formfill' && (
            <>
              {/* For multistep: always show value field (it's what gets auto-filled) */}
              {/* For guided: show value field only when validation is enabled */}
              {!isGuided && (
                <Field
                  label="Value to fill"
                  description="The value that will be automatically entered into the form field"
                  style={{ marginBottom: 0 }}
                >
                  <Input
                    value={newTargetvalue}
                    onChange={(e) => setNewTargetvalue(e.currentTarget.value)}
                    placeholder="Value to automatically fill"
                  />
                </Field>
              )}
              {isGuided && (
                <>
                  <Checkbox
                    className={styles.checkbox}
                    label="Validate input (require value/pattern match)"
                    description="When enabled, user must enter a value matching the pattern. When disabled, any non-empty input completes the step."
                    checked={newValidateInput}
                    onChange={(e) => setNewValidateInput(e.currentTarget.checked)}
                  />
                  {newValidateInput && (
                    <>
                      <Field label="Expected value (supports regex: ^pattern, /pattern/)" style={{ marginBottom: 0 }}>
                        <Input
                          value={newTargetvalue}
                          onChange={(e) => setNewTargetvalue(e.currentTarget.value)}
                          placeholder="Value or regex pattern to validate against"
                        />
                      </Field>
                      <Field label="Validation hint (optional)" style={{ marginBottom: 0 }}>
                        <Input
                          value={newFormHint}
                          onChange={(e) => setNewFormHint(e.currentTarget.value)}
                          placeholder="Hint when validation fails"
                        />
                      </Field>
                    </>
                  )}
                </>
              )}
            </>
          )}

          {isGuided ? (
            <Field label="Description (optional)" style={{ marginBottom: 0 }}>
              <Input
                value={newDescription}
                onChange={(e) => setNewDescription(e.currentTarget.value)}
                placeholder="Description shown in the steps panel"
              />
            </Field>
          ) : (
            <Field label="Tooltip (optional)" style={{ marginBottom: 0 }}>
              <Input
                value={newTooltip}
                onChange={(e) => setNewTooltip(e.currentTarget.value)}
                placeholder="Tooltip shown during this step"
              />
            </Field>
          )}

          {/* Lazy render only applies to actions with DOM elements */}
          {newAction !== 'navigate' && (
            <Checkbox
              className={styles.checkbox}
              label="Element may be off-screen (scroll to find)"
              description="Enable if the target is in a long list that requires scrolling. The system will scroll until the element is found."
              checked={newLazyRender}
              onChange={(e) => setNewLazyRender(e.currentTarget.checked)}
            />
          )}
          {newLazyRender && newAction !== 'navigate' && (
            <Field label="Scroll container (optional)" style={{ marginBottom: 0 }}>
              <div className={styles.addStepRow}>
                <Input
                  value={newScrollContainer}
                  onChange={(e) => setNewScrollContainer(e.currentTarget.value)}
                  placeholder=".scrollbar-view (default)"
                  style={{ flex: 1 }}
                />
                <Button
                  variant="secondary"
                  onClick={() => {
                    onPickerModeChange?.(true, (selector: string) => {
                      setNewScrollContainer(selector);
                    });
                  }}
                  icon="crosshair"
                >
                  Pick
                </Button>
              </div>
            </Field>
          )}

          {/* Per-step requirements */}
          <Field
            label="Step requirements (optional)"
            description="Conditions checked before this step executes (comma-separated)"
            style={{ marginBottom: 0 }}
          >
            <Input
              value={newRequirements}
              onChange={(e) => setNewRequirements(e.currentTarget.value)}
              placeholder="e.g., exists-reftarget, navmenu-open"
            />
          </Field>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '-4px' }}>
            {COMMON_REQUIREMENTS.slice(0, 4).map((req) => (
              <Badge
                key={req}
                text={req}
                color="blue"
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  setNewRequirements((prev) => (prev.includes(req) ? prev : prev ? `${prev}, ${req}` : req));
                }}
              />
            ))}
          </div>

          {/* Per-step skippable (guided only) */}
          {isGuided && (
            <Checkbox
              className={styles.checkbox}
              label="Skippable (user can skip this step)"
              description="Allow user to proceed without completing this step"
              checked={newSkippable}
              onChange={(e) => setNewSkippable(e.currentTarget.checked)}
            />
          )}

          <div className={styles.addStepRow}>
            <Button variant="secondary" onClick={() => setShowAddForm(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleAddStep} disabled={newAction !== 'noop' && !newReftarget.trim()}>
              Add step
            </Button>
          </div>
        </div>
      )}

      {/* Control buttons */}
      {!showAddForm && !isRecording && editingStepIndex === null && (
        <div className={styles.controlButtons}>
          <Button variant="secondary" icon="plus" onClick={() => setShowAddForm(true)}>
            Add step manually
          </Button>
          {showRecordMode && (
            <Button variant="secondary" icon="circle" onClick={handleStartRecord}>
              Start record mode
            </Button>
          )}
          {steps.length > 0 && (
            <Button variant="destructive" icon="trash-alt" onClick={() => onChange([])}>
              Clear all
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// Add display name for debugging
StepEditor.displayName = 'StepEditor';
