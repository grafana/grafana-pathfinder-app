/**
 * Step Editor Component
 *
 * Shared component for editing steps in multistep and guided blocks.
 * Includes record mode integration for capturing steps automatically.
 */

import React, { useState, useCallback } from 'react';
import { Button, Field, Input, Select, Badge, IconButton, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { css } from '@emotion/css';
import { INTERACTIVE_ACTIONS } from '../constants';
import { useActionRecorder } from '../../wysiwyg-editor/devtools/action-recorder.hook';
import type { JsonStep, JsonInteractiveAction } from '../types';

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
  recordingBanner: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1.5),
    backgroundColor: theme.colors.error.transparent,
    border: `2px solid ${theme.colors.error.border}`,
    borderRadius: theme.shape.radius.default,
    animation: 'recording-pulse 2s ease-in-out infinite',
    '@keyframes recording-pulse': {
      '0%, 100%': { borderColor: theme.colors.error.border },
      '50%': { borderColor: theme.colors.error.main },
    },
  }),
  recordingDot: css({
    width: '12px',
    height: '12px',
    borderRadius: '50%',
    backgroundColor: theme.colors.error.main,
    animation: 'blink-dot 1s ease-in-out infinite',
    '@keyframes blink-dot': {
      '0%, 100%': { opacity: 1 },
      '50%': { opacity: 0.4 },
    },
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
  /** Called to start/stop the element picker with a callback for receiving the selector */
  onPickerModeChange?: (isActive: boolean, onSelect?: (selector: string) => void) => void;
}

/**
 * Step editor component
 */
export function StepEditor({ steps, onChange, showRecordMode = true, onPickerModeChange }: StepEditorProps) {
  const styles = useStyles2(getStyles);

  // Add step form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAction, setNewAction] = useState<JsonInteractiveAction>('highlight');
  const [newReftarget, setNewReftarget] = useState('');
  const [newTargetvalue, setNewTargetvalue] = useState('');
  const [newTooltip, setNewTooltip] = useState('');

  // Start element picker - pass callback to receive selected element
  const startPicker = useCallback(() => {
    onPickerModeChange?.(true, (selector: string) => {
      setNewReftarget(selector);
    });
  }, [onPickerModeChange]);

  // Action recorder for record mode
  const { isRecording, startRecording, stopRecording, clearRecording } = useActionRecorder({
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
      ...(newTooltip.trim() && { tooltip: newTooltip.trim() }),
    };

    onChange([...steps, step]);
    setNewReftarget('');
    setNewTargetvalue('');
    setNewTooltip('');
    setShowAddForm(false);
  }, [newAction, newReftarget, newTargetvalue, newTooltip, steps, onChange]);

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

  // Toggle record mode
  const handleToggleRecord = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      clearRecording();
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording, clearRecording]);

  const getActionEmoji = (action: JsonInteractiveAction) => {
    const found = INTERACTIVE_ACTIONS.find((a) => {
      return a.value === action;
    });
    return found?.label.split(' ')[0] ?? '⚡';
  };

  return (
    <div className={styles.container}>
      {/* Recording banner */}
      {isRecording && (
        <div className={styles.recordingBanner}>
          <div className={styles.recordingDot} />
          <span style={{ flex: 1 }}>Recording steps... Click elements to capture</span>
          <Button variant="destructive" size="sm" onClick={stopRecording}>
            Stop Recording
          </Button>
        </div>
      )}

      {/* Steps list */}
      {steps.length > 0 ? (
        <div className={styles.stepsList}>
          {steps.map((step, index) => (
            <div key={index} className={styles.stepItem}>
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
                {step.tooltip && (
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>💬 {step.tooltip}</div>
                )}
              </div>
              <div className={styles.stepActions}>
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

          <Field label="Tooltip (optional)" style={{ marginBottom: 0 }}>
            <Input
              value={newTooltip}
              onChange={(e) => setNewTooltip(e.currentTarget.value)}
              placeholder="Tooltip shown during this step"
            />
          </Field>

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
      {!showAddForm && !isRecording && (
        <div className={styles.controlButtons}>
          <Button variant="secondary" icon="plus" onClick={() => setShowAddForm(true)}>
            Add Step Manually
          </Button>
          {showRecordMode && (
            <Button variant="secondary" icon="circle" onClick={handleToggleRecord}>
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
