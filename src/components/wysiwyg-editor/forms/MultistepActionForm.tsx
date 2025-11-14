import React, { useState, useCallback } from 'react';
import { Field, Input, Button, Stack, useStyles2, Badge, Icon } from '@grafana/ui';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { type InteractiveFormProps } from '../types';
import { DATA_ATTRIBUTES, DEFAULT_VALUES, COMMON_REQUIREMENTS } from '../../../constants/interactive-config';
import { useActionRecorder } from '../../../utils/devtools/action-recorder.hook';
import { getActionConfig } from './actionConfig';
import { ACTION_TYPES } from '../../../constants/interactive-config';
import type { RecordedStep } from '../../../utils/devtools/tutorial-exporter';

const getStyles = (theme: GrafanaTheme2) => ({
  form: css({
    padding: theme.spacing(2),
  }),
  title: css({
    marginBottom: theme.spacing(1),
  }),
  description: css({
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing(2),
  }),
  infoBox: css({
    padding: theme.spacing(1.5),
    backgroundColor: theme.colors.background.secondary,
    borderLeft: `3px solid ${theme.colors.info.border}`,
    marginTop: theme.spacing(2),
    marginBottom: theme.spacing(2),
  }),
  commonOptions: css({
    display: 'flex',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1),
    flexWrap: 'wrap',
  }),
  actions: css({
    display: 'flex',
    justifyContent: 'flex-end',
    gap: theme.spacing(1),
    marginTop: theme.spacing(2),
  }),
  // Recorder section styles
  recorderSection: css({
    marginTop: theme.spacing(2),
    padding: theme.spacing(2),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  recorderHeader: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing(1.5),
  }),
  recorderTitle: css({
    fontSize: theme.typography.h5.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    margin: 0,
  }),
  recordModeControls: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    flexWrap: 'wrap',
  }),
  recordModeActive: css({
    animation: 'pulse 2s ease-in-out infinite',
    '@keyframes pulse': {
      '0%, 100%': { opacity: 1 },
      '50%': { opacity: 0.8 },
    },
  }),
  recordingDot: css({
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: theme.colors.error.main,
    display: 'inline-block',
    marginRight: theme.spacing(0.5),
    animation: 'blink 1.5s ease-in-out infinite',
    '@keyframes blink': {
      '0%, 100%': { opacity: 1 },
      '50%': { opacity: 0.3 },
    },
  }),
  recordModeHint: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    backgroundColor: theme.colors.error.transparent,
    borderRadius: theme.shape.radius.default,
    color: theme.colors.error.text,
    fontSize: theme.typography.bodySmall.fontSize,
    marginBottom: theme.spacing(1.5),
  }),
  recordedStepsList: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    maxHeight: '300px',
    overflowY: 'auto',
    padding: theme.spacing(1),
    backgroundColor: theme.colors.background.primary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    marginTop: theme.spacing(1.5),
  }),
  recordedStep: css({
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  stepNumber: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    backgroundColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
    borderRadius: '50%',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightBold,
    flexShrink: 0,
  }),
  stepDetails: css({
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    overflow: 'hidden',
  }),
  stepDescription: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.primary,
    fontWeight: theme.typography.fontWeightMedium,
    wordBreak: 'break-word',
    overflowWrap: 'break-word',
  }),
  stepCode: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: '11px',
    color: theme.colors.text.secondary,
    backgroundColor: theme.colors.background.secondary,
    padding: `${theme.spacing(0.25)} ${theme.spacing(0.5)}`,
    borderRadius: theme.shape.radius.default,
    display: 'block',
    wordBreak: 'break-all',
    overflowWrap: 'break-word',
  }),
  stepMeta: css({
    display: 'flex',
    gap: theme.spacing(0.5),
    marginTop: theme.spacing(0.5),
    flexWrap: 'wrap',
  }),
  warningIcon: css({
    marginLeft: theme.spacing(0.5),
    color: theme.colors.warning.text,
    verticalAlign: 'middle',
  }),
  emptyState: css({
    padding: theme.spacing(2),
    textAlign: 'center',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    fontStyle: 'italic',
  }),
  buttonGroup: css({
    display: 'flex',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1.5),
  }),
  label: css({
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing(0.5),
  }),
});

/**
 * Custom form component for multistep actions with integrated recorder
 * Replaces the generic BaseInteractiveForm wrapper with a purpose-built UI
 */
const MultistepActionForm = ({ onApply, onCancel, initialValues, onSwitchType }: InteractiveFormProps) => {
  const styles = useStyles2(getStyles);
  const config = getActionConfig(ACTION_TYPES.MULTISTEP);
  
  if (!config) {
    throw new Error(`Action config not found for ${ACTION_TYPES.MULTISTEP}`);
  }

  // Requirements state
  const [requirements, setRequirements] = useState<string>(
    (initialValues?.[DATA_ATTRIBUTES.REQUIREMENTS] as string) || DEFAULT_VALUES.REQUIREMENT || ''
  );

  // Action recorder hook - exclude the form panel itself
  const {
    isRecording: recordMode,
    recordedSteps,
    startRecording,
    stopRecording,
    clearRecording,
    deleteStep,
  } = useActionRecorder({
    excludeSelectors: ['[data-pathfinder-content]', '[data-wysiwyg-form]'],
  });

  const handleRecordModeToggle = useCallback(() => {
    if (recordMode) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [recordMode, startRecording, stopRecording]);

  const handleClearRecording = useCallback(() => {
    clearRecording();
  }, [clearRecording]);

  const handleDeleteStep = useCallback(
    (index: number) => {
      deleteStep(index);
    },
    [deleteStep]
  );

  // Check if we're in edit mode (has initialValues)
  const isEditMode = !!initialValues;

  const isValid = () => {
    // In edit mode, allow applying without recorded steps (preserving existing structure)
    // In create mode, require at least one recorded step
    if (isEditMode) {
      return true;
    }
    return recordedSteps.length > 0;
  };

  const handleApply = () => {
    if (!isValid()) {
      return;
    }

    // Build attributes with recorded steps attached as internal property (only if we have steps)
    const attributes: any = {
      [DATA_ATTRIBUTES.TARGET_ACTION]: ACTION_TYPES.MULTISTEP,
      [DATA_ATTRIBUTES.REQUIREMENTS]: requirements || undefined,
      class: DEFAULT_VALUES.CLASS,
    };

    // Only include internal actions if we have recorded steps (create mode with recording)
    // In edit mode without new recordings, we preserve the existing structure
    if (recordedSteps.length > 0) {
      attributes.__internalActions = recordedSteps.map((step) => ({
        targetAction: step.action,
        refTarget: step.selector,
        targetValue: step.value,
        requirements: undefined, // Requirements are typically on child spans
      }));
    }

    onApply(attributes);
  };

  return (
    <div className={styles.form} data-wysiwyg-form="true">
      <h4 className={styles.title}>{config.title}</h4>
      <p className={styles.description}>{config.description}</p>

      <Stack direction="column" gap={2}>
        {/* Requirements field */}
        <Field
          label="Requirements:"
          description="Requirements are usually set on child interactive spans"
        >
          <>
            <Input
              value={requirements}
              onChange={(e) => setRequirements(e.currentTarget.value)}
              placeholder={`e.g., ${DEFAULT_VALUES.REQUIREMENT} (optional)`}
              autoFocus
            />
            <div className={styles.commonOptions}>
              {COMMON_REQUIREMENTS.slice(0, 3).map((req) => (
                <Button key={req} size="sm" variant="secondary" onClick={() => setRequirements(req)}>
                  {req}
                </Button>
              ))}
            </div>
          </>
        </Field>

        {/* Recorder section */}
        <div className={styles.recorderSection}>
          <div className={styles.recorderHeader}>
            <h5 className={styles.recorderTitle}>Record Actions</h5>
            <div className={styles.recordModeControls}>
              <Button
                variant={recordMode ? 'destructive' : 'primary'}
                size="md"
                onClick={handleRecordModeToggle}
                className={recordMode ? styles.recordModeActive : ''}
              >
                {recordMode && <span className={styles.recordingDot} />}
                <Icon name={recordMode ? 'pause' : 'circle'} />
                {recordMode ? 'Stop Recording' : 'Start Recording'}
              </Button>
              {recordedSteps.length > 0 && <Badge text={`${recordedSteps.length} steps`} color="blue" />}
            </div>
          </div>

          {recordMode && (
            <div className={styles.recordModeHint}>
              <Icon name="info-circle" size="sm" />
              Click elements and fill forms to record a sequence
            </div>
          )}

          {isEditMode && recordedSteps.length === 0 && (
            <div className={styles.emptyState}>
              Editing existing multistep. Record new actions to replace existing internal spans.
            </div>
          )}

          {recordedSteps.length > 0 ? (
            <>
              <label className={styles.label}>Recorded Steps</label>
              <div className={styles.recordedStepsList}>
                {recordedSteps.map((step, index) => (
                  <div key={index} className={styles.recordedStep}>
                    <div className={styles.stepNumber}>{index + 1}</div>
                    <div className={styles.stepDetails}>
                      <div className={styles.stepDescription}>
                        {step.description}
                        {step.isUnique === false && (
                          <Icon
                            name="exclamation-triangle"
                            size="sm"
                            className={styles.warningIcon}
                            title={`Non-unique selector (${step.matchCount} matches)`}
                          />
                        )}
                      </div>
                      <code className={styles.stepCode}>
                        {step.action}|{step.selector}|{step.value || ''}
                      </code>
                      {(step.contextStrategy || step.isUnique === false) && (
                        <div className={styles.stepMeta}>
                          {step.contextStrategy && <Badge text={step.contextStrategy} color="purple" />}
                          {step.isUnique === false && <Badge text={`${step.matchCount} matches`} color="orange" />}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={() => handleDeleteStep(index)}
                      icon="trash-alt"
                      aria-label="Delete step"
                    />
                  </div>
                ))}
              </div>

              <div className={styles.buttonGroup}>
                <Button variant="secondary" size="sm" onClick={handleClearRecording}>
                  <Icon name="trash-alt" />
                  Clear All
                </Button>
              </div>
            </>
          ) : (
            <div className={styles.emptyState}>
              {recordMode
                ? 'Click elements in Grafana to record actions...'
                : 'Click "Start Recording" to capture a sequence of actions'}
            </div>
          )}
        </div>
      </Stack>

      {config.infoBox && (
        <div className={styles.infoBox}>
          <strong>Note:</strong> {config.infoBox}
        </div>
      )}

      <div className={styles.actions}>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        {initialValues && onSwitchType && (
          <Button variant="secondary" onClick={onSwitchType}>
            Switch Type
          </Button>
        )}
        <Button variant="primary" onClick={handleApply} disabled={!isValid()}>
          Apply
        </Button>
      </div>
    </div>
  );
};

export default MultistepActionForm;
