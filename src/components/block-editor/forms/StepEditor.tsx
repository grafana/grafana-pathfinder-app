/**
 * Step Editor Component
 *
 * Shared component for editing steps in multistep and guided blocks.
 * Includes record mode integration for capturing steps automatically.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Button, Field, Input, Select, Badge, IconButton, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { css } from '@emotion/css';
import { INTERACTIVE_ACTIONS } from '../constants';
import { useActionRecorder } from '../../wysiwyg-editor/devtools/action-recorder.hook';
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
    alignItems: 'flex-start',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    backgroundColor: theme.colors.background.primary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  stepNumber: css({
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    backgroundColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    flexShrink: 0,
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
    gap: theme.spacing(0.25),
    flexShrink: 0,
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
   * When starting (isActive=true), provides onStop callback and getStepCount function.
   * The parent should render RecordModeOverlay and call onStop when user clicks stop.
   */
  onRecordModeChange?: (isActive: boolean, options?: { onStop: () => void; getStepCount: () => number }) => void;
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

  // Edit step form state
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);
  const [editAction, setEditAction] = useState<JsonInteractiveAction>('highlight');
  const [editReftarget, setEditReftarget] = useState('');
  const [editTargetvalue, setEditTargetvalue] = useState('');
  const [editTooltip, setEditTooltip] = useState('');
  const [editDescription, setEditDescription] = useState('');

  // Keep a ref to current steps length so getStepCount always returns fresh value
  const stepsLengthRef = useRef(steps.length);
  // REACT: update ref in effect, not during render (R2)
  useEffect(() => {
    stepsLengthRef.current = steps.length;
  }, [steps.length]);

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
      setEditReftarget(step.reftarget);
      setEditTargetvalue(step.targetvalue ?? '');
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
    if (editingStepIndex === null || !editReftarget.trim()) {
      return;
    }

    const updatedStep: JsonStep = {
      action: editAction,
      reftarget: editReftarget.trim(),
      ...(editAction === 'formfill' && editTargetvalue.trim() && { targetvalue: editTargetvalue.trim() }),
      ...(isGuided
        ? editDescription.trim() && { description: editDescription.trim() }
        : editTooltip.trim() && { tooltip: editTooltip.trim() }),
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
    editTooltip,
    editDescription,
    isGuided,
    steps,
    onChange,
  ]);

  // Cancel editing
  const handleCancelEdit = useCallback(() => {
    setEditingStepIndex(null);
  }, []);

  // Action recorder for record mode - exclude our overlay UI
  const { isRecording, startRecording, stopRecording, clearRecording } = useActionRecorder({
    excludeSelectors: RECORD_EXCLUDE_SELECTORS,
    onStepRecorded: (step) => {
      // Convert recorded step to JsonStep and add to steps
      const jsonStep: JsonStep = {
        action: step.action as JsonInteractiveAction,
        reftarget: step.selector,
        ...(step.value && { targetvalue: step.value }),
      };
      onChange([...steps, jsonStep]);
    },
  });

  // Handle adding a manual step
  const handleAddStep = useCallback(() => {
    if (!newReftarget.trim()) {
      return;
    }

    const step: JsonStep = {
      action: newAction,
      reftarget: newReftarget.trim(),
      ...(newAction === 'formfill' && newTargetvalue.trim() && { targetvalue: newTargetvalue.trim() }),
      ...(isGuided
        ? newDescription.trim() && { description: newDescription.trim() }
        : newTooltip.trim() && { tooltip: newTooltip.trim() }),
    };

    onChange([...steps, step]);
    setNewReftarget('');
    setNewTargetvalue('');
    setNewTooltip('');
    setNewDescription('');
    setShowAddForm(false);
  }, [newAction, newReftarget, newTargetvalue, newTooltip, newDescription, isGuided, steps, onChange]);

  // Handle removing a step
  const handleRemoveStep = useCallback(
    (index: number) => {
      onChange(steps.filter((_, i) => i !== index));
    },
    [steps, onChange]
  );

  // Handle moving a step up
  const handleMoveUp = useCallback(
    (index: number) => {
      if (index > 0) {
        const newSteps = [...steps];
        [newSteps[index - 1], newSteps[index]] = [newSteps[index], newSteps[index - 1]];
        onChange(newSteps);
      }
    },
    [steps, onChange]
  );

  // Handle moving a step down
  const handleMoveDown = useCallback(
    (index: number) => {
      if (index < steps.length - 1) {
        const newSteps = [...steps];
        [newSteps[index], newSteps[index + 1]] = [newSteps[index + 1], newSteps[index]];
        onChange(newSteps);
      }
    },
    [steps, onChange]
  );

  // Get current step count (for overlay display) - uses ref so it always returns fresh value
  const getStepCount = useCallback(() => stepsLengthRef.current, []);

  // Stop record mode - notify parent to hide overlay
  const handleStopRecord = useCallback(() => {
    stopRecording();
    onRecordModeChange?.(false);
  }, [stopRecording, onRecordModeChange]);

  // Start record mode - notify parent to show overlay with stop callback
  const handleStartRecord = useCallback(() => {
    clearRecording();
    startRecording();
    // Pass callbacks so parent can control the overlay
    // getStepCount uses a ref so it always returns fresh value
    onRecordModeChange?.(true, { onStop: handleStopRecord, getStepCount });
  }, [clearRecording, startRecording, onRecordModeChange, handleStopRecord, getStepCount]);

  const getActionEmoji = (action: JsonInteractiveAction) => {
    const found = INTERACTIVE_ACTIONS.find((a) => {
      return a.value === action;
    });
    return found?.label.split(' ')[0] ?? '⚡';
  };

  return (
    <div className={styles.container}>
      {/* Steps list */}
      {steps.length > 0 ? (
        <div className={styles.stepsList}>
          {steps.map((step, index) => (
            <div key={index}>
              {editingStepIndex === index ? (
                /* Edit form for this step */
                <div className={styles.addStepForm}>
                  <div style={{ fontWeight: 500, marginBottom: '8px' }}>Edit Step {index + 1}</div>
                  <div className={styles.addStepRow}>
                    <Field label="Action" style={{ marginBottom: 0, flex: '0 0 150px' }}>
                      <Select
                        options={ACTION_OPTIONS}
                        value={ACTION_OPTIONS.find((o) => o.value === editAction)}
                        onChange={(opt) => opt.value && setEditAction(opt.value)}
                        menuPlacement="top"
                      />
                    </Field>
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
                  </div>

                  {editAction === 'formfill' && (
                    <Field label="Value" style={{ marginBottom: 0 }}>
                      <Input
                        value={editTargetvalue}
                        onChange={(e) => setEditTargetvalue(e.currentTarget.value)}
                        placeholder="Value to fill"
                      />
                    </Field>
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

                  <div className={styles.addStepRow}>
                    <Button variant="secondary" onClick={handleCancelEdit}>
                      Cancel
                    </Button>
                    <Button variant="primary" onClick={handleSaveEdit} disabled={!editReftarget.trim()}>
                      Save Changes
                    </Button>
                  </div>
                </div>
              ) : (
                /* Display view for this step */
                <div className={styles.stepItem}>
                  <div className={styles.stepNumber}>{index + 1}</div>
                  <div className={styles.stepContent}>
                    <div className={styles.stepHeader}>
                      <span>{getActionEmoji(step.action)}</span>
                      <Badge text={step.action} color="blue" />
                      {step.targetvalue && <Badge text={`= "${step.targetvalue}"`} color="purple" />}
                    </div>
                    <div className={styles.stepSelector} title={step.reftarget}>
                      {step.reftarget}
                    </div>
                    {isGuided
                      ? step.description && (
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>📝 {step.description}</div>
                        )
                      : step.tooltip && (
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>💬 {step.tooltip}</div>
                        )}
                  </div>
                  <div className={styles.stepActions}>
                    <IconButton
                      name="pen"
                      size="sm"
                      aria-label="Edit"
                      onClick={() => handleStartEdit(index)}
                      tooltip="Edit step"
                    />
                    <IconButton
                      name="angle-up"
                      size="sm"
                      aria-label="Move up"
                      onClick={() => handleMoveUp(index)}
                      disabled={index === 0}
                      tooltip="Move up"
                    />
                    <IconButton
                      name="angle-down"
                      size="sm"
                      aria-label="Move down"
                      onClick={() => handleMoveDown(index)}
                      disabled={index === steps.length - 1}
                      tooltip="Move down"
                    />
                    <IconButton
                      name="trash-alt"
                      size="sm"
                      aria-label="Remove"
                      onClick={() => handleRemoveStep(index)}
                      tooltip="Remove step"
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
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
          </div>

          {newAction === 'formfill' && (
            <Field label="Value" style={{ marginBottom: 0 }}>
              <Input
                value={newTargetvalue}
                onChange={(e) => setNewTargetvalue(e.currentTarget.value)}
                placeholder="Value to fill"
              />
            </Field>
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

          <div className={styles.addStepRow}>
            <Button variant="secondary" onClick={() => setShowAddForm(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleAddStep} disabled={!newReftarget.trim()}>
              Add Step
            </Button>
          </div>
        </div>
      )}

      {/* Control buttons */}
      {!showAddForm && !isRecording && editingStepIndex === null && (
        <div className={styles.controlButtons}>
          <Button variant="secondary" icon="plus" onClick={() => setShowAddForm(true)}>
            Add Step Manually
          </Button>
          {showRecordMode && (
            <Button variant="secondary" icon="circle" onClick={handleStartRecord}>
              Start Record Mode
            </Button>
          )}
          {steps.length > 0 && (
            <Button variant="destructive" icon="trash-alt" onClick={() => onChange([])}>
              Clear All
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// Add display name for debugging
StepEditor.displayName = 'StepEditor';
